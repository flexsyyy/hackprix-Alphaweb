"""Layer 1 — Gemma execution agent (via Ollama).

Picks which tool(s) to run from a natural-language request. This is the
"brain" that replaces brittle keyword matching for tool SELECTION.

Anti-hallucination contract (every output is constrained, never trusted raw):
  1. Ollama is asked for a JSON object (`format: json`).
  2. Every tool name returned MUST exist in TOOL_SPECS — unknown names are
     dropped, never executed.
  3. Parameters are whitelisted to {ports, port} — the model cannot inject
     arbitrary docker/CLI flags.
  4. If nothing valid survives, or confidence is low, callers fall back to
     deterministic keyword detection. The model can never run a tool that
     isn't in the registry.
"""
from __future__ import annotations

import json
import logging
import re
import urllib.error
import urllib.request
from typing import Any, Dict, List, Optional

from config import Settings
from services.tool_specs import TOOL_SPECS, gemma_tool_catalog

logger = logging.getLogger("orchestrator")

# Only these param keys are accepted from the model. Anything else is ignored.
_ALLOWED_PARAM_KEYS = {"ports", "port"}

_SELECT_SYSTEM = (
    "You are a cybersecurity tool router. Given a user's request, choose which "
    "security tools to run, in order. Pick ONLY from the catalog below. "
    "Never invent a tool name.\n"
    "Pick the SINGLE best tool. Only return more than one tool if the request "
    "EXPLICITLY asks for multiple distinct actions (e.g. 'scan ports AND check TLS'). "
    "If the user names a specific tool (or its alias), return exactly that one tool "
    "and nothing else. Do not add extra tools the user did not ask for.\n\n"
    "Tool catalog:\n{catalog}\n\n"
    "Respond with ONLY a JSON object, no prose, no markdown:\n"
    '{{"tools": [{{"name": "<exact tool name from catalog>", "reason": "<=12 words"}}], '
    '"confidence": <0.0-1.0>}}\n'
    'If no tool fits, return {{"tools": [], "confidence": 0.0}}.'
)
# NOTE: We deliberately do NOT ask the model to judge "safety". Small models
# over-flag benign scans. Real safety is enforced deterministically upstream:
# validate_target_enhanced() blocks private/internal/localhost targets and
# DANGEROUS_FLAGS blocks destructive flags — before any tool executes.


