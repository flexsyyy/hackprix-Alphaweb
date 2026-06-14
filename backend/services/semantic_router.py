"""Semantic tool routing using sentence-transformer embeddings.

Uses BAAI/bge-small-en-v1.5 to embed tool descriptions and user queries,
then ranks tools by cosine similarity.

Embeddings generated once at startup and cached in memory.
Falls back to keyword matcher when top confidence < threshold.
No external API calls.
"""
from __future__ import annotations

import logging
from typing import Dict, List, Optional, Tuple

import numpy as np

logger = logging.getLogger("orchestrator")

_model = None
_tool_embeddings: Dict[str, np.ndarray] = {}
_tool_texts: Dict[str, str] = {}
_initialized = False


def _load_model():
    global _model
    if _model is not None:
        return _model
    try:
        from sentence_transformers import SentenceTransformer
        logger.info("Loading BAAI/bge-small-en-v1.5 for semantic routing…")
        _model = SentenceTransformer("BAAI/bge-small-en-v1.5")
        logger.info("Semantic router model loaded.")
    except Exception as e:
        logger.warning(f"Semantic router unavailable (sentence-transformers not installed?): {e}")
        _model = None
    return _model


def _cosine(a: np.ndarray, b: np.ndarray) -> float:
    na, nb = np.linalg.norm(a), np.linalg.norm(b)
    if na == 0 or nb == 0:
        return 0.0
    return float(np.dot(a, b) / (na * nb))


def initialize(tool_specs: Dict) -> None:
    """Generate and cache embeddings for all tools. Called once at startup."""
    global _initialized
    if _initialized:
        return

    model = _load_model()
    if model is None:
        return

    for name, spec in tool_specs.items():
        desc = f"{spec.capability}. Example: {spec.example}"
        if spec.keywords:
            desc += f". Keywords: {', '.join(spec.keywords)}"
        _tool_texts[name] = desc

    if not _tool_texts:
        return

    names = list(_tool_texts.keys())
    texts = [_tool_texts[n] for n in names]

    try:
        embeddings = model.encode(texts, normalize_embeddings=True, show_progress_bar=False)
        for i, name in enumerate(names):
            _tool_embeddings[name] = embeddings[i]
        _initialized = True
        logger.info(f"Semantic router: cached embeddings for {len(names)} tools.")
    except Exception as e:
        logger.warning(f"Failed to cache tool embeddings: {e}")


def is_available() -> bool:
    return _model is not None and bool(_tool_embeddings)


def select_tools(query: str, top_k: int = 3) -> List[Tuple[str, float]]:
    """Return top-k (tool_name, confidence) sorted by cosine similarity.

    Returns [] if model unavailable or embeddings not cached.
    """
    if not is_available():
        return []
    try:
        q_emb = _model.encode([query], normalize_embeddings=True, show_progress_bar=False)[0]
        scores: List[Tuple[str, float]] = [
            (name, _cosine(q_emb, emb))
            for name, emb in _tool_embeddings.items()
        ]
        scores.sort(key=lambda x: x[1], reverse=True)
        return scores[:top_k]
    except Exception as e:
        logger.warning(f"Semantic select_tools failed: {e}")
        return []


