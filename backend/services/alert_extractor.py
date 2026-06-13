"""Alert extraction: scan tool output for findings and label them by severity."""
from __future__ import annotations

import re
from typing import Any, Dict, List

# Severity ordering — higher rank sorts first.
SEVERITY_RANK = {"critical": 5, "high": 4, "medium": 3, "low": 2, "info": 1}


def _alert(tool: str, severity: str, title: str) -> Dict[str, str]:
    return {"tool": tool, "severity": severity, "title": title.strip()[:200]}


def _nuclei_alerts(tool: str, out: str) -> List[Dict[str, str]]:
    alerts = []
    # [template-id] [protocol] [severity] target
    pat = re.compile(
        r"\[([^\]]+)\]\s*\[[^\]]+\]\s*\[(critical|high|medium|low|info|unknown)\]\s*(\S+)",
        re.I,
    )
    for m in pat.finditer(out):
        sev = m.group(2).lower()
        if sev == "unknown":
            sev = "info"
        alerts.append(_alert(tool, sev, f"{m.group(1)} — {m.group(3)}"))
    return alerts


def _nikto_alerts(tool: str, out: str) -> List[Dict[str, str]]:
    alerts = []
    for line in out.splitlines():
        line = line.strip()
        if not line.startswith("+ "):
            continue
        body = line[2:].strip()
        low = body.lower()
        if any(s in low for s in ("target ip", "target hostname", "target port",
                                  "start time", "ssl info", "server:", "no cgi")):
            continue
        if "vulnerable" in low or "osvdb" in low or re.search(r"cve-\d", low):
            sev = "medium"
        elif "header" in low and ("missing" in low or "suggested" in low):
            sev = "low"
        elif "interesting" in low or "might be" in low:
            sev = "low"
        else:
            sev = "info"
        alerts.append(_alert(tool, sev, body))
    return alerts


def _testssl_alerts(tool: str, out: str) -> List[Dict[str, str]]:
    alerts = []
    for line in out.splitlines():
        s = line.strip()
        if not s:
            continue
        # "VULNERABLE" but not "not vulnerable"
        if re.search(r"\bVULNERABLE\b", s) and not re.search(r"not\s+vulnerable", s, re.I):
            alerts.append(_alert(tool, "high", s[:160]))
        elif re.search(r"\b(POODLE|BEAST|FREAK|LOGJAM|DROWN|Heartbleed|ROBOT)\b", s, re.I) \
                and not re.search(r"not\s+vulnerable", s, re.I):
            alerts.append(_alert(tool, "medium", s[:160]))
    return alerts


def _sqlmap_alerts(tool: str, out: str) -> List[Dict[str, str]]:
    alerts = []
    low = out.lower()
    if "is vulnerable" in low or "injectable" in low or "injection point" in low:
        alerts.append(_alert(tool, "critical", "SQL injection vulnerability detected"))
    for m in re.finditer(r"available databases \[\d+\]:\s*([^\n]+)", out, re.I):
        alerts.append(_alert(tool, "high", f"Databases enumerated: {m.group(1).strip()}"))
    return alerts


def _commix_alerts(tool: str, out: str) -> List[Dict[str, str]]:
    if re.search(r"vulnerable to|command injection|injection point", out, re.I):
        return [_alert(tool, "critical", "Command injection vulnerability detected")]
    return []


def _gitleaks_alerts(tool: str, out: str) -> List[Dict[str, str]]:
    alerts = []
    m = re.search(r"(\d+)\s+leaks?\s+found", out, re.I)
    if m and int(m.group(1)) > 0:
        alerts.append(_alert(tool, "high", f"{m.group(1)} secret leak(s) found in repository"))
    return alerts


def _wpscan_alerts(tool: str, out: str) -> List[Dict[str, str]]:
    alerts = []
    for line in out.splitlines():
        s = line.strip()
        low = s.lower()
        if "vulnerabilit" in low and "[!]" in s:
            alerts.append(_alert(tool, "medium", s.lstrip("[!] ")[:160]))
        elif re.search(r"cve-\d", low):
            alerts.append(_alert(tool, "medium", s[:160]))
    return alerts


def _wapiti_alerts(tool: str, out: str) -> List[Dict[str, str]]:
    alerts = []
    cats = ("SQL Injection", "Cross Site Scripting", "XSS", "Command execution",
            "Path Traversal", "CRLF", "Server Side Request Forgery", "SSRF")
    for line in out.splitlines():
        s = line.strip()
        for c in cats:
            if c.lower() in s.lower() and ("found" in s.lower() or s.startswith("[")):
                sev = "high" if c.lower() in ("sql injection", "command execution") else "medium"
                alerts.append(_alert(tool, sev, s[:160]))
                break
    return alerts


def _port_alerts(tool: str, out: str) -> List[Dict[str, str]]:
    alerts = []
    # nmap: "80/tcp open http"
    for m in re.finditer(r"^(\d+)/(tcp|udp)\s+open\s+(\S+)(?:\s+(.+))?$", out, re.M):
        port, proto, svc, ver = m.group(1), m.group(2), m.group(3), m.group(4)
        title = f"Port {port}/{proto} open — {svc}" + (f" ({ver.strip()})" if ver else "")
        alerts.append(_alert(tool, "info", title))
    # masscan: "Discovered open port 80/tcp on 1.2.3.4"
    for m in re.finditer(r"Discovered open port (\d+)/(tcp|udp) on (\S+)", out):
        alerts.append(_alert(tool, "info", f"Port {m.group(1)}/{m.group(2)} open on {m.group(3)}"))
    return alerts


def _generic_cve_alerts(tool: str, out: str) -> List[Dict[str, str]]:
    alerts = []
    for m in re.finditer(r"\b(CVE-\d{4}-\d{4,7})\b", out):
        alerts.append(_alert(tool, "medium", f"{m.group(1)} referenced in output"))
    return alerts


_EXTRACTORS = {
    "nuclei": _nuclei_alerts,
    "nikto": _nikto_alerts,
    "testssl": _testssl_alerts,
    "sqlmap": _sqlmap_alerts,
    "commix": _commix_alerts,
    "gitleaks": _gitleaks_alerts,
    "wpscan": _wpscan_alerts,
    "wapiti": _wapiti_alerts,
    "nmap": _port_alerts,
    "masscan": _port_alerts,
}


def extract_alerts(tool_results: List[Dict[str, Any]]) -> List[Dict[str, str]]:
    """Scan each tool's output and return a severity-sorted list of alerts."""
    alerts: List[Dict[str, str]] = []
    for tr in tool_results:
        tool = (tr.get("tool") or "").lower()
        if tr.get("error"):
            continue
        out = tr.get("raw_output") or ""
        if not out.strip():
            continue
        extractor = _EXTRACTORS.get(tool)
        if extractor:
            alerts.extend(extractor(tool, out))
        else:
            alerts.extend(_generic_cve_alerts(tool, out))

    # De-duplicate, then sort by severity (highest first)
    seen = set()
    uniq: List[Dict[str, str]] = []
    for a in alerts:
        key = (a["tool"], a["severity"], a["title"])
        if key in seen:
            continue
        seen.add(key)
        uniq.append(a)

    uniq.sort(key=lambda a: SEVERITY_RANK.get(a["severity"], 0), reverse=True)
    return uniq


def severity_counts(alerts: List[Dict[str, str]]) -> Dict[str, int]:
    """Count alerts per severity label."""
    counts = {"critical": 0, "high": 0, "medium": 0, "low": 0, "info": 0}
    for a in alerts:
        sev = a.get("severity", "info")
        if sev in counts:
            counts[sev] += 1
    return counts
