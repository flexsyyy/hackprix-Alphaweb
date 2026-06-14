import { useEffect, useRef, useState } from 'react'
import './ToolExecutionPanel.css'

const TOOL_COMMANDS = {
  nmap: [
    { id: 'basic',    label: 'Basic scan',      args: '',              desc: 'Scan common ports' },
    { id: 'sV',       label: 'Service detect',  args: '-sV',           desc: 'Detect services and versions' },
    { id: 'aggr',     label: 'Aggressive',      args: '-A',            desc: 'OS, services, scripts, traceroute' },
    { id: 'allports', label: 'All ports',        args: '-p-',           desc: 'Scan all 65535 TCP ports' },
    { id: 'vuln',     label: 'Vuln scripts',     args: '--script vuln', desc: 'Run NSE vulnerability scripts' },
  ],
  masscan: [
    { id: 'web',      label: 'Web ports',        args: '-p80,443',     desc: 'Scan ports 80 and 443' },
    { id: 'allports', label: 'All ports',         args: '-p1-65535',    desc: 'Full port range' },
    { id: 'rate',     label: 'Rate limited',      args: '--rate 1000',  desc: 'Throttle to 1000 pps' },
  ],
  nikto: [
    { id: 'basic',    label: 'Basic scan',       args: '-h',            desc: 'Basic web scan' },
    { id: 'ssl',      label: 'HTTPS',            args: '-h -ssl',       desc: 'Force HTTPS scanning' },
    { id: 'verbose',  label: 'Verbose',          args: '-h -Display V', desc: 'Verbose output' },
  ],
  sqlmap: [
    { id: 'basic',    label: 'Basic test',       args: '-u',            desc: 'Test URL for SQLi' },
    { id: 'dbs',      label: 'Enum databases',   args: '--dbs -u',      desc: 'Enumerate databases' },
    { id: 'batch',    label: 'Non-interactive',  args: '--batch -u',    desc: 'Auto-confirm all prompts' },
  ],
  ffuf: [
    { id: 'dir',      label: 'Dir discovery',    args: '-w /wordlists/common.txt -u', desc: 'Directory brute force' },
    { id: 'mc200',    label: 'Filter 200 only',  args: '-mc 200 -w /wordlists/common.txt -u', desc: 'Only 200 responses' },
    { id: 'recurse',  label: 'Recursive',        args: '-recursion -w /wordlists/common.txt -u', desc: 'Recursive discovery' },
  ],
  gobuster: [
    { id: 'dir',      label: 'Dir bruteforce',   args: 'dir -w /wordlists/common.txt -u', desc: 'Directory brute force' },
    { id: 'dns',      label: 'DNS subdomains',   args: 'dns -w /wordlists/common.txt -d', desc: 'Subdomain enumeration' },
    { id: 'ext',      label: 'With extensions',  args: 'dir -x php,txt,html -w /wordlists/common.txt -u', desc: 'Search file extensions' },
  ],
  hydra: [
    { id: 'single',   label: 'Single user',      args: '-l admin -P /wordlists/common.txt', desc: 'Test one username' },
    { id: 'verbose',  label: 'Verbose',          args: '-l admin -P /wordlists/common.txt -V', desc: 'Show each attempt' },
  ],
  john: [
    { id: 'basic',    label: 'Basic crack',      args: '',              desc: 'Start cracking hashes' },
    { id: 'dict',     label: 'Dictionary',       args: '--wordlist=/wordlists/rockyou.txt', desc: 'Dictionary attack' },
    { id: 'incr',     label: 'Incremental',      args: '--incremental', desc: 'Brute-force mode' },
  ],
  curl: [
    { id: 'verbose',  label: 'Verbose GET',      args: '-sv',           desc: 'Verbose GET request' },
    { id: 'headers',  label: 'Headers only',     args: '-I',            desc: 'Fetch headers only' },
    { id: 'post',     label: 'POST request',     args: '-X POST',       desc: 'Send POST request' },
    { id: 'insecure', label: 'Skip TLS',         args: '-k',            desc: 'Ignore cert errors' },
  ],
  tcpdump: [
    { id: 'capture',  label: 'Capture 20',       args: '-c 20',         desc: 'Capture 20 packets' },
    { id: 'port80',   label: 'Port 80',          args: '-c 20 port 80', desc: 'Filter HTTP traffic' },
    { id: 'save',     label: 'Save to file',     args: '-w /tmp/capture.pcap -c 100', desc: 'Write capture to file' },
  ],
  nuclei: [
    { id: 'basic',    label: 'Basic scan',       args: '-u',            desc: 'Scan target' },
    { id: 'cves',     label: 'CVE templates',    args: '-t cves/ -u',   desc: 'Run CVE templates' },
    { id: 'critical', label: 'Critical/High',    args: '-severity critical,high -u', desc: 'High severity only' },
  ],
  hashcat: [
    { id: 'dict',     label: 'Dictionary MD5',   args: '-m 0',          desc: 'Dictionary attack, MD5' },
    { id: 'mask',     label: 'Mask attack',      args: '-a 3 -m 0',     desc: 'Mask/brute-force attack' },
    { id: 'bench',    label: 'Benchmark',        args: '--benchmark',   desc: 'Benchmark hardware' },
  ],
  gitleaks: [
    { id: 'detect',   label: 'Detect secrets',   args: 'detect',        desc: 'Scan repository' },
    { id: 'git',      label: 'Git history',      args: 'git',           desc: 'Scan full git history' },
    { id: 'verbose',  label: 'Verbose',          args: 'detect --verbose', desc: 'Verbose output' },
  ],
  theharvester: [
    { id: 'all',      label: 'All sources',      args: '-b all -l 100 -d', desc: 'Search all sources' },
    { id: 'google',   label: 'Google only',      args: '-b google -d',  desc: 'Google source only' },
    { id: 'extended', label: 'Extended (500)',   args: '-b all -l 500 -d', desc: 'Extended result limit' },
  ],
  subfinder: [
    { id: 'basic',    label: 'Enumerate',        args: '-d',            desc: 'Passive subdomain enum' },
    { id: 'all',      label: 'All sources',      args: '-all -d',       desc: 'Use all sources (slower)' },
    { id: 'recursive',label: 'Recursive',        args: '-recursive -d', desc: 'Recursive subdomain enum' },
  ],
  testssl: [
    { id: 'full',     label: 'Full scan',        args: '',              desc: 'Complete TLS audit' },
    { id: 'fast',     label: 'Fast scan',        args: '--fast',        desc: 'Quick scan mode' },
    { id: 'vulns',    label: 'TLS vulns',        args: '--vulnerable',  desc: 'Known TLS vulnerabilities' },
    { id: 'hb',       label: 'Heartbleed',       args: '--heartbleed',  desc: 'Heartbleed test only' },
  ],
  wapiti: [
    { id: 'basic',    label: 'Full scan',        args: '-u',            desc: 'Full web app scan' },
    { id: 'sql',      label: 'SQLi only',        args: '-m sql -u',     desc: 'SQL injection only' },
    { id: 'xss',      label: 'XSS only',         args: '-m xss -u',     desc: 'Cross-site scripting only' },
  ],
  wpscan: [
    { id: 'basic',    label: 'Basic scan',       args: '--url',         desc: 'Basic WordPress scan' },
    { id: 'plugins',  label: 'Enum plugins',     args: '--enumerate p --url', desc: 'Plugin enumeration' },
    { id: 'users',    label: 'Enum users',       args: '--enumerate u --url', desc: 'User enumeration' },
    { id: 'themes',   label: 'Enum themes',      args: '--enumerate t --url', desc: 'Theme enumeration' },
  ],
  cewl: [
    { id: 'basic',    label: 'Generate list',    args: '',              desc: 'Generate wordlist' },
    { id: 'depth3',   label: 'Depth 3',          args: '-d 3',          desc: 'Crawl 3 levels deep' },
    { id: 'email',    label: 'Extract emails',   args: '--email',       desc: 'Extract email addresses' },
    { id: 'min5',     label: 'Min length 5',     args: '-m 5',          desc: 'Words with min 5 chars' },
  ],
  trivy: [
    { id: 'image',    label: 'Image scan',       args: 'image',         desc: 'Scan container image' },
    { id: 'fs',       label: 'Filesystem',       args: 'fs',            desc: 'Scan filesystem' },
    { id: 'high',     label: 'High/Critical',    args: 'image --severity HIGH,CRITICAL', desc: 'Filter findings' },
  ],
  amass: [
    { id: 'passive',  label: 'Passive enum',     args: 'enum -passive -d', desc: 'Passive enumeration' },
    { id: 'active',   label: 'Active enum',      args: 'enum -d',       desc: 'Active enumeration' },
    { id: 'intel',    label: 'Intelligence',     args: 'intel -d',      desc: 'Intelligence gathering' },
  ],
  commix: [
    { id: 'basic',    label: 'Basic test',       args: '--batch --url', desc: 'Test URL for cmdi' },
    { id: 'crawl',    label: 'Crawl depth 2',    args: '--batch --crawl=2 --url', desc: 'Crawl website first' },
  ],
  searchsploit: [
    { id: 'search',   label: 'Search exploits',  args: '',              desc: 'Search exploit DB' },
    { id: 'update',   label: 'Update DB',        args: '--update',      desc: 'Update local database' },
  ],
  subdominator: [
    { id: 'basic',    label: 'Scan domain',      args: '-d',            desc: 'Takeover detection' },
    { id: 'verbose',  label: 'Verbose',          args: '-v -d',         desc: 'Verbose output' },
  ],
  httpx: [
    { id: 'full',     label: 'Full probe',       args: '-silent -status-code -title -tech-detect -u', desc: 'Probe + tech detect' },
    { id: 'status',   label: 'Status codes',     args: '-status-code -u', desc: 'HTTP status only' },
    { id: 'tech',     label: 'Tech detect',      args: '-tech-detect -title -u', desc: 'Technology detection' },
  ],
}

