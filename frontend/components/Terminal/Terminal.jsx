import { useEffect, useMemo, useRef, useState } from 'react'
import './Terminal.css'

function ts() {
  return new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

function newRunId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID().replace(/-/g, '')
  }
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 10)
}

function classifyLine(line, tool) {
  const l = line.trim()
  const base = { tool, ts: ts() }
  if (/\bopen\b/i.test(l))              return { ...base, type: 'success', icon: '✓', msg: l }
  if (/warning|warn/i.test(l))           return { ...base, type: 'warning', icon: '!', msg: l }
  if (/error|failed|refused/i.test(l))   return { ...base, type: 'error',   icon: '✗', msg: l }
  if (/filtered|closed/i.test(l))        return { ...base, type: 'dim',     icon: '·', msg: l }
  return { ...base, type: 'info', icon: '▶', msg: l }
}

// ── A single console pane (the "terminal" for one tool, or for ALL) ──────────
function ConsolePane({ logs, bottomRef }) {
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [logs])

  return (
    <div className="term-body">
      <div className="term-prompt">
        <span className="term-prompt__user">alphaweb</span>
        <span className="term-prompt__at">@</span>
        <span className="term-prompt__host">hyderabad</span>
        <span className="term-prompt__sep">:</span>
        <span className="term-prompt__path">~</span>
        <span className="term-prompt__char">$&nbsp;</span>
        <span className="term-prompt__cmd blink">▋</span>
      </div>

      {logs.map((log, i) => {
        if (log.type === 'cmd') {
          return (
            <div key={i} className="term-prompt" style={{ marginTop: 6 }}>
              <span className="term-prompt__user">alphaweb</span>
              <span className="term-prompt__at">@</span>
              <span className="term-prompt__host">hyderabad</span>
              <span className="term-prompt__sep">:</span>
              <span className="term-prompt__path">~</span>
              <span className="term-prompt__char">$&nbsp;</span>
              <span className="term-prompt__cmd">{log.msg}</span>
            </div>
          )
        }
        return (
          <div key={i} className={`term-entry term-entry--${log.type}`}>
            <span className="term-ts">{log.ts}</span>
            <span className={`term-icon term-icon--${log.type}`}>{log.icon}</span>
            <span className="term-msg">{log.msg}</span>
            {log.detail && (
              <span className={`term-detail term-detail--${log.type}`}>&nbsp;{log.detail}</span>
            )}
          </div>
        )
      })}

      {logs.length === 0 && (
        <div className="term-entry term-entry--info" style={{ opacity: 0.4, paddingTop: 8 }}>
          <span className="term-msg">Waiting for scan output...</span>
        </div>
      )}

      <div ref={bottomRef} />
    </div>
  )
}

const SEV_ORDER = ['critical', 'high', 'medium', 'low', 'info']

// ── Alerts pane: vulnerabilities found, grouped/labelled by severity ─────────
function AlertsPane({ alerts }) {
  if (!alerts || alerts.length === 0) {
    return (
      <div className="term-body">
        <div className="term-entry term-entry--info" style={{ opacity: 0.45, paddingTop: 8 }}>
          <span className="term-msg">No alerts yet — run a scan to surface vulnerabilities.</span>
        </div>
      </div>
    )
  }

  const counts = alerts.reduce((acc, a) => {
    acc[a.severity] = (acc[a.severity] || 0) + 1
    return acc
  }, {})

  return (
    <div className="term-body">
      <div className="term-alerts-summary">
        {SEV_ORDER.map(s => counts[s]
          ? <span key={s} className={`term-alert-chip term-alert-chip--${s}`}>{counts[s]} {s}</span>
          : null
        )}
      </div>
      {alerts.map((a, i) => (
        <div key={i} className={`term-alert term-alert--${a.severity}`}>
          <span className={`term-alert__sev term-alert__sev--${a.severity}`}>{a.severity}</span>
          <span className="term-alert__tool">{a.tool}</span>
          <span className="term-alert__title">{a.title}</span>
        </div>
      ))}
    </div>
  )
}

