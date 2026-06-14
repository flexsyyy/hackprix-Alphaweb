import { useState, useEffect, useMemo, useRef } from 'react'
import './FileAnalyzerCenter.css'

const SEV_ORDER = ['critical', 'high', 'medium', 'low', 'info']

const SEV_COLORS = {
  critical: 'var(--red)',
  high:     '#e06c75',
  medium:   'var(--gold)',
  low:      'var(--cyan)',
  info:     'var(--text-dim)',
}

function RiskScore({ vulns }) {
  const weights = { critical: 40, high: 15, medium: 5, low: 1, info: 0 }
  const raw   = vulns.reduce((acc, v) => acc + (weights[v.severity] || 0), 0)
  const score = Math.min(100, raw)
  const label = score >= 80 ? 'CRITICAL' : score >= 50 ? 'HIGH' : score >= 25 ? 'MEDIUM' : score > 0 ? 'LOW' : 'CLEAN'
  const color = score >= 80 ? 'var(--red)' : score >= 50 ? '#e06c75' : score >= 25 ? 'var(--gold)' : score > 0 ? 'var(--cyan)' : 'var(--green)'
  return (
    <div className="fac-risk">
      <div className="fac-risk__label">RISK SCORE</div>
      <div className="fac-risk__bar-wrap">
        <div className="fac-risk__bar" style={{ width: `${score}%`, background: color }} />
      </div>
      <div className="fac-risk__nums">
        <span className="fac-risk__score" style={{ color }}>{score}</span>
        <span className="fac-risk__max">/100</span>
        <span className="fac-risk__badge" style={{ color, borderColor: color }}>{label}</span>
      </div>
    </div>
  )
}

// ── Navigation vuln row (right panel) ────────────────────────────────────────
function NavVulnRow({ vuln, focused, onJump }) {
  const hasLine = !!vuln.line
  return (
    <div
      className={[
        'fac-nav-vuln',
        `fac-nav-vuln--${vuln.severity}`,
        focused    ? 'fac-nav-vuln--focused'   : '',
        hasLine    ? 'fac-nav-vuln--clickable'  : '',
      ].filter(Boolean).join(' ')}
      onClick={() => hasLine && onJump?.(vuln.line)}
      role={hasLine ? 'button' : undefined}
      tabIndex={hasLine ? 0 : undefined}
      onKeyDown={e => hasLine && e.key === 'Enter' && onJump?.(vuln.line)}
      title={hasLine ? `Jump to line ${vuln.line}` : undefined}
    >
      <div className="fac-nav-vuln__header">
        <span className={`fac-nav-vuln__sev fac-nav-vuln__sev--${vuln.severity}`}>
          {vuln.severity.toUpperCase()}
        </span>
        <span className="fac-nav-vuln__type">{vuln.type || vuln.issue}</span>
        {hasLine && <span className="fac-nav-vuln__line">L{vuln.line}</span>}
        {hasLine && <span className="fac-nav-vuln__jump">↗</span>}
      </div>
      {vuln.issue && vuln.type && (
        <div className="fac-nav-vuln__issue">{vuln.issue}</div>
      )}
      {vuln.fix && (
        <div className="fac-nav-vuln__fix">
          <span className="fac-nav-vuln__fix-label">Fix →</span>
          {vuln.fix}
        </div>
      )}
    </div>
  )
}