function StatusDot({ status }) {
  return <span className={`tep-dot tep-dot--${status}`} />
}

function ToolCard({ entry }) {
  const logRef = useRef(null)

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight, behavior: 'smooth' })
  }, [entry.logs])

  const elapsed = entry.endTime
    ? ((entry.endTime - entry.startTime) / 1000).toFixed(1) + 's'
    : entry.startTime
    ? ((Date.now() - entry.startTime) / 1000).toFixed(0) + 's…'
    : ''

  return (
    <div className={`tep-card tep-card--${entry.status}`}>
      <div className="tep-card__header">
        <StatusDot status={entry.status} />
        <span className="tep-card__tool">{entry.tool.toUpperCase()}</span>
        <span className={`tep-card__badge tep-card__badge--${entry.status}`}>
          {entry.status === 'running' ? 'RUNNING' : entry.status === 'done' ? 'DONE' : entry.status === 'error' ? 'ERROR' : 'QUEUED'}
        </span>
        {elapsed && <span className="tep-card__elapsed">{elapsed}</span>}
      </div>

      {entry.command && (
        <div className="tep-card__cmd">
          <span className="tep-card__cmd-prefix">$</span>
          <span className="tep-card__cmd-text">{entry.command}</span>
        </div>
      )}

      {entry.logs.length > 0 && (
        <div className="tep-card__logs" ref={logRef}>
          {entry.logs.slice(-12).map((line, i) => {
            const type = /error|failed|refused/i.test(line) ? 'error'
                       : /warning|warn/i.test(line)         ? 'warn'
                       : /open|done|complete/i.test(line)   ? 'ok'
                       : 'info'
            return (
              <div key={i} className={`tep-log tep-log--${type}`}>
                <span className="tep-log__icon">
                  {type === 'error' ? '✗' : type === 'warn' ? '!' : type === 'ok' ? '✓' : '▶'}
                </span>
                <span className="tep-log__text">{line}</span>
              </div>
            )
          })}
        </div>
      )}

      {(entry.status === 'done' || entry.status === 'error') && entry.exitCode !== undefined && (
        <div className={`tep-card__exit tep-card__exit--${entry.exitCode === 0 ? 'ok' : 'err'}`}>
          exit {entry.exitCode}
        </div>
      )}
    </div>
  )
}

