import { useState, useCallback, useRef, useEffect } from 'react'
import ActivityBar from './components/ActivityBar/ActivityBar.jsx'
import SideBar     from './components/SideBar/SideBar.jsx'
import Editor      from './components/Editor/Editor.jsx'
import Terminal    from './components/Terminal/Terminal.jsx'
import AgentChat   from './components/AgentChat/AgentChat.jsx'
import StatusBar   from './components/StatusBar/StatusBar.jsx'
import './App.css'

export default function App() {
  const [activeView, setActiveView] = useState('scanner')

  // Theme
  const [theme, setTheme] = useState(() => localStorage.getItem('alphaweb-theme') || 'dark')

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
    localStorage.setItem('alphaweb-theme', theme)
  }, [theme])

  const toggleTheme = useCallback(() => {
    setTheme(t => (t === 'dark' ? 'light' : 'dark'))
  }, [])

  // Editor open tabs
  const [openFiles, setOpenFiles]   = useState([])
  const [activeFile, setActiveFile] = useState(null)

  // Terminal controls
  const [termVisible,   setTermVisible]   = useState(true)
  const [termMaximized, setTermMaximized] = useState(false)
  const [termClearKey,  setTermClearKey]  = useState(0)

  // Terminal console logs (from scan output)
  const [termLogs, setTermLogs] = useState([])
  const addTermLogs = useCallback((lines) => setTermLogs(prev => [...prev, ...lines]), [])

  // Live scan progress — driven by AgentChat run events
  const [scanProgress, setScanProgress] = useState({ done: 0, total: 0, active: false })

  // Vulnerability alerts from the last run
  const [alerts, setAlerts] = useState([])

  // Active tool (set when a tool starts running — drives SideBar command panel)
  const [activeTool, setActiveTool] = useState(null)

  // Per-tool arg overrides selected in SideBar
  const [toolCommandOverrides, setToolCommandOverrides] = useState({})

  function handleToolCommandSelect(tool, cmdId, args) {
    setToolCommandOverrides(prev => ({ ...prev, [tool]: args }))
  }

  // Toast
  const [toast, setToast] = useState(null)

  function showToast(msg, type = 'success') {
    setToast({ msg, type })
    setTimeout(() => setToast(null), 3200)
  }

  const openFile = useCallback((file) => {
    setOpenFiles(prev =>
      prev.find(f => f.name === file.name) ? prev : [...prev, file]
    )
    setActiveFile(file.name)
  }, [])

  const closeTab = useCallback((name) => {
    setOpenFiles(prev => {
      const next = prev.filter(f => f.name !== name)
      if (activeFile === name) {
        setActiveFile(next.length > 0 ? next[next.length - 1].name : null)
      }
      return next
    })
  }, [activeFile])

  return (
    <div className={[
      'app',
      termMaximized  ? 'app--term-max'    : '',
      !termVisible   ? 'app--term-hidden' : '',
    ].join(' ')}>

      <ActivityBar
        activeView={activeView}
        setActiveView={setActiveView}
        theme={theme}
        onToggleTheme={toggleTheme}
      />

      <SideBar
        activeView={activeView}
        activeFile={activeFile}
        onFileOpen={openFile}
        onToast={showToast}
        activeTool={activeTool}
        toolCommandOverrides={toolCommandOverrides}
        onToolCommandSelect={handleToolCommandSelect}
      />

      <Editor
        openFiles={openFiles}
        activeFile={activeFile}
        onTabClick={setActiveFile}
        onCloseTab={closeTab}
      />

      <AgentChat
        onScanOutput={addTermLogs}
        onProgress={setScanProgress}
        onAlerts={setAlerts}
        onToolStart={setActiveTool}
        toolCommandOverrides={toolCommandOverrides}
      />

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
