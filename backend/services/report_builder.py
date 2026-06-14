"""Scan report builder: persists run results and renders an HTML report."""
from __future__ import annotations

import html
import json
import logging
import os
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

logger = logging.getLogger("orchestrator")


def _reports_dir(log_dir: str) -> str:
    path = os.path.join(log_dir, "reports")
    os.makedirs(path, exist_ok=True)
    return path


def save_report(log_dir: str, run_id: str, report: Dict[str, Any]) -> None:
    """Persist a report as JSON and rendered HTML under <log_dir>/reports/."""
    rdir = _reports_dir(log_dir)
    try:
        with open(os.path.join(rdir, f"{run_id}.json"), "w", encoding="utf-8") as f:
            json.dump(report, f, indent=2, ensure_ascii=False)
        with open(os.path.join(rdir, f"{run_id}.html"), "w", encoding="utf-8") as f:
            f.write(render_report_html(report))
    except Exception as e:
        logger.warning(f"save_report {run_id} failed: {e}")


def load_report(log_dir: str, run_id: str) -> Optional[Dict[str, Any]]:
    """Load a persisted report JSON, or None if it does not exist."""
    path = os.path.join(_reports_dir(log_dir), f"{run_id}.json")
    if not os.path.isfile(path):
        return None
    try:
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception as e:
        logger.warning(f"load_report {run_id} failed: {e}")
        return None


def load_report_html(log_dir: str, run_id: str) -> Optional[str]:
    """Load the rendered HTML report, rebuilding it from JSON if needed."""
    path = os.path.join(_reports_dir(log_dir), f"{run_id}.html")
    if os.path.isfile(path):
        try:
            with open(path, "r", encoding="utf-8") as f:
                return f.read()
        except Exception:
            pass
    data = load_report(log_dir, run_id)
    return render_report_html(data) if data else None


def list_report_ids(log_dir: str) -> List[str]:
    """Return run_ids of every persisted report, newest first."""
    rdir = _reports_dir(log_dir)
    try:
        files = [f for f in os.listdir(rdir) if f.endswith(".json")]
    except OSError:
        return []
    files.sort(key=lambda f: os.path.getmtime(os.path.join(rdir, f)), reverse=True)
    return [os.path.splitext(f)[0] for f in files]


def load_all_reports(log_dir: str) -> List[Dict[str, Any]]:
    """Load every persisted report JSON, newest first. Skips unreadable ones."""
    out: List[Dict[str, Any]] = []
    for run_id in list_report_ids(log_dir):
        data = load_report(log_dir, run_id)
        if data:
            out.append(data)
    return out


def delete_all_reports(log_dir: str) -> int:
    """Delete every persisted report (.json + .html). Returns files removed."""
    rdir = _reports_dir(log_dir)
    removed = 0
    try:
        names = os.listdir(rdir)
    except OSError:
        return 0
    for name in names:
        if name.endswith((".json", ".html")):
            try:
                os.remove(os.path.join(rdir, name))
                removed += 1
            except OSError:
                pass
    return removed


def build_report(
    *,
    run_id: str,
    target: str,
    prompt: str,
    tool_results: List[Dict[str, Any]],
    analysis: str,
    alerts: Optional[List[Dict[str, Any]]] = None,
) -> Dict[str, Any]:
    """Assemble a structured report dict from a completed run."""
    alerts = alerts or []
    return {
        "run_id": run_id,
        "target": target,
        "prompt": prompt,
        "analysis": analysis,
        "generated_at": datetime.now(timezone.utc).isoformat() + "Z",
        "tools": tool_results,
        "alerts": alerts,
        "summary": {
            "total_tools": len(tool_results),
            "succeeded": sum(1 for t in tool_results if t.get("exit_code") == 0),
            "failed": sum(1 for t in tool_results if t.get("exit_code") not in (0, None)),
            "total_alerts": len(alerts),
        },
    }