function CommandsPanel({ tool, activeArgs, onCommandRun, hasDomain }) {
  const cmds = TOOL_COMMANDS[tool]
  if (!cmds) return null

  function matchActive(cmdArgs) {
    if (!activeArgs) return false
    if (!cmdArgs) return activeArgs === '' || /^-sV|^-sC|top-ports/.test(activeArgs) === false
    return activeArgs.includes(cmdArgs.split(' ')[0])
  }

  return (
    <div className="tep-cmds">
      <div className="tep-cmds__header">
        <span className="tep-cmds__tool">{tool.toUpperCase()}</span>
        <span className="tep-cmds__label">COMMANDS</span>
      </div>
      <div className="tep-cmds__list">
        {cmds.map(cmd => {
          const active = matchActive(cmd.args)
          return (
            <button
              key={cmd.id}
              className={`tep-cmd ${active ? 'tep-cmd--active' : ''} ${!hasDomain ? 'tep-cmd--disabled' : ''}`}
              onClick={() => hasDomain && onCommandRun?.(tool, cmd.args)}
              title={hasDomain ? `Run: ${tool} ${cmd.args}` : 'Set a target domain first'}
            >
              <span className="tep-cmd__dot">{active ? '●' : '○'}</span>
              <span className="tep-cmd__label">{cmd.label}</span>
              <span className="tep-cmd__desc">{cmd.desc}</span>
              <span className="tep-cmd__run">▶</span>
            </button>
          )
        })}
      </div>
      {!hasDomain && (
        <div className="tep-cmds__nodomain">Set a target in the chat panel to run commands</div>
      )}
    </div>
  )
}

