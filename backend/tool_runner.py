from __future__ import annotations
import asyncio
import logging
import os
import re
import shlex
import subprocess
import threading
import time
from dataclasses import dataclass
from typing import Callable, Dict, List, Optional, Tuple

from config import Settings
from validators import SUPPORTED_TOOLS, validate_args_string

logger = logging.getLogger("orchestrator")

# Docker label key used to tag containers so a run can be cancelled.
_RUN_LABEL = "alphaweb_run"


def cancel_run(run_id: str) -> int:
    """Kill all docker containers tagged with this run_id.

    Returns the number of containers killed.
    """
    if not run_id:
        return 0
    try:
        ps = subprocess.run(
            ["docker", "ps", "-q", "--filter", f"label={_RUN_LABEL}={run_id}"],
            capture_output=True,
            text=True,
            timeout=10,
        )
        ids = [x for x in ps.stdout.split() if x]
        if not ids:
            return 0
        subprocess.run(
            ["docker", "kill", *ids],
            capture_output=True,
            text=True,
            timeout=15,
        )
        logger.info(f"cancel_run {run_id}: killed {len(ids)} container(s)")
        return len(ids)
    except Exception as e:
        logger.warning(f"cancel_run {run_id} failed: {e}")
        return 0


@dataclass(frozen=True)
class ToolRunResult:
    raw_output: str
    tool: str = ""
    success: bool = True
    status: str = "completed"
    exit_code: int = 0
    execution_time: float = 0.0
    cpu_usage: float = 0.0
    memory_usage: float = 0.0
    network_sent: int = 0
    network_received: int = 0
    findings: list = None
    parsed_successfully: bool = False
    errors: list = None

    def __post_init__(self):
        if self.findings is None:
            object.__setattr__(self, "findings", [])
        if self.errors is None:
            object.__setattr__(self, "errors", [])


def _split_args(args: str) -> List[str]:
    """
    Split args without invoking a shell.

    We rely on `shlex.split` for handling quoted segments.
    """

    if not args:
        return []
    return shlex.split(args, posix=True)


def _docker_run_cmd(
    *,
    tool_name: str,
    args: str,
    target: str,
    settings: Settings,
) -> Tuple[List[str], Optional[Tuple[str, str]]]:
    """
    Build docker run command args.

    Returns:
      (cmd, john_mount) where john_mount is (host_path, container_path) if used.
    """

    args = validate_args_string(args)
    args_tokens = _split_args(args)

    cmd: List[str] = [
        "docker", "run", "--rm",
        "--memory", settings.DOCKER_MEMORY_LIMIT,
        "--cpus", settings.DOCKER_CPU_LIMIT,
    ]

    # masscan and tcpdump need raw-socket access to function at all.
    if tool_name in ("masscan", "tcpdump"):
        cmd += ["--cap-add", "NET_RAW", "--cap-add", "NET_ADMIN"]

    john_mount: Optional[Tuple[str, str]] = None

    # Special case: "john" expects wordlist/hash input via a /data volume.
    if tool_name == "john":
        basename = os.path.basename(target)
        host_data_dir_spec = settings.HOST_DATA_DIR

        # Two supported mount styles:
        # 1) host_path: mount an absolute host path
        # 2) volume:<name>: mount a Docker named volume
        is_named_volume = host_data_dir_spec.startswith("volume:")

        if is_named_volume:
            volume_name = host_data_dir_spec.split("volume:", 1)[1].strip()
            if not volume_name:
                raise ValueError("HOST_DATA_DIR is volume: but has no volume name.")

            # Validate input exists inside the orchestrator container filesystem
            # (where docker-compose bind mounts or mounts the named volume to /app/data).
            local_lookup_dir = os.path.abspath(settings.JOHN_LOCAL_DATA_DIR)
            host_file = os.path.join(local_lookup_dir, basename)
            if not os.path.isfile(host_file):
                raise FileNotFoundError(
                    f"john input file not found: {host_file}. "
                    f"Ensure the file exists and the orchestrator mounts it to {local_lookup_dir}."
                )

            john_mount = (f"volume:{volume_name}", settings.CONTAINER_DATA_DIR)
            cmd += ["-v", f"{volume_name}:{settings.CONTAINER_DATA_DIR}:ro"]
        else:
            if settings.JOHN_WORDLIST_MOUNT_MODE == "container_path":
                # Non-standard mode; expects docker daemon can access the container path directly.
                host_data_dir_abs = os.path.abspath(settings.CONTAINER_DATA_DIR)
            else:
                host_data_dir_abs = os.path.abspath(host_data_dir_spec)

            host_file = os.path.join(host_data_dir_abs, basename)
            if not os.path.isfile(host_file):
                raise FileNotFoundError(
                    f"john input file not found: {host_file}. "
                    f"Place your wordlist/hash in {host_data_dir_abs} and pass the filename."
                )

            john_mount = (host_data_dir_abs, settings.CONTAINER_DATA_DIR)
            cmd += ["-v", f"{host_data_dir_abs}:{settings.CONTAINER_DATA_DIR}:ro"]

        container_target = os.path.join(settings.CONTAINER_DATA_DIR, basename)
        cmd.append(settings.get_tool_image(tool_name))
        if args_tokens:
            cmd += args_tokens
        cmd.append(container_target)
        return cmd, john_mount

    cmd.append(settings.get_tool_image(tool_name))

    # Special case: tcpdump typically takes flags then an interface/target.
    if tool_name == "tcpdump":
        if args_tokens:
            cmd += args_tokens
        cmd.append(target)
        return cmd, None

    # Default execution: <args> <target>
    if args_tokens:
        cmd += args_tokens
    cmd.append(target)
    return cmd, None