_CSS = """
:root { color-scheme: dark; }
* { box-sizing: border-box; }
body { margin: 0; background: #0d0d0f; color: #d4d4d8;
  font-family: 'JetBrains Mono', Consolas, Menlo, monospace; font-size: 13px; line-height: 1.55; }
.wrap { max-width: 960px; margin: 0 auto; padding: 32px 24px 64px; }
h1 { font-size: 20px; color: #f4f4f5; margin: 0 0 4px; }
h2 { font-size: 14px; color: #22d3ee; margin: 28px 0 10px;
  border-bottom: 1px solid #27272a; padding-bottom: 6px; }
.sub { color: #71717a; font-size: 12px; margin: 0 0 20px; }
.meta { display: grid; grid-template-columns: 140px 1fr; gap: 4px 14px;
  background: #18181b; border: 1px solid #27272a; border-radius: 8px; padding: 14px 18px; }
.meta dt { color: #71717a; }
.meta dd { margin: 0; color: #e4e4e7; word-break: break-all; }
.pills { display: flex; gap: 8px; flex-wrap: wrap; margin: 14px 0 0; }
.pill { border-radius: 5px; padding: 3px 10px; font-size: 11px; border: 1px solid; }
.pill--ok { color: #4ade80; border-color: #166534; background: rgba(74,222,128,0.08); }
.pill--fail { color: #f87171; border-color: #7f1d1d; background: rgba(248,113,113,0.08); }
.pill--tot { color: #22d3ee; border-color: #155e63; background: rgba(34,211,238,0.08); }
.analysis { background: #18181b; border: 1px solid #27272a; border-left: 3px solid #22d3ee;
  border-radius: 6px; padding: 14px 18px; white-space: pre-wrap; }
.tool { margin: 14px 0; border: 1px solid #27272a; border-radius: 8px; overflow: hidden; }
.tool__head { display: flex; align-items: center; gap: 10px;
  background: #18181b; padding: 9px 14px; border-bottom: 1px solid #27272a; }
.tool__name { color: #f4f4f5; font-weight: 600; text-transform: uppercase; letter-spacing: 0.04em; }
.tool__badge { font-size: 11px; padding: 2px 8px; border-radius: 4px; }
.tool__badge--ok { color: #4ade80; background: rgba(74,222,128,0.1); }
.tool__badge--fail { color: #f87171; background: rgba(248,113,113,0.1); }
.tool__time { color: #71717a; font-size: 11px; margin-left: auto; }
pre { margin: 0; padding: 14px; background: #0d0d0f; color: #a1a1aa;
  font-size: 12px; overflow-x: auto; white-space: pre-wrap; word-break: break-word; max-height: 480px; }
.foot { color: #52525b; font-size: 11px; margin-top: 40px; text-align: center; }
.alert { display: flex; align-items: baseline; gap: 10px; padding: 7px 12px;
  margin: 5px 0; border-radius: 6px; border-left: 3px solid; background: #18181b; }
.alert__sev { font-size: 10px; font-weight: 700; letter-spacing: 0.05em;
  text-transform: uppercase; min-width: 64px; }
.alert__tool { color: #71717a; font-size: 10px; min-width: 72px; }
.alert__title { color: #d4d4d8; font-size: 12px; word-break: break-word; }
.sev-critical { border-color: #dc2626; } .sev-critical .alert__sev { color: #f87171; }
.sev-high     { border-color: #ea580c; } .sev-high .alert__sev     { color: #fb923c; }
.sev-medium   { border-color: #ca8a04; } .sev-medium .alert__sev   { color: #facc15; }
.sev-low      { border-color: #2563eb; } .sev-low .alert__sev      { color: #60a5fa; }
.sev-info     { border-color: #4b5563; } .sev-info .alert__sev     { color: #9ca3af; }
"""


def render_report_html(report: Dict[str, Any]) -> str:
    """Render a structured report dict into a standalone HTML document."""
    if not report:
        return "<!doctype html><title>Report not found</title><h1>Report not found</h1>"

    e = html.escape
    summary = report.get("summary", {})
    tools = report.get("tools", [])
    alerts = report.get("alerts", [])

    alert_blocks: List[str] = []
    for a in alerts:
        sev = str(a.get("severity", "info")).lower()
        if sev not in ("critical", "high", "medium", "low", "info"):
            sev = "info"
        alert_blocks.append(
            f'<div class="alert sev-{sev}">'
            f'<span class="alert__sev">{e(sev)}</span>'
            f'<span class="alert__tool">{e(str(a.get("tool", "")))}</span>'
            f'<span class="alert__title">{e(str(a.get("title", "")))}</span>'
            f'</div>'
        )

    tool_blocks: List[str] = []
    for t in tools:
        tool = e(str(t.get("tool", "?")))
        exit_code = t.get("exit_code")
        ok = exit_code == 0
        badge_cls = "ok" if ok else "fail"
        badge_txt = "exit 0" if ok else f"exit {exit_code}"
        duration = t.get("duration")
        time_txt = f"{duration:.1f}s" if isinstance(duration, (int, float)) else ""
        body = t.get("error") or t.get("raw_output") or "(no output)"
        tool_blocks.append(
            f'<div class="tool">'
            f'<div class="tool__head">'
            f'<span class="tool__name">{tool}</span>'
            f'<span class="tool__badge tool__badge--{badge_cls}">{e(badge_txt)}</span>'
            f'<span class="tool__time">{e(time_txt)}</span>'
            f'</div>'
            f'<pre>{e(str(body))}</pre>'
            f'</div>'
        )

    return f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>AlphaWeb Scan Report — {e(str(report.get("target", "")))}</title>
<style>{_CSS}</style>
</head>
<body>
<div class="wrap">
  <h1>AlphaWeb Scan Report</h1>
  <p class="sub">Run {e(str(report.get("run_id", "")))}</p>

  <dl class="meta">
    <dt>Target</dt><dd>{e(str(report.get("target", "")))}</dd>
    <dt>Request</dt><dd>{e(str(report.get("prompt", "")))}</dd>
    <dt>Generated</dt><dd>{e(str(report.get("generated_at", "")))}</dd>
  </dl>

  <div class="pills">
    <span class="pill pill--tot">{summary.get("total_tools", 0)} tools run</span>
    <span class="pill pill--ok">{summary.get("succeeded", 0)} succeeded</span>
    <span class="pill pill--fail">{summary.get("failed", 0)} failed</span>
    <span class="pill pill--tot">{summary.get("total_alerts", len(alerts))} alerts</span>
  </div>

  <h2>Analysis</h2>
  <div class="analysis">{e(str(report.get("analysis", "No analysis available.")))}</div>

  <h2>Alerts &amp; Vulnerabilities</h2>
  {"".join(alert_blocks) if alert_blocks else "<p class='sub'>No alerts identified.</p>"}

  <h2>Tool Output</h2>
  {"".join(tool_blocks) if tool_blocks else "<p class='sub'>No tools were run.</p>"}

  <p class="foot">Generated by AlphaWeb — AI-Powered Cybersecurity Automation Platform</p>
</div>
</body>
</html>"""