class GemmaClient:
    """Talks to a local Ollama server running a Gemma model."""

    def __init__(self, settings: Settings) -> None:
        self._settings = settings
        self._catalog = gemma_tool_catalog()
        self._system = _SELECT_SYSTEM.format(catalog=self._catalog)

    # ---- availability ----

    def is_available(self) -> bool:
        if not self._settings.GEMMA_ENABLED:
            return False
        try:
            req = urllib.request.Request(f"{self._settings.OLLAMA_URL}/api/tags")
            with urllib.request.urlopen(req, timeout=2) as resp:
                data = json.loads(resp.read())
            names = {m.get("name", "") for m in data.get("models", [])}
            # accept exact or family match (e.g. "gemma3:4b" or "gemma3:4b-instruct")
            want = self._settings.GEMMA_MODEL
            return want in names or any(n.split(":")[0] == want.split(":")[0] for n in names)
        except Exception as e:
            logger.info(f"Gemma/Ollama not available: {e}")
            return False

    def warmup(self) -> bool:
        """Load the model into memory so the first real request isn't cold.

        Ollama lazy-loads on first inference (can take >30s). Calling this at
        startup absorbs that latency before any user request arrives.
        """
        if not self._settings.GEMMA_ENABLED or not self.is_available():
            return False
        payload = json.dumps({
            "model": self._settings.GEMMA_MODEL,
            "messages": [{"role": "user", "content": "ok"}],
            "stream": False,
            "options": {"num_predict": 1, "num_gpu": self._settings.GEMMA_NUM_GPU},
        }).encode()
        req = urllib.request.Request(
            f"{self._settings.OLLAMA_URL}/api/chat",
            data=payload, headers={"Content-Type": "application/json"},
        )
        try:
            with urllib.request.urlopen(req, timeout=120) as resp:
                resp.read()
            logger.info(f"Gemma warmed up ({self._settings.GEMMA_MODEL})")
            return True
        except Exception as e:
            logger.warning(f"Gemma warmup failed: {e}")
            return False

    # ---- low-level call ----

    def _chat_json(self, system: str, user: str) -> Optional[Dict[str, Any]]:
        payload = json.dumps({
            "model": self._settings.GEMMA_MODEL,
            "messages": [
                {"role": "system", "content": system},
                {"role": "user", "content": user},
            ],
            "stream": False,
            "format": "json",
            "options": {
                "temperature": self._settings.GEMMA_TEMPERATURE,
                "num_gpu": self._settings.GEMMA_NUM_GPU,
            },
        }).encode()

        req = urllib.request.Request(
            f"{self._settings.OLLAMA_URL}/api/chat",
            data=payload,
            headers={"Content-Type": "application/json"},
        )
        try:
            with urllib.request.urlopen(req, timeout=self._settings.GEMMA_TIMEOUT_SECS) as resp:
                data = json.loads(resp.read())
            content = data.get("message", {}).get("content", "")
            return self._parse_json(content)
        except (urllib.error.URLError, TimeoutError) as e:
            logger.warning(f"Gemma call failed: {e}")
            return None
        except Exception as e:
            logger.warning(f"Gemma unexpected error: {e}")
            return None

    @staticmethod
    def _parse_json(text: str) -> Optional[Dict[str, Any]]:
        text = (text or "").strip()
        if not text:
            return None
        # format:json should give clean JSON, but guard against fences/prose.
        start, end = text.find("{"), text.rfind("}") + 1
        if start < 0 or end <= start:
            return None
        try:
            return json.loads(text[start:end])
        except json.JSONDecodeError:
            return None

    # ---- public API ----

    def select_tools(self, request: str, target: str) -> Optional[Dict[str, Any]]:
        """Return a validated selection or None if the model gave nothing usable.

        Shape: {"tools": [{"tool": str, "parameters": {}, "rationale": str}],
                "confidence": float, "safe": bool}
        Every tool name is guaranteed to be in TOOL_SPECS.
        """
        user = f"target: {target}\nrequest: {request}"
        raw = self._chat_json(self._system, user)
        if not raw or not isinstance(raw.get("tools"), list):
            return None

        validated: List[Dict[str, Any]] = []
        seen: set = set()
        for entry in raw["tools"]:
            if not isinstance(entry, dict):
                continue
            name = str(entry.get("name", "")).strip().lower()
            # HARD GATE: drop any name not in the registry — no hallucinated tools.
            if name not in TOOL_SPECS or name in seen:
                continue
            seen.add(name)
            validated.append({
                "tool": name,
                "parameters": self._clean_params(entry.get("parameters")),
                "rationale": str(entry.get("reason", entry.get("rationale", "")))[:120],
            })

        if not validated:
            return None

        try:
            confidence = float(raw.get("confidence", 0.0))
        except (TypeError, ValueError):
            confidence = 0.0

        return {
            "tools": validated,
            "confidence": max(0.0, min(1.0, confidence)),
            # Safety is enforced upstream by target/flag validators, not by the
            # routing model. Always True here so benign scans aren't dropped.
            "safe": True,
        }

    @staticmethod
    def _clean_params(params: Any) -> Dict[str, Any]:
        """Keep only whitelisted, well-formed params. Blocks flag injection."""
        out: Dict[str, Any] = {}
        if not isinstance(params, dict):
            return out
        ports = params.get("ports") or params.get("port")
        if ports is not None:
            pstr = str(ports).strip()
            # numbers, commas, ranges only
            if pstr and re.fullmatch(r"[0-9,\- ]+", pstr):
                out["ports"] = pstr
        return out


# module-level singleton
_gemma: Optional[GemmaClient] = None


def get_gemma(settings: Settings) -> GemmaClient:
    global _gemma
    if _gemma is None:
        _gemma = GemmaClient(settings)
    return _gemma