export default function ToolExecutionPanel({ activity, activeTool, hasDomain, onCommandRun }) {
  const running = activity.filter(e => e.status === 'running')
  const queued  = activity.filter(e => e.status === 'queued')
  const done    = activity.filter(e => e.status === 'done' || e.status === 'error')

  // Show commands for current running tool, or activeTool, or last completed
  const cmdTool = running[0]?.tool || activeTool || done[done.length - 1]?.tool || null
  // Active args from the running or last completed entry
  const cmdEntry = activity.find(e => e.tool === cmdTool) || null

  return (
    <aside className="tep">
      <div className="tep__header">
        <span className="tep__title">EXECUTION</span>
        <div className="tep__stats">
          {running.length > 0 && (
            <span className="tep__stat tep__stat--run">{running.length} running</span>
          )}
          {queued.length > 0 && (
            <span className="tep__stat tep__stat--queue">{queued.length} queued</span>
          )}
          {done.length > 0 && (
            <span className="tep__stat tep__stat--done">{done.length} done</span>
          )}
        </div>
      </div>

      <div className="tep__body">
        {activity.length === 0 && !cmdTool && (
          <div className="tep__empty">
            <div className="tep__empty-icon">⟳</div>
            <p className="tep__empty-title">No active runs</p>
            <p className="tep__empty-sub">Send a scan prompt to start tool execution</p>
          </div>
        )}

        {running.length > 0 && (
          <div className="tep__section">
            <div className="tep__section-label">ACTIVE</div>
            {running.map(e => <ToolCard key={e.id} entry={e} />)}
          </div>
        )}

        {queued.length > 0 && (
          <div className="tep__section">
            <div className="tep__section-label">QUEUED</div>
            {queued.map(e => (
              <div key={e.id} className="tep-queue-row">
                <StatusDot status="queued" />
                <span className="tep-queue-row__tool">{e.tool.toUpperCase()}</span>
                <span className="tep-queue-row__pos">#{e.queuePos}</span>
              </div>
            ))}
          </div>
        )}

        {done.length > 0 && (
          <div className="tep__section">
            <div className="tep__section-label">COMPLETED</div>
            {[...done].reverse().map(e => <ToolCard key={e.id} entry={e} />)}
          </div>
        )}

        {cmdTool && (
          <CommandsPanel
            tool={cmdTool}
            activeArgs={cmdEntry?.args}
            onCommandRun={onCommandRun}
            hasDomain={hasDomain}
          />
        )}
      </div>
    </aside>
  )
}