# Command template registry — mirrors the TOOL_COMMANDS in SideBar.jsx
# Each entry: {id, label, desc, args}
COMMAND_TEMPLATES: Dict[str, List[Dict]] = {
    "nmap": [
        {"id": "basic",    "label": "Basic scan",      "desc": "Scan common ports",              "args": ""},
        {"id": "sV",       "label": "Service detect",  "desc": "Detect services and versions",   "args": "-sV"},
        {"id": "aggr",     "label": "Aggressive",      "desc": "OS, services, scripts, traceroute", "args": "-A"},
        {"id": "allports", "label": "All ports",        "desc": "Scan all 65535 TCP ports",       "args": "-p-"},
        {"id": "vuln",     "label": "Vuln scripts",     "desc": "Run vulnerability NSE scripts",  "args": "--script vuln"},
    ],
    "masscan": [
        {"id": "web",      "label": "Web ports",       "desc": "Scan ports 80 and 443",          "args": "-p80,443"},
        {"id": "allports", "label": "All ports",        "desc": "Full port range",                "args": "-p1-65535"},
        {"id": "rate",     "label": "Rate limited",     "desc": "Throttle to 1000 pps",           "args": "--rate 1000"},
    ],
    "nikto": [
        {"id": "basic",    "label": "Basic scan",      "desc": "Basic web scan",                 "args": "-h"},
        {"id": "ssl",      "label": "HTTPS",           "desc": "Force HTTPS scanning",           "args": "-h -ssl"},
        {"id": "verbose",  "label": "Verbose",         "desc": "Verbose output",                 "args": "-h -Display V"},
    ],
    "sqlmap": [
        {"id": "basic",    "label": "Basic test",      "desc": "Test URL for SQLi",              "args": "-u"},
        {"id": "dbs",      "label": "Enum databases",  "desc": "Enumerate databases",            "args": "--dbs -u"},
        {"id": "batch",    "label": "Non-interactive", "desc": "Auto-confirm all prompts",       "args": "--batch -u"},
    ],
    "ffuf": [
        {"id": "dir",      "label": "Dir discovery",   "desc": "Directory brute force",          "args": "-w /wordlists/common.txt -u"},
        {"id": "mc200",    "label": "Filter 200 only", "desc": "Only 200 responses",             "args": "-mc 200 -w /wordlists/common.txt -u"},
        {"id": "recurse",  "label": "Recursive",       "desc": "Recursive discovery",            "args": "-recursion -w /wordlists/common.txt -u"},
    ],
    "gobuster": [
        {"id": "dir",      "label": "Dir bruteforce",  "desc": "Directory brute force",          "args": "dir -w /wordlists/common.txt -u"},
        {"id": "dns",      "label": "DNS subdomains",  "desc": "Subdomain enumeration",          "args": "dns -w /wordlists/common.txt -d"},
        {"id": "ext",      "label": "With extensions", "desc": "Search file extensions",         "args": "dir -x php,txt,html -w /wordlists/common.txt -u"},
    ],
    "nuclei": [
        {"id": "basic",    "label": "Basic scan",      "desc": "Scan target",                    "args": "-u"},
        {"id": "cves",     "label": "CVE templates",   "desc": "Run CVE templates",              "args": "-t cves/ -u"},
        {"id": "critical", "label": "Critical/High",   "desc": "High severity only",             "args": "-severity critical,high -u"},
    ],
    "subfinder": [
        {"id": "basic",    "label": "Enumerate",       "desc": "Passive subdomain enum",         "args": "-d"},
        {"id": "all",      "label": "All sources",     "desc": "Use all sources (slower)",       "args": "-all -d"},
        {"id": "recursive","label": "Recursive",       "desc": "Recursive subdomain enum",       "args": "-recursive -d"},
    ],
    "amass": [
        {"id": "passive",  "label": "Passive enum",    "desc": "Passive enumeration",            "args": "enum -passive -d"},
        {"id": "active",   "label": "Active enum",     "desc": "Active enumeration",             "args": "enum -d"},
        {"id": "intel",    "label": "Intelligence",    "desc": "Intelligence gathering",         "args": "intel -d"},
    ],
    "theharvester": [
        {"id": "all",      "label": "All sources",     "desc": "Search all sources",             "args": "-b all -l 100 -d"},
        {"id": "google",   "label": "Google only",     "desc": "Google source only",             "args": "-b google -d"},
        {"id": "extended", "label": "Extended (500)",  "desc": "Extended result limit",          "args": "-b all -l 500 -d"},
    ],
    "wpscan": [
        {"id": "basic",    "label": "Basic scan",      "desc": "Basic WordPress scan",           "args": "--url"},
        {"id": "plugins",  "label": "Enum plugins",    "desc": "Plugin enumeration",             "args": "--enumerate p --url"},
        {"id": "users",    "label": "Enum users",      "desc": "User enumeration",               "args": "--enumerate u --url"},
    ],
    "wapiti": [
        {"id": "basic",    "label": "Full scan",       "desc": "Full web app scan",              "args": "-u"},
        {"id": "sql",      "label": "SQLi only",       "desc": "SQL injection only",             "args": "-m sql -u"},
        {"id": "xss",      "label": "XSS only",        "desc": "Cross-site scripting only",      "args": "-m xss -u"},
    ],
    "commix": [
        {"id": "basic",    "label": "Basic test",      "desc": "Test URL for cmdi",              "args": "--batch --url"},
        {"id": "crawl",    "label": "Crawl depth 2",   "desc": "Crawl website first",            "args": "--batch --crawl=2 --url"},
    ],
    "trivy": [
        {"id": "image",    "label": "Image scan",      "desc": "Scan container image",           "args": "image"},
        {"id": "fs",       "label": "Filesystem",      "desc": "Scan filesystem",                "args": "fs"},
        {"id": "high",     "label": "High/Critical",   "desc": "Filter findings",                "args": "image --severity HIGH,CRITICAL"},
    ],
    "gitleaks": [
        {"id": "detect",   "label": "Detect secrets",  "desc": "Scan repository",                "args": "detect"},
        {"id": "git",      "label": "Git history",     "desc": "Scan full git history",          "args": "git"},
        {"id": "verbose",  "label": "Verbose",         "desc": "Verbose output",                 "args": "detect --verbose"},
    ],
    "testssl": [
        {"id": "full",     "label": "Full scan",       "desc": "Complete TLS audit",             "args": ""},
        {"id": "fast",     "label": "Fast scan",       "desc": "Quick scan mode",                "args": "--fast"},
        {"id": "vulns",    "label": "TLS vulns",       "desc": "Known TLS vulnerabilities",      "args": "--vulnerable"},
    ],
    "httpx": [
        {"id": "full",     "label": "Full probe",      "desc": "Probe + tech detect",            "args": "-silent -status-code -title -tech-detect -u"},
        {"id": "status",   "label": "Status codes",    "desc": "HTTP status only",               "args": "-status-code -u"},
        {"id": "tech",     "label": "Tech detect",     "desc": "Technology detection",           "args": "-tech-detect -title -u"},
    ],
}


def select_command(tool_name: str, query: str) -> Optional[Dict]:
    """Semantically select best command variant for a tool against the user's query.

    Returns the best matching command dict or the default (first) if unavailable.
    """
    commands = COMMAND_TEMPLATES.get(tool_name)
    if not commands:
        return None

    if not is_available():
        return commands[0]

    try:
        cmd_texts = [f"{c['label']}: {c['desc']}" for c in commands]
        cmd_embs = _model.encode(cmd_texts, normalize_embeddings=True, show_progress_bar=False)
        q_emb = _model.encode([query], normalize_embeddings=True, show_progress_bar=False)[0]

        best_idx, best_score = 0, -1.0
        for i, emb in enumerate(cmd_embs):
            score = _cosine(q_emb, emb)
            if score > best_score:
                best_score = score
                best_idx = i
        return commands[best_idx]
    except Exception as e:
        logger.warning(f"select_command failed for {tool_name}: {e}")
        return commands[0]