def _build_run_cmd(tool_name: str, args: str, target: str, settings: Settings) -> List[str]:
    cmd, _john_mount = _docker_run_cmd(
        tool_name=tool_name,
        args=args,
        target=target,
        settings=settings,
    )
    return cmd


ToolRunCmdBuilder = Callable[[str, str, Settings], List[str]]


def build_cmd_generic(tool_name: str, args: str, target: str, settings: Settings) -> List[str]:
    return _build_run_cmd(tool_name=tool_name, args=args, target=target, settings=settings)


# Tool registry: tool name -> function that builds the docker command.
TOOL_COMMAND_BUILDERS: Dict[str, ToolRunCmdBuilder] = {
    tool: (lambda a, t, s, _tool=tool: build_cmd_generic(_tool, a, t, s))
    for tool in SUPPORTED_TOOLS
}


def _run_cmd_override(tool_name: str, args: str, target: str, settings: Settings) -> List[str]:
    # Currently all tools share the same builder,
    # but the registry keeps it extensible and lets you add
    # per-tool command shaping cleanly.
    return _build_run_cmd(tool_name=tool_name, args=args, target=target, settings=settings)


# Example explicit overrides (kept for readability/extension).
TOOL_COMMAND_BUILDERS["john"] = lambda a, t, s: _run_cmd_override("john", a, t, s)
TOOL_COMMAND_BUILDERS["tcpdump"] = lambda a, t, s: _run_cmd_override("tcpdump", a, t, s)


def _tool_timeout_seconds(tool_name: str, settings: Settings) -> int:
    # Per-tool timeouts. Global override in settings takes precedence.
    TOOL_TIMEOUTS = {
        "curl": 60,
        "nmap": 300,
        "masscan": 120,
        "nikto": 600,
        "sqlmap": 900,
        "ffuf": 600,
        "gobuster": 600,
        "hydra": 1800,
        "john": 3600,
        "tcpdump": 60,
        "nuclei": 600,
        "hashcat": 3600,
        "gitleaks": 300,
        "theharvester": 300,
        "subfinder": 300,
        "testssl": 300,
        "wapiti": 900,
        "wpscan": 600,
        "cewl": 300,
        "trivy": 300,
        "amass": 600,
        "commix": 900,
        "searchsploit": 60,
        "subdominator": 300,
        "httpx": 120,
    }

    if settings.TOOL_EXECUTION_TIMEOUT_SECS:
        return settings.TOOL_EXECUTION_TIMEOUT_SECS
    return TOOL_TIMEOUTS.get(tool_name, 900)


def run_tool_sync(
    *,
    tool_name: str,
    args: str,
    target: str,
    settings: Settings,
    run_id: Optional[str] = None,
) -> ToolRunResult:
    if tool_name not in SUPPORTED_TOOLS:
        raise ValueError(f"Unsupported tool: {tool_name}")

    timeout_secs = _tool_timeout_seconds(tool_name, settings)

    builder = TOOL_COMMAND_BUILDERS.get(tool_name)
    if not builder:
        raise ValueError(f"No docker command builder registered for tool: {tool_name}")

    cmd = builder(args, target, settings)

    # Tag the container with the run_id so it can be killed on cancel.
    # cmd starts with ["docker", "run", ...] — insert the label right after "run".
    if run_id and len(cmd) >= 2 and cmd[0] == "docker" and cmd[1] == "run":
        cmd[2:2] = ["--label", f"{_RUN_LABEL}={run_id}"]

    import time as _time
    start = _time.time()
    errors = []

    try:
        proc = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=timeout_secs,
            env=os.environ.copy(),
        )
        elapsed = round(_time.time() - start, 2)

        out = (proc.stdout or "") + (proc.stderr or "")
        if not out.strip():
            out = proc.stdout or proc.stderr or ""

        success = proc.returncode == 0
        if not success:
            errors.append(f"Process exited with code {proc.returncode}")

        return ToolRunResult(
            raw_output=out,
            tool=tool_name,
            success=success,
            status="completed" if success else "failed",
            exit_code=proc.returncode,
            execution_time=elapsed,
            errors=errors,
        )

    except subprocess.TimeoutExpired:
        elapsed = round(_time.time() - start, 2)
        return ToolRunResult(
            raw_output="",
            tool=tool_name,
            success=False,
            status="timeout",
            exit_code=-1,
            execution_time=elapsed,
            errors=[f"Tool timed out after {timeout_secs}s"],
        )

    except Exception as e:
        elapsed = round(_time.time() - start, 2)
        return ToolRunResult(
            raw_output="",
            tool=tool_name,
            success=False,
            status="failed",
            exit_code=-1,
            execution_time=elapsed,
            errors=[str(e)],
        )


