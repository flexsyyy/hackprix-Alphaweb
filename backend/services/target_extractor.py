"""Target extraction, type detection, normalization, and tool capability validation.

Pipeline: extract target from input → detect type → validate vs tool capability
registry → normalize to the form the tool expects.
"""
from __future__ import annotations

import ipaddress
import re
from enum import Enum
from typing import Tuple
from urllib.parse import urlparse


class TargetType(str, Enum):
    DOMAIN   = "domain"
    URL      = "url"
    IP       = "ip"
    CIDR     = "cidr"
    FILE_PATH = "file_path"
    REPO_PATH = "repo_path"
    UNKNOWN  = "unknown"


# ── Tool capability registry ──────────────────────────────────────────────────
# Maps tool name → accepted TargetType tuple. Order matters: first = preferred.

TOOL_CAPABILITY_REGISTRY: dict[str, tuple[TargetType, ...]] = {
    # Domain-only tools
    "subfinder":    (TargetType.DOMAIN,),
    "amass":        (TargetType.DOMAIN,),
    "theharvester": (TargetType.DOMAIN,),
    "subdominator": (TargetType.DOMAIN,),
    # URL-required tools
    "ffuf":         (TargetType.URL,),
    "sqlmap":       (TargetType.URL,),
    "wpscan":       (TargetType.URL,),
    "commix":       (TargetType.URL,),
    "wapiti":       (TargetType.URL,),
    "cewl":         (TargetType.URL,),
    "curl":         (TargetType.URL,),
    # URL or domain
    "gobuster":     (TargetType.URL, TargetType.DOMAIN),
    "nuclei":       (TargetType.URL, TargetType.DOMAIN),
    "httpx":        (TargetType.URL, TargetType.DOMAIN, TargetType.IP),
    # Domain/IP/CIDR
    "nmap":         (TargetType.DOMAIN, TargetType.IP, TargetType.CIDR),
    "nikto":        (TargetType.DOMAIN, TargetType.URL, TargetType.IP),
    "testssl":      (TargetType.DOMAIN, TargetType.URL, TargetType.IP),
    "hydra":        (TargetType.DOMAIN, TargetType.IP),
    # IP/CIDR only
    "masscan":      (TargetType.IP, TargetType.CIDR),
    # Repo/file path
    "gitleaks":     (TargetType.REPO_PATH, TargetType.FILE_PATH),
    "john":         (TargetType.FILE_PATH,),
    "hashcat":      (TargetType.FILE_PATH,),
    # These accept anything (keyword search / interface / image name)
    "tcpdump":      (TargetType.UNKNOWN,),
    "searchsploit": (TargetType.UNKNOWN,),
    "trivy":        (TargetType.UNKNOWN,),
}

# ── Regexes ───────────────────────────────────────────────────────────────────

_URL_RE    = re.compile(r'^https?://', re.IGNORECASE)
_CIDR_RE   = re.compile(r'^\d{1,3}(\.\d{1,3}){3}/\d{1,2}$')
_IPV4_RE   = re.compile(r'^\d{1,3}(\.\d{1,3}){3}$')
_DOMAIN_RE = re.compile(r'^([a-zA-Z0-9]([a-zA-Z0-9\-]*[a-zA-Z0-9])?\.)+[a-zA-Z]{2,}$')
_PATH_RE   = re.compile(r'^(/|\.{1,2}/|[A-Za-z]:\\|~/).*')
_REPO_RE   = re.compile(r'(\.git$|github\.com|gitlab\.com|bitbucket\.org)')


def detect_target_type(target: str) -> TargetType:
    t = target.strip()
    if _REPO_RE.search(t):
        return TargetType.REPO_PATH
    if _URL_RE.match(t):
        return TargetType.URL
    if _CIDR_RE.match(t):
        try:
            ipaddress.ip_network(t, strict=False)
            return TargetType.CIDR
        except ValueError:
            pass
    if _IPV4_RE.match(t):
        try:
            ipaddress.ip_address(t)
            return TargetType.IP
        except ValueError:
            pass
    if _PATH_RE.match(t):
        return TargetType.FILE_PATH
    if _DOMAIN_RE.match(t):
        return TargetType.DOMAIN
    return TargetType.UNKNOWN


def _url_to_domain(url: str) -> str:
    """Extract bare domain (no port) from a URL."""
    try:
        parsed = urlparse(url)
        netloc = parsed.netloc or parsed.path
        return netloc.split(':')[0]
    except Exception:
        return url


def normalize_target(target: str, tool: str) -> Tuple[str, TargetType]:
    """Return (normalized_target, detected_type) suitable for the tool.

    Converts automatically when safe:
      URL → domain for domain-only tools
      www.example.com → example.com for subdomain tools
    """
    t = target.strip()
    detected = detect_target_type(t)
    accepted = TOOL_CAPABILITY_REGISTRY.get(tool, ())

    if not accepted:
        return t, detected

    # UNKNOWN tools accept anything
    if TargetType.UNKNOWN in accepted:
        return t, detected

    # URL → domain conversion for tools that want domain but got URL
    if detected == TargetType.URL:
        domain = _url_to_domain(t)
        if TargetType.URL in accepted:
            return t, TargetType.URL        # tool accepts URL — keep as-is
        if TargetType.DOMAIN in accepted:
            return domain, TargetType.DOMAIN  # auto-convert
        if TargetType.IP in accepted:
            return domain, TargetType.DOMAIN  # best effort

    # Strip www. for pure subdomain/root-domain tools
    if detected == TargetType.DOMAIN and t.startswith("www."):
        stripped = t[4:]
        if TargetType.DOMAIN in accepted:
            return stripped, TargetType.DOMAIN

    return t, detected


def validate_target_for_tool(target: str, tool: str) -> Tuple[bool, str, str]:
    """Validate target against tool capability registry.

    Returns (is_valid, normalized_target, error_message).
    Empty error_message on success.
    """
    if not target:
        return False, target, "No target provided."

    normalized, detected = normalize_target(target, tool)
    accepted = TOOL_CAPABILITY_REGISTRY.get(tool)

    # Tool not in registry — pass through without validation
    if accepted is None:
        return True, normalized, ""

    if TargetType.UNKNOWN in accepted:
        return True, normalized, ""

    if detected in accepted:
        return True, normalized, ""

    # After normalization, re-check
    _, renorm_type = normalize_target(normalized, tool)
    if renorm_type in accepted:
        return True, normalized, ""

    expected = ", ".join(tt.value for tt in accepted)
    example  = _example(accepted[0])
    return (
        False,
        target,
        f"`{tool}` requires target type [{expected}], got [{detected.value}]. "
        f"Example: {example}",
    )


def _example(t: TargetType) -> str:
    return {
        TargetType.DOMAIN:    "example.com",
        TargetType.URL:       "https://example.com/login",
        TargetType.IP:        "192.168.1.1",
        TargetType.CIDR:      "192.168.1.0/24",
        TargetType.FILE_PATH: "/path/to/hashes.txt",
        TargetType.REPO_PATH: "/path/to/repo  or  https://github.com/user/repo",
    }.get(t, "")
