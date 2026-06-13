import './ActivityBar.css'

const NAV_ITEMS = [
  {
    id: 'scanner',
    label: 'Scanner / Analysis',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="11" cy="11" r="7" />
        <line x1="21" y1="21" x2="16.65" y2="16.65" />
        <text x="7.5" y="13.5" fontSize="4.5" fill="currentColor" stroke="none" fontFamily="monospace" fontWeight="bold">01</text>
      </svg>
     ),
  },
  {
    id: 'reporting',
    label: 'Reporting',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 2L4 6v6c0 5.55 3.84 10.74 8 12 4.16-1.26 8-6.45 8-12V6L12 2z" />
        <polyline points="9,12 11,14 15,10" />
        <line x1="8" y1="17" x2="11" y2="17" />
        <line x1="13" y1="17" x2="16" y2="17" />
      </svg>
    ),
  },
  {
    id: 'orchestration',
    label: 'Orchestration',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <rect x="2" y="2" width="8" height="8" rx="1.5" />
        <rect x="14" y="2" width="8" height="8" rx="1.5" />
        <rect x="2" y="14" width="8" height="8" rx="1.5" />
        <rect x="14" y="14" width="8" height="8" rx="1.5" />
        <circle cx="18" cy="18" r="2.2" fill="currentColor" stroke="none" opacity="0.8" />
        <path d="M18 15.8v-.8M20.2 18h.8M18 20.2v.8M15.8 18h-.8" stroke="var(--bg-primary)" strokeWidth="0.8" />
      </svg>
    ),
  },
]

const SunIcon = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="4.5" />
    <path d="M12 1.5v3M12 19.5v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M1.5 12h3M19.5 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1" />
  </svg>
)

const MoonIcon = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5z" />
  </svg>
)

export default function ActivityBar({ activeView, setActiveView, theme, onToggleTheme }) {
  return (
    <aside className="activity-bar">
      <div className="activity-bar__logo" title="AlphaWeb Platform">
        <span className="activity-bar__logo-glyph">⍺</span>
      </div>

      <nav className="activity-bar__nav">
        {NAV_ITEMS.map((item) => (
          <button
            key={item.id}
            className={`ab-btn ${activeView === item.id ? 'ab-btn--active' : ''}`}
            title={item.label}
            onClick={() => setActiveView(item.id)}
          >
            <span className="ab-btn__icon">{item.icon}</span>
            <span className="ab-btn__tooltip">{item.label}</span>
          </button>
        ))}
      </nav>

      <div className="activity-bar__bottom">
        <button
          className="ab-btn"
          title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
          onClick={onToggleTheme}
        >
          <span className="ab-btn__icon">{theme === 'dark' ? SunIcon : MoonIcon}</span>
          <span className="ab-btn__tooltip">{theme === 'dark' ? 'Light mode' : 'Dark mode'}</span>
        </button>
      </div>
    </aside>
  )
}