async def run_tool(
    *,
    tool_name: str,
    args: str,
    target: str,
    settings: Settings,
    run_id: Optional[str] = None,
) -> ToolRunResult:
    return await asyncio.to_thread(
        run_tool_sync,
        tool_name=tool_name,
        args=args,
        target=target,
        settings=settings,
        run_id=run_id,
    )


_ANSI_RE = re.compile(r"\x1b\[[0-9;]*[a-zA-Z]")


def _stream_tool_sync(
    *,
    tool_name: str,
    args: str,
    target: str,
    settings: Settings,
    run_id: Optional[str],
    loop: asyncio.AbstractEventLoop,
    line_queue: asyncio.Queue,
) -> ToolRunResult:
    """Run a tool via Popen, pushing each output line onto line_queue live.

    A `None` sentinel is always pushed last so the consumer knows the run
    has ended (even if this function raises).
    """

    def _put(item):
        try:
            loop.call_soon_threadsafe(line_queue.put_nowait, item)
        except RuntimeError:
            pass  # event loop already closed

    start = time.time()
    timer: Optional[threading.Timer] = None
    try:
        if tool_name not in SUPPORTED_TOOLS:
            raise ValueError(f"Unsupported tool: {tool_name}")

        builder = TOOL_COMMAND_BUILDERS.get(tool_name)
        if not builder:
            raise ValueError(f"No docker command builder registered for tool: {tool_name}")

        timeout_secs = _tool_timeout_seconds(tool_name, settings)
        cmd = builder(args, target, settings)

        if run_id and len(cmd) >= 2 and cmd[0] == "docker" and cmd[1] == "run":
            cmd[2:2] = ["--label", f"{_RUN_LABEL}={run_id}"]

        proc = subprocess.Popen(
            cmd,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            encoding="utf-8",
            errors="replace",
            bufsize=1,
            env=os.environ.copy(),
        )

        timed_out = {"v": False}

        def _watchdog():
            timed_out["v"] = True
            if run_id:
                cancel_run(run_id)
            try:
                proc.kill()
            except Exception:
                pass

        timer = threading.Timer(timeout_secs, _watchdog)
        timer.daemon = True
        timer.start()

        captured: List[str] = []
        for raw_line in proc.stdout:
            line = _ANSI_RE.sub("", raw_line.rstrip("\r\n"))
            captured.append(line)
            if line.strip():
                _put(line)
        proc.wait()
        timer.cancel()

        elapsed = round(time.time() - start, 2)
        out = "\n".join(captured)
        exit_code = proc.returncode if proc.returncode is not None else -1

        if timed_out["v"]:
            return ToolRunResult(
                raw_output=out, tool=tool_name, success=False, status="timeout",
                exit_code=-1, execution_time=elapsed,
                errors=[f"Tool timed out after {timeout_secs}s"],
            )

        success = exit_code == 0
        return ToolRunResult(
            raw_output=out, tool=tool_name, success=success,
            status="completed" if success else "failed",
            exit_code=exit_code, execution_time=elapsed,
            errors=[] if success else [f"Process exited with code {exit_code}"],
        )

    finally:
        if timer is not None:
            timer.cancel()
        _put(None)  # sentinel — consumer relies on this to know the run ended


async def run_tool_streaming(
    *,
    tool_name: str,
    args: str,
    target: str,
    settings: Settings,
    line_queue: asyncio.Queue,
    run_id: Optional[str] = None,
) -> ToolRunResult:
    """Run a tool and stream its output line-by-line onto line_queue.

    Each item is an output line (str); a final `None` marks completion.
    Returns the ToolRunResult once the process exits.
    """
    loop = asyncio.get_running_loop()
    return await asyncio.to_thread(
        _stream_tool_sync,
        tool_name=tool_name,
        args=args,
        target=target,
        settings=settings,
        run_id=run_id,
        loop=loop,
        line_queue=line_queue,
    )