// ── Terminal: CONSOLE + ALERTS + one tab per tool, plus a manual command line ─
export default function Terminal({ clearKey = 0, logs = [], alerts = [], maximized = false, visible = true, onLog, onClear, onMaximize, onClose }) {
  const [activeTab, setActiveTab] = useState('all')
  const [cmd, setCmd]             = useState('')
  const [running, setRunning]     = useState(false)
  const bottomRef = useRef(null)
  const cmdRef    = useRef(null)
  const runIdRef  = useRef(null)

  // Tools that appear in the logs, in first-seen order
  const tools = useMemo(() => {
    const seen = []
    for (const l of logs) {
      if (l.tool && !seen.includes(l.tool)) seen.push(l.tool)
    }
    return seen
  }, [logs])

  // If the active per-tool tab disappears (e.g. after Clear), fall back to ALL
  useEffect(() => {
    if (activeTab !== 'all' && activeTab !== 'alerts' && !tools.includes(activeTab)) {
      setActiveTab('all')
    }
  }, [tools, activeTab])

  const alertBadge = alerts.filter(a => a.severity === 'critical' || a.severity === 'high').length

  const shownLogs = activeTab === 'all'
    ? logs
    : logs.filter(l => l.tool === activeTab)

  async function runCommand() {
    const raw = cmd.trim()
    if (!raw || running) return

    // Local convenience commands
    if (raw === 'clear' || raw === 'cls') { onClear?.(); setCmd(''); return }
    if (raw === 'help') {
      onLog?.([{
        type: 'info', icon: 'ℹ', ts: ts(),
        msg: 'Usage: <tool> [args...] <target>   e.g.  nmap -F scanme.nmap.org   ·   clear   ·   help',
      }])
      setCmd('')
      return
    }

    const parts = raw.split(/\s+/)
    const tool  = parts[0].toLowerCase()
    if (parts.length < 2) {
      onLog?.([{ type: 'error', icon: '✗', ts: ts(), msg: `Usage: ${tool} [args...] <target>` }])
      return
    }
    const target = parts[parts.length - 1]
    const args   = parts.slice(1, -1).join(' ')

    const runId = newRunId()
    runIdRef.current = runId

    setRunning(true)
    onLog?.([{ type: 'cmd', tool, msg: raw, ts: ts() }])
    setCmd('')

    try {
      const res  = await fetch('/api/execute', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ tool, args, target, run_id: runId }),
      })
      const data = await res.json()
      if (!res.ok) {
        const detail = typeof data.detail === 'string' ? data.detail : JSON.stringify(data.detail)
        throw new Error(detail || `HTTP ${res.status}`)
      }
      const out   = (data.raw_output || '').split('\n').slice(0, 1000)
      const lines = out
        .map(l => l.replace(/\x1b\[[0-9;]*m/g, '').trimEnd())
        .filter(l => l.length > 0)
        .map(l => classifyLine(l, tool))
      onLog?.(lines.length
        ? lines
        : [{ type: 'dim', icon: '·', tool, msg: '(no output)', ts: ts() }])
      onLog?.([{ type: 'success', icon: '✓', tool, msg: `${tool} finished`, ts: ts() }])
    } catch (e) {
      onLog?.([{ type: 'error', icon: '✗', tool, msg: `${tool}: ${e.message}`, ts: ts() }])
    } finally {
      setRunning(false)
      runIdRef.current = null
      setTimeout(() => cmdRef.current?.focus(), 30)
    }
  }

  async function stopCommand() {
    const rid = runIdRef.current
    if (!rid) return
    try {
      await fetch('/api/chat/cancel', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ run_id: rid }),
      })
      onLog?.([{ type: 'warning', icon: '!', msg: 'Stopping command…', ts: ts() }])
    } catch { /* command will still time out on its own */ }
  }

  return (
    <section className={`terminal ${maximized ? 'terminal--maximized' : ''}`}>
      {/* ── Header ── */}
      <div className="term-header">
        <div className="term-tabs">
          <button
            className={`term-tab ${activeTab === 'all' ? 'term-tab--active' : ''}`}
            onClick={() => setActiveTab('all')}
          >
            <span className="term-tab__dot" />
            CONSOLE
          </button>
          <button
            className={`term-tab ${activeTab === 'alerts' ? 'term-tab--active' : ''}`}
            onClick={() => setActiveTab('alerts')}
            title="Vulnerabilities and alerts"
          >
            ⚠ ALERTS
            {alerts.length > 0 && (
              <span className={`term-tab__badge ${alertBadge > 0 ? 'term-tab__badge--hot' : ''}`}>
                {alerts.length}
              </span>
            )}
          </button>
          {tools.map(t => (
            <button
              key={t}
              className={`term-tab ${activeTab === t ? 'term-tab--active' : ''}`}
              onClick={() => setActiveTab(t)}
              title={`${t} output`}
            >
              {t.toUpperCase()}
            </button>
          ))}
        </div>

        <div className="term-controls">
          {tools.length > 0 && (
            <span className="term-count">{tools.length} tool{tools.length > 1 ? 's' : ''}</span>
          )}
          <button className="term-ctrl" title="Clear console" onClick={onClear}>⊘</button>
          <button className="term-ctrl term-ctrl--close" title="Close terminal" onClick={onClose}>✕</button>
        </div>
      </div>

      {/* ── Active pane ── */}
      {activeTab === 'alerts'
        ? <AlertsPane alerts={alerts} />
        : <ConsolePane key={`${activeTab}-${clearKey}`} logs={shownLogs} bottomRef={bottomRef} />
      }

      {/* ── Manual command line ── */}
      <div className="term-cmdline">
        <span className="term-cmdline__prompt">{running ? '⟳' : '$'}</span>
        <input
          ref={cmdRef}
          className="term-cmdline__input"
          placeholder={running ? 'Running…' : 'Run a tool — e.g. nmap -F scanme.nmap.org   (help)'}
          value={cmd}
          onChange={e => setCmd(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && runCommand()}
          disabled={running}
          spellCheck={false}
        />
        {running ? (
          <button
            className="term-cmdline__run term-cmdline__run--stop"
            onClick={stopCommand}
            title="Stop command"
          >
            Stop
          </button>
        ) : (
          <button
            className="term-cmdline__run"
            onClick={runCommand}
            disabled={!cmd.trim()}
            title="Run command"
          >
            Run
          </button>
        )}
      </div>
    </section>
  )
}
