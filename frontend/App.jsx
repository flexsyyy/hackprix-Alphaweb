import { useState, useCallback, useRef, useEffect } from 'react'
import ActivityBar        from './components/ActivityBar/ActivityBar.jsx'
import SideBar            from './components/SideBar/SideBar.jsx'
import Editor             from './components/Editor/Editor.jsx'
import Terminal           from './components/Terminal/Terminal.jsx'
import AgentChat          from './components/AgentChat/AgentChat.jsx'
import StatusBar          from './components/StatusBar/StatusBar.jsx'
import ToolExecutionPanel from './components/ToolExecutionPanel/ToolExecutionPanel.jsx'
import FileAnalyzerCenter from './components/FileAnalyzerCenter/FileAnalyzerCenter.jsx'
import './App.css'

export default function App() {
  // 'toolDiagnosis' | 'fileAnalyzer'
  const [activeView, setActiveView] = useState('toolDiagnosis')

  // Theme
  const [theme, setTheme] = useState(() => localStorage.getItem('alphaweb-theme') || 'dark')

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
    localStorage.setItem('alphaweb-theme', theme)
  }, [theme])

  const toggleTheme = useCallback(() => {
    setTheme(t => (t === 'dark' ? 'light' : 'dark'))
  }, [])

  // Editor open tabs (used by File Analyzer workspace)
  const [openFiles, setOpenFiles]   = useState([])
  const [activeFile, setActiveFile] = useState(null)

  // Terminal controls (Tool Diagnosis workspace)
  const [termVisible,   setTermVisible]   = useState(true)
  const [termMaximized, setTermMaximized] = useState(false)
  const [termClearKey,  setTermClearKey]  = useState(0)
  const [termLogs,      setTermLogs]      = useState([])
  const addTermLogs = useCallback((lines) => setTermLogs(prev => [...prev, ...lines]), [])

  // Scan progress and alerts
  const [scanProgress, setScanProgress] = useState({ done: 0, total: 0, active: false })
  const [alerts, setAlerts] = useState([])

  // Tool command sidebar overrides
  const [activeTool, setActiveTool] = useState(null)
  const [toolCommandOverrides, setToolCommandOverrides] = useState({})
  function handleToolCommandSelect(tool, cmdId, args) {
    setToolCommandOverrides(prev => ({ ...prev, [tool]: args }))
  }

  // Current domain (lifted so ToolExecutionPanel can trigger scans with it)
  const [currentDomain, setCurrentDomain] = useState('')

  // Queued scan triggered externally (e.g. command clicked in execution panel)
  const [queuedScan, setQueuedScan] = useState(null)

  function handleCommandRun(tool, args) {
    if (!currentDomain) return
    setToolCommandOverrides(prev => ({ ...prev, [tool]: args }))
    setQueuedScan({ id: Date.now(), prompt: `run ${tool}`, tools: [tool] })
  }

  // ── Tool Execution Activity (ToolExecutionPanel) ──────────────────────────
  const [activity, setActivity] = useState([])
  const activityRef = useRef([])

  const onExecutionEvent = useCallback((evt) => {
    if (evt.type === 'run_start') {
      const queued = (evt.tools || []).slice(1).map((t, i) => ({
        id: `${t}-${Date.now()}-q${i}`, tool: t,
        status: 'queued', logs: [], queuePos: i + 2,
        startTime: null, endTime: null,
      }))
      activityRef.current = queued
      setActivity([...queued])
    }

    if (evt.type === 'tool_start') {
      const prev = activityRef.current
      const idx = prev.findIndex(e => e.tool === evt.tool && e.status === 'queued')
      let next
      if (idx !== -1) {
        next = prev.map((e, i) => i === idx
          ? { ...e, status: 'running', startTime: Date.now(), command: evt.command || null, args: evt.args || null }
          : e)
      } else {
        const entry = {
          id: `${evt.tool}-${Date.now()}`, tool: evt.tool,
          status: 'running', logs: [], startTime: Date.now(),
          endTime: null, command: evt.command || null, args: evt.args || null,
        }
        next = [...prev, entry]
      }
      activityRef.current = next
      setActivity([...next])
    }

    if (evt.type === 'tool_line') {
      const next = activityRef.current.map(e =>
        e.tool === evt.tool && e.status === 'running'
          ? { ...e, logs: [...e.logs, evt.line] }
          : e
      )
      activityRef.current = next
      setActivity([...next])
    }

    if (evt.type === 'tool_done') {
      const next = activityRef.current.map(e =>
        e.tool === evt.tool && e.status === 'running'
          ? { ...e, status: evt.exit_code === 0 ? 'done' : 'error', endTime: Date.now(), exitCode: evt.exit_code }
          : e
      )
      activityRef.current = next
      setActivity([...next])
    }

    if (evt.type === 'done' || evt.type === 'cancelled') {
      // Mark any still-running entries as done
      const next = activityRef.current.map(e =>
        e.status === 'running' ? { ...e, status: 'done', endTime: Date.now() } : e
      )
      activityRef.current = next
      setActivity([...next])
    }
  }, [])

  // ── SAST Analysis (File Analyzer) ────────────────────────────────────────
  const [sastResults,  setSastResults]  = useState(null)
  const [sastLoading,  setSastLoading]  = useState(false)

  const runSastAnalysis = useCallback(async (file) => {
    if (!file?.fileObj) return
    setSastLoading(true)
    setSastResults(null)
    try {
      const text = await file.fileObj.text()
      const res  = await fetch('/api/analyze-code', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ code: text, filename: file.name }),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      setSastResults(data)
    } catch (e) {
      setSastResults({ error: e.message, vulnerabilities: [] })
    } finally {
      setSastLoading(false)
    }
  }, [])

  const openFile = useCallback((file) => {
    setOpenFiles(prev =>
      prev.find(f => f.name === file.name) ? prev : [...prev, file]
    )
    setActiveFile(file.name)
    // Auto-run SAST when file opened in file analyzer workspace
    if (activeView === 'fileAnalyzer') {
      runSastAnalysis(file)
    }
  }, [activeView, runSastAnalysis])

  const closeTab = useCallback((name) => {
    setOpenFiles(prev => {
      const next = prev.filter(f => f.name !== name)
      if (activeFile === name) {
        setActiveFile(next.length > 0 ? next[next.length - 1].name : null)
      }
      return next
    })
  }, [activeFile])

  // Toast
  const [toast, setToast] = useState(null)
  function showToast(msg, type = 'success') {
    setToast({ msg, type })
    setTimeout(() => setToast(null), 3200)
  }

  const isTD = activeView === 'toolDiagnosis'
  const isFA = activeView === 'fileAnalyzer'

  return (
    <div className={[
      'app',
      `app--${activeView}`,
      isTD && termMaximized  ? 'app--term-max'    : '',
      isTD && !termVisible   ? 'app--term-hidden' : '',
    ].filter(Boolean).join(' ')}>

      <ActivityBar
        activeView={activeView}
        setActiveView={setActiveView}
        theme={theme}
        onToggleTheme={toggleTheme}
      />

      {/* ── Tool Diagnosis workspace ── */}
      {isTD && (
        <ToolExecutionPanel
          activity={activity}
          activeTool={activeTool}
          hasDomain={!!currentDomain}
          onCommandRun={handleCommandRun}
        />
      )}

      {/* ── File Analyzer sidebar (dropzone only) ── */}
      {isFA && (
        <SideBar
          activeView={activeView}
          activeFile={activeFile}
          onFileOpen={openFile}
          onToast={showToast}
          activeTool={null}
          toolCommandOverrides={{}}
          onToolCommandSelect={() => {}}
        />
      )}

      {/* ── Center: Terminal (Tool Diagnosis) or SAST Results (File Analyzer) ── */}
      {isTD && (
        <Terminal
          clearKey={termClearKey}
          logs={termLogs}
          alerts={alerts}
          maximized={termMaximized}
          visible={termVisible}
          onLog={addTermLogs}
          onClear={() => { setTermClearKey(k => k + 1); setTermLogs([]); setAlerts([]); showToast('Console cleared', 'info') }}
          onMaximize={() => setTermMaximized(m => !m)}
          onClose={() => setTermVisible(false)}
        />
      )}

      {isFA && (
        <FileAnalyzerCenter
          analysisResults={sastResults}
          loading={sastLoading}
          activeFile={activeFile}
          fileObj={openFiles.find(f => f.name === activeFile)?.fileObj ?? null}
        />
      )}

      {/* ── Right: AlphaWeb Agent (Tool Diagnosis only) ── */}
      {isTD && (
        <AgentChat
          onScanOutput={addTermLogs}
          onProgress={setScanProgress}
          onAlerts={setAlerts}
          onToolStart={setActiveTool}
          toolCommandOverrides={toolCommandOverrides}
          onExecutionEvent={onExecutionEvent}
          onDomainChange={setCurrentDomain}
          queuedScan={queuedScan}
        />
      )}

      <StatusBar
        activeFile={activeFile}
        termVisible={termVisible}
        scanProgress={scanProgress}
        onReopenTerminal={() => setTermVisible(true)}
      />

      {toast && (
        <div className={`toast toast--${toast.type}`} key={`${toast.msg}-${Date.now()}`}>
          <span>{toast.type === 'success' ? '✓' : toast.type === 'error' ? '✗' : 'ℹ'}</span>
          {toast.msg}
        </div>
      )}
    </div>
  )
}
