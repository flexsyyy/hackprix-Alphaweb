import { useState, useRef, useCallback } from 'react'
import './SideBar.css'

const SECTION_LABELS = {
  scanner:       'EXPLORER',
  reporting:     'REPORTS',
  orchestration: 'CONTAINERS',
}

// Command variants per tool — shown in sidebar when tool is active
const TOOL_COMMANDS = {
  nmap: [
    { id: 'basic',    label: 'Basic scan',       args: '',              desc: 'Scan common ports' },
    { id: 'sV',       label: 'Service detect',   args: '-sV',           desc: 'Detect services and versions' },
    { id: 'aggr',     label: 'Aggressive',       args: '-A',            desc: 'OS, services, scripts, traceroute' },
    { id: 'allports', label: 'All ports',         args: '-p-',           desc: 'Scan all 65535 TCP ports' },
    { id: 'vuln',     label: 'Vuln scripts',      args: '--script vuln', desc: 'Run vulnerability NSE scripts' },
  ],
  masscan: [
    { id: 'web',      label: 'Web ports',        args: '-p80,443',      desc: 'Scan ports 80 and 443' },
    { id: 'allports', label: 'All ports',         args: '-p1-65535',     desc: 'Full port range' },
    { id: 'rate',     label: 'Rate limited',      args: '--rate 1000',   desc: 'Throttle to 1000 pps' },
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
    { id: 'dir',      label: 'Dir bruteforce',   args: 'dir -w /wordlists/common.txt -u',  desc: 'Directory brute force' },
    { id: 'dns',      label: 'DNS subdomains',   args: 'dns -w /wordlists/common.txt -d',  desc: 'Subdomain enumeration' },
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
  sublist3r: [
    { id: 'basic',    label: 'Enumerate',        args: '-d',            desc: 'Passive subdomain enum' },
    { id: 'verbose',  label: 'Verbose',          args: '-v -d',         desc: 'Verbose mode' },
    { id: 'engines',  label: 'Multi-engine',     args: '-e google,yahoo,bing -d', desc: 'Specific search engines' },
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

function extIcon(ext) {
  const map = { apk: '📱', zip: '📦', tar: '📦', gz: '📦', yaml: '⚙', yml: '⚙',
                json: '{}', txt: '¶', pdf: '📄', log: '≡', csv: '⋮' }
  return map[ext?.toLowerCase()] ?? '·'
}

function extColor(ext) {
  return ({
    apk: 'var(--green)', zip: 'var(--cyan)', tar: 'var(--cyan)', gz: 'var(--cyan)',
    yaml: 'var(--cyan)', yml: 'var(--cyan)', json: 'var(--gold)',
    pdf: '#e06c75', log: 'var(--text-dim)', txt: 'var(--text-secondary)',
  })[ext?.toLowerCase()] ?? 'var(--text-secondary)'
}

function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1048576).toFixed(1)} MB`
}

export default function SideBar({
  activeView,
  activeFile,
  onFileOpen,
  onToast,
  onFilesChange,
  // Tool command panel props
  activeTool,
  toolCommandOverrides,
  onToolCommandSelect,
}) {
  const [files, setFiles]       = useState([])
  const [dragging, setDragging] = useState(false)
  const fileInputRef = useRef(null)

  const addFiles = useCallback((fileList) => {
    const items = Array.from(fileList).map(f => ({
      id:   `up-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      name: f.name,
      size: f.size,
      ext:  f.name.includes('.') ? f.name.split('.').pop().toLowerCase() : '',
      file: f,
      ts:   new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }),
    }))

    setFiles(prev => {
      const next = [...prev, ...items]
      onFilesChange?.(next)
      return next
    })

    items.forEach(item => onFileOpen?.({ id: item.id, name: item.name, ext: item.ext, fileObj: item.file }))
    onToast?.(`${items.length} file${items.length > 1 ? 's' : ''} uploaded`, 'success')
  }, [onFileOpen, onFilesChange, onToast])

  function removeFile(id) {
    setFiles(prev => {
      const next = prev.filter(f => f.id !== id)
      onFilesChange?.(next)
      return next
    })
  }

  function handleDrop(e) {
    e.preventDefault()
    setDragging(false)
    if (e.dataTransfer.files.length) addFiles(e.dataTransfer.files)
  }

  function handleInputChange(e) {
    if (e.target.files?.length) addFiles(e.target.files)
    e.target.value = ''
  }

  const toolCmds = activeTool ? (TOOL_COMMANDS[activeTool] || []) : []
  const selectedCmdId = toolCommandOverrides?.[activeTool] ?? toolCmds[0]?.id ?? null

  return (
    <aside className="sidebar">
      {/* ── Header ── */}
      <div className="sidebar__header">
        <span className="sidebar__title">ALPHAWEB_WORKSPACE</span>
        <div className="sidebar__hdr-actions">
          <button
            className="sidebar__hdr-btn"
            title="Upload File"
            onClick={() => fileInputRef.current?.click()}
          >
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" width="13" height="13">
              <path d="M2 11v2h12v-2"/>
              <path d="M8 2v8"/>
              <polyline points="5,5 8,2 11,5"/>
            </svg>
          </button>
        </div>
      </div>

      <div className="sidebar__section-label">
        {SECTION_LABELS[activeView] ?? 'EXPLORER'}
      </div>

      {/* ── Tool Command Panel ── */}
      {activeTool && toolCmds.length > 0 && (
        <div className="sb-tool-cmds">
          <div className="sb-tool-cmds__header">
            <span className="sb-tool-cmds__tool">{activeTool.toUpperCase()}</span>
            <span className="sb-tool-cmds__label">SELECT COMMAND</span>
          </div>
          <div className="sb-tool-cmds__list">
            {toolCmds.map(cmd => {
              const isActive = (toolCommandOverrides?.[activeTool] ?? toolCmds[0]?.id) === cmd.id
              return (
                <button
                  key={cmd.id}
                  className={`sb-cmd-row ${isActive ? 'sb-cmd-row--active' : ''}`}
                  title={cmd.args ? `args: ${cmd.args}` : 'default args'}
                  onClick={() => onToolCommandSelect?.(activeTool, cmd.id, cmd.args)}
                >
                  <span className="sb-cmd-row__dot" />
                  <div className="sb-cmd-row__info">
                    <span className="sb-cmd-row__label">{cmd.label}</span>
                    <span className="sb-cmd-row__desc">{cmd.desc}</span>
                  </div>
                  {isActive && <span className="sb-cmd-row__check">✓</span>}
                </button>
              )
            })}
          </div>
        </div>
      )}

      {/* ── Upload area + file list ── */}
      <div className="sidebar__tree">
        {/* Drop zone */}
        <div
          className={[
            'sb-dropzone',
            dragging          ? 'sb-dropzone--active'  : '',
            files.length > 0  ? 'sb-dropzone--compact' : '',
          ].join(' ')}
          onDragOver={e => { e.preventDefault(); setDragging(true) }}
          onDragLeave={() => setDragging(false)}
          onDrop={handleDrop}
          onClick={() => files.length === 0 && fileInputRef.current?.click()}
          role="button"
          tabIndex={0}
          onKeyDown={e => e.key === 'Enter' && fileInputRef.current?.click()}
        >
          {files.length === 0 ? (
            <>
              <div className="sb-dropzone__icon">⬆</div>
              <p className="sb-dropzone__title">Drop files here</p>
              <p className="sb-dropzone__sub">or click to browse</p>
              <p className="sb-dropzone__hint">APK · ZIP · YAML · any file</p>
            </>
          ) : (
            <button
              className="sb-add-more"
              onClick={e => { e.stopPropagation(); fileInputRef.current?.click() }}
            >
              + Add more files
            </button>
          )}
        </div>

        {/* Uploaded file list */}
        {files.map(f => (
          <div
            key={f.id}
            className={`sb-file ${f.name === activeFile ? 'sb-file--active' : ''}`}
            onClick={() => onFileOpen?.({ id: f.id, name: f.name, ext: f.ext, fileObj: f.file })}
            role="button"
            tabIndex={0}
            onKeyDown={e => e.key === 'Enter' && onFileOpen?.({ id: f.id, name: f.name, ext: f.ext, fileObj: f.file })}
          >
            <span className="sb-file__icon" style={{ color: extColor(f.ext) }}>
              {extIcon(f.ext)}
            </span>
            <div className="sb-file__info">
              <span className="sb-file__name">{f.name}</span>
              <span className="sb-file__meta">{formatSize(f.size)} · {f.ts}</span>
            </div>
            <button
              className="sb-file__remove"
              title="Remove"
              onClick={e => { e.stopPropagation(); removeFile(f.id) }}
            >
              ×
            </button>
          </div>
        ))}
      </div>

      {/* ── Quick Actions ── */}
      <div className="sidebar__qa">
        <div className="sidebar__qa-label">QUICK ACTIONS</div>

        <button
          className="qa-row qa-row--primary"
          onClick={() => fileInputRef.current?.click()}
        >
          <span className="qa-row__icon qa-row__icon--primary">
            <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.4"
                 strokeLinecap="round" strokeLinejoin="round">
              <rect x="5.5" y="1.5" width="9" height="17" rx="1.5"/>
              <line x1="10" y1="6" x2="10" y2="12"/>
              <polyline points="7.5,8.5 10,6 12.5,8.5"/>
              <line x1="8" y1="15" x2="12" y2="15"/>
            </svg>
          </span>
          <div className="qa-row__text">
            <span className="qa-row__label">Upload File</span>
            <span className="qa-row__sub">Select file to analyze</span>
          </div>
          <span className="qa-row__badge">NEW</span>
        </button>

        <button
          className="qa-row qa-ml-btn"
          onClick={() => fileInputRef.current?.click()}
          title="Upload a code file — opens in editor with Analyze button"
        >
          <span className="qa-row__icon qa-row__icon--ml">
            <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.4"
                 strokeLinecap="round" strokeLinejoin="round">
              <circle cx="10" cy="10" r="3"/>
              <path d="M10 2v2M10 16v2M2 10h2M16 10h2"/>
              <path d="M4.93 4.93l1.41 1.41M13.66 13.66l1.41 1.41M4.93 15.07l1.41-1.41M13.66 6.34l1.41-1.41"/>
            </svg>
          </span>
          <div className="qa-row__text">
            <span className="qa-row__label">ML Security Scan</span>
            <span className="qa-row__sub">Upload code → auto-analyze</span>
          </div>
          <span className="qa-row__badge qa-row__badge--active">↑ Upload</span>
        </button>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        multiple
        style={{ display: 'none' }}
        onChange={handleInputChange}
      />
    </aside>
  )
}
