import { useEffect, useRef, useState } from 'react'
import './AgentChat.css'

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
  if (/\bopen\b/i.test(l))                       return { ...base, type: 'success', icon: '✓', msg: l }
  if (/warning|warn/i.test(l))                    return { ...base, type: 'warning', icon: '!', msg: l }
  if (/error|failed|refused/i.test(l))            return { ...base, type: 'error',   icon: '✗', msg: l }
  if (/done|complete|finished|scanned/i.test(l))  return { ...base, type: 'success', icon: '✓', msg: l }
  if (/filtered|closed/i.test(l))                 return { ...base, type: 'dim',     icon: '·', msg: l }
  return { ...base, type: 'info', icon: '▶', msg: l }
}

export default function AgentChat({
  onScanOutput,
  onProgress,
  onAlerts,
  onToolStart,        // (toolName: string) => void — fires when a tool starts
  toolCommandOverrides, // {[tool]: args} — per-tool arg overrides from SideBar
}) {
  const [messages,    setMessages]    = useState([])
  const [input,       setInput]       = useState('')
  const [domain,      setDomain]      = useState('')
  const [domainError, setDomainError] = useState('')
  const [loading,     setLoading]     = useState(false)
  const [modelStatus, setModelStatus] = useState('Idle')

  // Tool selection
  const [toolList,      setToolList]      = useState([])
  const [selectedTools, setSelectedTools] = useState(() => new Set())
  const [showPicker,    setShowPicker]    = useState(false)

  // Report produced by the last completed run
  const [report, setReport] = useState(null)

  const endRef   = useRef(null)
  const inputRef = useRef(null)
  const abortRef = useRef(null)
  const runIdRef = useRef(null)

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, loading])

  // Fetch the available tool catalogue once
  useEffect(() => {
    fetch('/api/tools')
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d?.tools) setToolList(d.tools) })
      .catch(() => {})
  }, [])

  function validateDomain(val) {
    const v = val.trim()
    if (!v) return 'Domain or IP required'
    if (v.includes(' ')) return 'No spaces allowed'
    return ''
  }

  const MAX_TOOLS = 3

  function toggleTool(name) {
    setSelectedTools(prev => {
      const next = new Set(prev)
      if (next.has(name)) {
        next.delete(name)
      } else {
        if (next.size >= MAX_TOOLS) return prev  // hard cap: max 3 per scan
        next.add(name)
      }
      return next
    })
  }

  // Suggested-next chip: run that ONE tool as a fresh scan. Does NOT mutate
  // the persistent selection — otherwise leftover picks would silently
  // override the next typed prompt.
  function addNextTool(toolName) {
    if (loading) return
    runScan(`run ${toolName}`, [toolName])
  }

  async function stop() {
    const rid = runIdRef.current
    if (!rid) return
    setModelStatus('Stopping…')
    try {
      await fetch('/api/chat/cancel', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ run_id: rid }),
      })
    } catch { /* backend will still wind the stream down */ }
    onScanOutput?.([{ type: 'warning', icon: '!', msg: 'Cancellation requested — stopping run…', ts: ts() }])
  }

  async function send() {
    const text = input.trim()
    if (!text || loading) return
    runScan(text, [...selectedTools])
  }

  async function runScan(text, tools) {
    if (!text || loading) return

    const err = validateDomain(domain)
    if (err) { setDomainError(err); return }
    setDomainError('')

    const runId = newRunId()
    runIdRef.current = runId

    setMessages(m => [...m, { id: Date.now(), role: 'user', content: text, ts: ts() }])
    setInput('')
    setLoading(true)
    setReport(null)
    setShowPicker(false)
    onProgress?.({ done: 0, total: 0, active: true })
    onAlerts?.([])

    setModelStatus(tools.length ? `Queued ${tools.length} tool(s)…` : 'Selecting tools…')

    onScanOutput?.([{
      type: 'pending', icon: '⟳',
      msg: `Dispatching: ${text}`, detail: `→ ${domain.trim()}`, ts: ts(),
    }])

    const controller = new AbortController()
    abortRef.current = controller

    // Build per-tool arg overrides from SideBar selections
    const tool_args = toolCommandOverrides && Object.keys(toolCommandOverrides).length > 0
      ? toolCommandOverrides
      : undefined

    let pgDone  = 0
    let pgTotal = 0

    try {
      const res = await fetch('/api/chat/stream', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ prompt: text, domain: domain.trim(), tools, run_id: runId, tool_args }),
        signal:  controller.signal,
      })

      if (!res.ok) throw new Error(`HTTP ${res.status}`)

      const reader  = res.body.getReader()
      const decoder = new TextDecoder()
      let   buffer  = ''

      while (true) {
        const { value, done } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop()

        for (const raw of lines) {
          if (!raw.startsWith('data: ')) continue
          const payload = raw.slice(6).trim()
          if (!payload) continue

          let evt
          try { evt = JSON.parse(payload) } catch { continue }

          if (evt.type === 'heartbeat') continue

          if (evt.type === 'run_start') {
            const list = (evt.tools || []).join(', ')
            pgTotal = evt.tools?.length || 0
            pgDone = 0
            onProgress?.({ done: 0, total: pgTotal, active: true })
            setModelStatus(`Running ${pgTotal} tool(s)…`)
            onScanOutput?.([{
              type: 'info', icon: '▶',
              msg: `Run started — tools: ${list || 'auto'}`, ts: ts(),
            }])
          }

          if (evt.type === 'tool_start') {
            setModelStatus(`Running ${evt.tool}…`)
            onToolStart?.(evt.tool)
            onScanOutput?.([{ type: 'cmd', icon: '$', tool: evt.tool, msg: `${evt.tool} ${domain.trim()}`, ts: ts() }])
          }

          if (evt.type === 'tool_line') {
            onScanOutput?.([classifyLine(evt.line, evt.tool)])
          }

          if (evt.type === 'tool_done') {
            const ok = evt.exit_code === 0
            pgDone = Math.min(pgDone + 1, pgTotal)
            onProgress?.({ done: pgDone, total: pgTotal, active: true })
            onScanOutput?.([{
              type: ok ? 'success' : 'warning', icon: ok ? '✓' : '!',
              tool: evt.tool,
              msg: `${evt.tool} finished (exit ${evt.exit_code})`, ts: ts(),
            }])
          }

          if (evt.type === 'error') {
            onScanOutput?.([{ type: 'error', icon: '✗', msg: evt.message, ts: ts() }])
            setMessages(m => [...m, {
              id: Date.now() + 1, role: 'ai', content: `[ERROR] ${evt.message}`, ts: ts(),
            }])
          }

          if (evt.type === 'analyzing') {
            setModelStatus('Analyzing…')
          }

          if (evt.type === 'analysis') {
            setModelStatus('Idle')
            setMessages(m => [...m, {
              id: Date.now() + 1, role: 'ai',
              content: evt.content,
              tool: evt.tool_used || '',
              next_tool: evt.next_tool || null,
              suggestion: evt.suggestion || '',
              ts: ts(),
            }])
          }

          if (evt.type === 'alerts') {
            onAlerts?.(evt.alerts || [])
          }

          if (evt.type === 'report') {
            setReport({ runId: evt.run_id, url: evt.report_url })
          }

          if (evt.type === 'cancelled') {
            onScanOutput?.([{ type: 'warning', icon: '!', msg: 'Run cancelled.', ts: ts() }])
          }

          if (evt.type === 'done') break
        }
      }
    } catch (e) {
      if (e.name !== 'AbortError') {
        onScanOutput?.([{ type: 'error', icon: '✗', msg: `Connection error: ${e.message}`, ts: ts() }])
        setMessages(m => [...m, {
          id: Date.now() + 1, role: 'ai', content: `Connection error: ${e.message}`, ts: ts(),
        }])
      }
    } finally {
      setLoading(false)
      setModelStatus('Idle')
      onProgress?.({ done: pgDone, total: pgTotal, active: false })
      abortRef.current = null
      runIdRef.current = null
      setTimeout(() => inputRef.current?.focus(), 50)
    }
  }

  const selCount = selectedTools.size

  return (
    <section className="agent-chat">
      {/* ── Header ── */}
      <div className="ac-header">
        <div className="ac-header-row">
          <span className="ac-title-text">AlphaWeb Agent</span>
          <div className="ac-model-row">
            <span className="ac-model-dot" />
            <span className="ac-model-name">ALPHA-LLM</span>
            <span className="ac-model-status">{modelStatus}</span>
          </div>
        </div>
        <p className="ac-subtitle">AI-POWERED CYBERSECURITY AUTOMATION PLATFORM</p>
      </div>

      {/* ── Messages ── */}
      <div className="ac-messages">
        {messages.length === 0 && (
          <div className="ac-empty">
            <div className="ac-empty__icon">⍺</div>
            <p className="ac-empty__title">Ready</p>
            <p className="ac-empty__sub">Set a target domain, pick tools (or let the agent choose), then describe the task.</p>
            <div className="ac-examples">
              <span className="ac-example">"scan for open ports"</span>
              <span className="ac-example">"check web vulnerabilities"</span>
              <span className="ac-example">"enumerate subdomains"</span>
            </div>
          </div>
        )}

        {messages.map(msg => (
          <div key={msg.id} className={`ac-msg ac-msg--${msg.role}`}>
            <div className="ac-msg__head">
              <span className="ac-msg__author">
                {msg.role === 'user' ? '[User]' : '[AlphaLLM]'}
              </span>
              <div className="ac-msg__head-right">
                {msg.tool && msg.tool.split(', ').filter(Boolean).map(t => (
                  <span key={t} className="ac-msg__tool">{t.toUpperCase()}</span>
                ))}
                <span className="ac-msg__ts">{msg.ts}</span>
              </div>
            </div>
            <div className="ac-msg__body">{msg.content}</div>
            {/* Next tool suggestion */}
            {msg.next_tool && (
              <div className="ac-next-tool">
                <span className="ac-next-tool__label">Suggested next:</span>
                <button
                  className="ac-next-tool__chip"
                  onClick={() => addNextTool(msg.next_tool)}
                  title={msg.suggestion || `Run ${msg.next_tool} next`}
                >
                  + {msg.next_tool}
                </button>
                {msg.suggestion && (
                  <span className="ac-next-tool__hint">{msg.suggestion}</span>
                )}
              </div>
            )}
          </div>
        ))}

        {loading && (
          <div className="ac-msg ac-msg--ai">
            <div className="ac-msg__head">
              <span className="ac-msg__author">[AlphaLLM]</span>
            </div>
            <div className="ac-msg__body ac-msg__body--typing">
              <span className="ac-dot" /><span className="ac-dot" /><span className="ac-dot" />
            </div>
          </div>
        )}

        <div ref={endRef} />
      </div>

      {/* ── Report bar ── */}
      {report && (
        <div className="ac-report">
          <span className="ac-report__label">✓ Report ready</span>
          <button
            className="ac-report__btn"
            onClick={() => window.open(`/api/report/${report.runId}`, '_blank', 'noopener')}
          >
            Open Report
          </button>
          <a
            className="ac-report__btn ac-report__btn--dl"
            href={`/api/report/${report.runId}/download`}
          >
            Download
          </a>
        </div>
      )}

      {/* ── Tool picker ── */}
      <div className="ac-tools-section">
        <button
          className="ac-tools-toggle"
          onClick={() => setShowPicker(p => !p)}
          type="button"
        >
          <span>⚙ Tools: {selCount === 0 ? 'Auto-detect' : `${selCount} selected`}</span>
          <span className="ac-tools-toggle__caret">{showPicker ? '▼' : '▲'}</span>
        </button>

        {showPicker && (
          <div className="ac-tools-panel">
            <div className="ac-tools-panel__bar">
              <span className="ac-tools-panel__hint">
                {selCount === 0 ? 'None selected — agent picks from your prompt' : `${selCount} of ${MAX_TOOLS} max selected`}
              </span>
              <button className="ac-tools-panel__clear" onClick={() => setSelectedTools(new Set())} type="button">
                Clear
              </button>
            </div>
            <div className="ac-tools-grid">
              {toolList.map(t => (
                <label
                  key={t.name}
                  className={`ac-tool-chip ${selectedTools.has(t.name) ? 'ac-tool-chip--on' : ''}`}
                  title={t.description}
                >
                  <input
                    type="checkbox"
                    checked={selectedTools.has(t.name)}
                    onChange={() => toggleTool(t.name)}
                  />
                  {t.name}
                </label>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* ── Target Domain ── */}
      <div className="ac-domain-section">
        <label className="ac-domain-label">TARGET DOMAIN / IP</label>
        <div className="ac-domain-row">
          <input
            className={`ac-domain-input ${domainError ? 'ac-domain-input--error' : domain ? 'ac-domain-input--ok' : ''}`}
            placeholder="https://example.com  or  192.168.1.1"
            value={domain}
            onChange={e => { setDomain(e.target.value); setDomainError('') }}
            onBlur={() => domain && setDomainError(validateDomain(domain))}
          />
          {domain && !domainError && <span className="ac-domain-check">✓</span>}
        </div>
        {domainError && <p className="ac-domain-err">{domainError}</p>}
      </div>

      {/* ── Input ── */}
      <div className="ac-input-row">
        <input
          ref={inputRef}
          className="ac-input"
          placeholder="Describe what to scan… (e.g. scan open ports)"
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && !e.shiftKey && send()}
          disabled={loading}
        />
        {loading ? (
          <button className="ac-send ac-send--stop" onClick={stop} title="Stop run">
            ■
          </button>
        ) : (
          <button className="ac-send" onClick={send} title="Send">
            ↑
          </button>
        )}
      </div>
    </section>
  )
}