// ── Code viewer (left panel) ──────────────────────────────────────────────────
function CodePane({ content, vulnLines, focusedLine, scrollRef }) {
  // Split on all line-ending styles (\r\n, \r, \n) so CRLF files don't show
  // trailing \r characters or produce a line count mismatch with the backend.
  const lines = content.split(/\r\n|\r|\n/)
  return (
    <div className="fac__code-scroll" ref={scrollRef}>
      <div className="fac__code-inner">
        {/* Gutter */}
        <div className="fac__gutter">
          {lines.map((_, i) => {
            const ln  = i + 1
            const sev = vulnLines[ln]
            return (
              <div
                key={i}
                className={[
                  'fac__lnum',
                  sev               ? `fac__lnum--${sev}` : '',
                  focusedLine === ln ? 'fac__lnum--focused' : '',
                ].filter(Boolean).join(' ')}
              >
                {sev && <span className="fac__lnum-dot">●</span>}
                {ln}
              </div>
            )
          })}
        </div>
        {/* Lines */}
        <div className="fac__lines">
          {lines.map((line, i) => {
            const ln  = i + 1
            const sev = vulnLines[ln]
            return (
              <div
                key={i}
                data-line={ln}
                className={[
                  'fac__line',
                  sev               ? `fac__line--${sev}`  : '',
                  focusedLine === ln ? 'fac__line--focused' : '',
                ].filter(Boolean).join(' ')}
              >
                <span className="fac__line-text">{line || ' '}</span>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────
export default function FileAnalyzerCenter({
  analysisResults,
  loading,
  activeFile,
  fileObj,
}) {
  const [content,    setContent]    = useState(null)
  const [contentErr, setContentErr] = useState(null)
  const [filter,     setFilter]     = useState('all')
  const [focusedLine, setFocusedLine] = useState(null)
  const scrollRef = useRef(null)

  // Load file content whenever fileObj changes
  useEffect(() => {
    setContent(null)
    setContentErr(null)
    setFocusedLine(null)
    if (!fileObj) return
    fileObj.text()
      .then(t  => setContent(t))
      .catch(e => setContentErr('Could not read file: ' + e.message))
  }, [fileObj])

  // Clear focused line on new analysis
  useEffect(() => { setFocusedLine(null) }, [analysisResults])

  // vuln line map: lineNo → highest severity
  const vulnLines = useMemo(() => {
    const map  = {}
    const RANK = { critical: 4, high: 3, medium: 2, low: 1, info: 0 }
    for (const v of analysisResults?.vulnerabilities || []) {
      if (!v.line) continue
      const cur = map[v.line]
      if (cur === undefined || (RANK[v.severity] ?? -1) > (RANK[cur] ?? -1)) {
        map[v.line] = v.severity
      }
    }
    return map
  }, [analysisResults])

  function jumpToLine(line) {
    const ln = Number(line)
    setFocusedLine(ln)
    const el = scrollRef.current?.querySelector(`[data-line="${ln}"]`)
    el?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }

  // Full empty state — no file opened at all
  if (!fileObj && !loading && !analysisResults) {
    return (
      <div className="fac fac--empty">
        <div className="fac-empty__icon">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1"
               strokeLinecap="round" strokeLinejoin="round" width="48" height="48">
            <path d="M12 2L4 6v6c0 5.55 3.84 10.74 8 12 4.16-1.26 8-6.45 8-12V6L12 2z" />
            <polyline points="9,12 11,14 15,10" strokeWidth="1.3" />
          </svg>
        </div>
        <p className="fac-empty__title">No file analyzed yet</p>
        <p className="fac-empty__sub">Upload a file to run SAST scanning</p>
        <div className="fac-empty__steps">
          <div className="fac-empty__step">
            <span className="fac-empty__step-n">1</span> Drop a code file in the left panel
          </div>
          <div className="fac-empty__step">
            <span className="fac-empty__step-n">2</span> Click the file to open it
          </div>
          <div className="fac-empty__step">
            <span className="fac-empty__step-n">3</span> Analysis runs automatically
          </div>
        </div>
      </div>
    )
  }

  const vulns    = analysisResults?.vulnerabilities || []
  const filtered = filter === 'all' ? vulns : vulns.filter(v => v.severity === filter)
  const hasVulns = vulns.length > 0

  return (
    <div className="fac fac--split">

      {/* ── LEFT: Code pane ── */}
      <div className="fac__code-pane">
        <div className="fac__code-header">
          <span className="fac__code-header-file">{activeFile || '—'}</span>
          {content && (
            <span className="fac__code-header-info">
              {content.split(/\r\n|\r|\n/).length} lines
              {Object.keys(vulnLines).length > 0 && (
                <> · <span style={{ color: 'var(--gold)' }}>{Object.keys(vulnLines).length} flagged</span></>
              )}
            </span>
          )}
          {focusedLine && (
            <span className="fac__code-header-focus">
              → L{focusedLine}
              <button className="fac__code-header-clear" onClick={() => setFocusedLine(null)} title="Clear highlight">✕</button>
            </span>
          )}
        </div>

        {contentErr ? (
          <div className="fac__code-msg fac__code-msg--err">{contentErr}</div>
        ) : content ? (
          <CodePane
            content={content}
            vulnLines={vulnLines}
            focusedLine={focusedLine}
            scrollRef={scrollRef}
          />
        ) : (
          <div className="fac__code-msg">
            {fileObj ? 'Loading…' : 'No file selected'}
          </div>
        )}
      </div>

      {/* ── RIGHT: Findings pane ── */}
      <div className="fac__findings-pane">

        {loading && (
          <div className="fac__findings-state">
            <div className="fac-loading__spinner" />
            <p className="fac-loading__text">Running SAST analysis on {activeFile || 'file'}…</p>
          </div>
        )}

        {!loading && !analysisResults && (
          <div className="fac__findings-state">
            <p className="fac-empty__sub">Analysis will run automatically when a file is opened.</p>
          </div>
        )}

        {!loading && analysisResults && (
          <>
            {/* Top bar */}
            <div className="fac__topbar">
              <div className="fac__topbar-left">
                <span className="fac__title">SAST ANALYSIS</span>
                {analysisResults.language && (
                  <span className="fac__lang">{analysisResults.language.toUpperCase()}</span>
                )}
              </div>
              <span className="fac__total">
                {vulns.length} finding{vulns.length !== 1 ? 's' : ''}
              </span>
            </div>

            <div className="fac__body">
              {/* Risk score */}
              <RiskScore vulns={vulns} />

              {/* Filter pills */}
              {hasVulns && (
                <div className="fac__filters">
                  {['all', ...SEV_ORDER.filter(s => vulns.some(v => v.severity === s))].map(s => (
                    <button
                      key={s}
                      className={`fac-filter ${filter === s ? 'fac-filter--active' : ''}`}
                      onClick={() => setFilter(s)}
                      style={filter === s && s !== 'all' ? { color: SEV_COLORS[s], borderColor: SEV_COLORS[s] } : {}}
                    >
                      {s === 'all'
                        ? `All (${vulns.length})`
                        : `${s} (${vulns.filter(v => v.severity === s).length})`}
                    </button>
                  ))}
                </div>
              )}

              {/* Vuln nav list */}
              <div className="fac__vuln-list">
                {!hasVulns && (
                  <div className="fac__clean">
                    <span className="fac__clean-icon">✓</span>
                    <span className="fac__clean-text">No vulnerabilities found</span>
                  </div>
                )}
                {filtered.map((v, i) => (
                  <NavVulnRow
                    key={i}
                    vuln={v}
                    focused={focusedLine === Number(v.line)}
                    onJump={jumpToLine}
                  />
                ))}
              </div>

              {/* Recommendations */}
              {hasVulns && (
                <div className="fac__recs">
                  <div className="fac__recs-title">RECOMMENDATIONS</div>
                  <div className="fac__recs-list">
                    {vulns.some(v => v.severity === 'critical') && (
                      <div className="fac__rec fac__rec--critical">
                        <span className="fac__rec-icon">⚠</span>
                        Critical issues found. Do not deploy to production until resolved.
                      </div>
                    )}
                    {vulns.some(v => v.type === 'sql_injection' || v.type === 'command_injection') && (
                      <div className="fac__rec">
                        <span className="fac__rec-icon">→</span>
                        Use parameterized queries; avoid direct user-input interpolation.
                      </div>
                    )}
                    {vulns.some(v => v.type === 'hardcoded_secret') && (
                      <div className="fac__rec">
                        <span className="fac__rec-icon">→</span>
                        Move secrets to environment variables or a secrets manager.
                      </div>
                    )}
                    {vulns.some(v => v.type === 'xss') && (
                      <div className="fac__rec">
                        <span className="fac__rec-icon">→</span>
                        Sanitize HTML output with DOMPurify or set a Content Security Policy.
                      </div>
                    )}
                    {vulns.some(v => v.type === 'weak_crypto') && (
                      <div className="fac__rec">
                        <span className="fac__rec-icon">→</span>
                        Replace MD5/SHA1 with SHA-256+; use bcrypt/argon2 for passwords.
                      </div>
                    )}
                    <div className="fac__rec">
                      <span className="fac__rec-icon">→</span>
                      Run this scanner in CI/CD to catch issues before production.
                    </div>
                  </div>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
