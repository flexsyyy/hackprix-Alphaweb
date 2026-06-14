"""Central tool specification registry — single source of truth for all 25 tools.

Every layer reads from here:
  - Gemma (Layer 1) builds its selection prompt from `capability` + `example`.
  - The docker arg builders read `default_args` / `target_mode`.
  - precheck reads `needs_input`.

Keeping one registry means a tool's command shape is defined exactly once,
so "listing of each command of every single tool" stays consistent and a
model can never invent a tool or an unsupported flag — anything not here is
rejected upstream.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Dict, List, Optional


# target_mode values:
#   "url"   -> needs http(s):// scheme (web tools)
#   "host"  -> bare hostname/IP, scheme/path/port stripped
#   "ip"    -> resolved literal IP (masscan)
#   "root"  -> bare root domain, strip leading www. (subdomain tools)
#   "file"  -> a filename mounted into the container (john)
#   "iface" -> a network interface name (tcpdump)
@dataclass(frozen=True)
class ToolSpec:
    name: str
    capability: str                 # one-line human description (used in Gemma prompt)
    default_args: str               # flags emitted BEFORE the positional target
    target_mode: str = "host"
    # If set, the tool cannot run against a bare domain in the chat/scan flow;
    # this message is surfaced instead. (hydra/hashcat/john/gitleaks).
    needs_input: Optional[str] = None
    # Capability keywords for the deterministic keyword fallback.
    keywords: List[str] = field(default_factory=list)
    # A concrete example shown to Gemma so it learns the intent → tool mapping.
    example: str = ""
    # Other names users type for this tool (shown to the router so a synonym
    # maps to the registry tool instead of defaulting to nmap).
    aliases: List[str] = field(default_factory=list)


_SPECS: List[ToolSpec] = [
    ToolSpec("nmap", "port scanning, service/version detection, OS fingerprinting",
             "-sV -F", "host",
             keywords=["port", "service", "scan port", "os fingerprint", "open ports"],
             example="scan a host for open ports and running services"),
    ToolSpec("masscan", "very fast mass port scanning across large ranges",
             "-p1-1000 --rate=500", "ip",
             keywords=["mass scan", "fast scan", "fast port"],
             example="quickly sweep a network for open ports"),
    ToolSpec("nikto", "web server misconfiguration and vulnerability scanning",
             "-h", "host",
             keywords=["web server vuln", "web server", "nikto scan"],
             example="scan a web server for known vulnerabilities and misconfigs"),
    ToolSpec("sqlmap", "SQL injection testing and database enumeration",
             "--batch --dbs -u", "url",
             keywords=["sql injection", "sqli", "database dump", "dump database"],
             example="test a URL parameter for SQL injection"),
    ToolSpec("ffuf", "web fuzzing — endpoint, directory and parameter discovery",
             "", "url",
             keywords=["fuzz", "endpoint discovery", "parameter discovery"],
             example="fuzz a web app for hidden endpoints"),
    ToolSpec("gobuster", "directory brute-forcing and DNS enumeration",
             "dir -w /wordlists/common.txt -u", "url",
             keywords=["directory", "dir brute", "directory brute", "dns enum"],
             example="brute-force directories on a website"),
    ToolSpec("john", "password hash cracking from a hash file",
             "", "file",
             needs_input="john needs a hash file (and optional wordlist) mounted. Use /execute with explicit args.",
             keywords=["crack hash", "john the ripper"],
             example="crack a password hash file"),
    ToolSpec("hydra", "online credential brute-forcing against network services",
             "", "host",
             needs_input="hydra needs -l <user> -P <wordlist> <service>://<target>. Use /execute with explicit args.",
             keywords=["brute force login", "credential brute", "password brute"],
             example="brute-force login credentials on a service"),
    ToolSpec("curl", "HTTP requests, header inspection, API probing",
             "-sv", "url",
             keywords=["http request", "api request", "headers", "inspect headers"],
             example="fetch HTTP response headers from a URL"),
    ToolSpec("tcpdump", "network packet capture on an interface",
             "-c 20", "iface",
             keywords=["packet capture", "sniff traffic", "capture packets"],
             example="capture network packets on an interface"),
    ToolSpec("nuclei", "template-based vulnerability and CVE scanning",
             "-u", "url",
             keywords=["cve scan", "template scan", "nuclei scan", "known vulnerabilities"],
             example="run template-based CVE detection against a URL"),
    ToolSpec("hashcat", "GPU-accelerated password hash cracking",
             "", "file",
             needs_input="hashcat needs a hash mode (-m), a hash file and a wordlist. Use /execute with explicit args.",
             keywords=["gpu crack", "hashcat"],
             example="crack hashes with GPU acceleration"),
    ToolSpec("gitleaks", "git repository secret and credential leak scanning",
             "detect", "host",
             needs_input="gitleaks scans a local git repo path, not a domain. Use /execute pointing at a cloned repo.",
             keywords=["secret scan", "leaked credentials", "git secrets", "find secrets"],
             example="scan a git repo for leaked secrets"),
    ToolSpec("theharvester", "OSINT email, subdomain and host harvesting",
             "-b all -l 100 -d", "root",
             keywords=["osint", "harvest emails", "email harvest", "gather emails"],
             example="harvest emails and subdomains for a domain from public sources"),
    ToolSpec("subfinder", "passive subdomain enumeration across many DNS sources",
             "-d", "root",
             keywords=["subdomain enum", "find subdomains", "enumerate subdomains",
                       "subfinder", "subdomain"],
             example="enumerate subdomains of a domain",
             aliases=["sublist3r"]),
    ToolSpec("testssl", "TLS/SSL configuration, cipher and certificate auditing",
             "", "host",
             keywords=["tls", "ssl", "cipher", "certificate", "ssl config"],
             example="audit the TLS/SSL configuration of a host"),
    ToolSpec("wapiti", "web application vulnerability scanner (SQLi, XSS, SSRF, LFI)",
             "-u", "url",
             keywords=["web vuln scan", "web application scan", "xss scan"],
             example="run a full web application vulnerability scan"),
    ToolSpec("wpscan", "WordPress vulnerability, plugin and user scanning",
             "--url", "url",
             keywords=["wordpress", "wp scan", "wordpress vuln"],
             example="scan a WordPress site for vulnerabilities"),
    ToolSpec("cewl", "custom wordlist generation by spidering a site",
             "", "url",
             keywords=["wordlist", "generate wordlist", "spider site"],
             example="generate a wordlist by crawling a website"),
    ToolSpec("trivy", "container image and filesystem vulnerability scanning",
             "image", "host",
             keywords=["container scan", "image scan", "docker image vuln"],
             example="scan a container image for vulnerabilities"),
    ToolSpec("amass", "in-depth DNS enumeration and attack-surface mapping",
             "enum -passive -d", "root",
             keywords=["asset discovery", "attack surface", "dns mapping"],
             example="map the attack surface and assets of a domain"),
    ToolSpec("commix", "automated command injection detection",
             "--batch --url", "url",
             keywords=["command injection", "cmdi", "os command injection"],
             example="test a URL parameter for command injection"),
    ToolSpec("searchsploit", "offline Exploit-DB search for known exploits",
             "", "host",
             keywords=["exploit search", "exploitdb", "find exploit", "known exploit"],
             example="search Exploit-DB for exploits matching a service"),
    ToolSpec("subdominator", "passive subdomain takeover detection",
             "-d", "root",
             keywords=["subdomain takeover", "takeover", "dangling dns"],
             example="check a domain for subdomain takeover"),
    ToolSpec("httpx", "fast HTTP probing, status codes and tech fingerprinting",
             "-silent -status-code -title -tech-detect -u", "url",
             keywords=["http probe", "web probe", "fingerprint", "tech detect"],
             example="probe hosts and fingerprint their web tech stack"),
]

TOOL_SPECS: Dict[str, ToolSpec] = {s.name: s for s in _SPECS}


def all_tool_names() -> List[str]:
    return list(TOOL_SPECS.keys())


def gemma_tool_catalog() -> str:
    """Numbered catalog for the Gemma selection prompt — name, capability, example."""
    lines = []
    for i, s in enumerate(_SPECS, 1):
        alias = f' [also called: {", ".join(s.aliases)}]' if s.aliases else ""
        lines.append(f'{i}. {s.name} — {s.capability} (e.g. "{s.example}"){alias}')
    return "\n".join(lines)
