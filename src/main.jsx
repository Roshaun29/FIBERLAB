import React, { useState } from 'react'
import ReactDOM from 'react-dom/client'
import NetworkBuilder from './NetworkBuilder.jsx'
import SignalVisualizer from './SignalVisualizer.jsx'
import FaultSimulator from './FaultSimulator.jsx'
import RoutingVisualizer from './RoutingVisualizer.jsx'
import LightPropagationLab from './LightPropagationLab.jsx'

const TABS = [
  { id: 'network', icon: '⬡', label: 'NETWORK'  },
  { id: 'signal',  icon: '∿', label: 'SIGNAL'   },
  { id: 'fault',   icon: '⚡', label: 'FAULT'    },
  { id: 'routing', icon: '⇌', label: 'ROUTING'  },
  { id: 'light',   icon: '◈', label: 'LIGHT'    },
];

// Height of the top nav bar — keep in sync with the nav div's height
const NAV_H = 52;

function App() {
  const [view, setView] = useState('network');

  return (
    <div style={{
      width: '100vw', height: '100vh',
      display: 'flex', flexDirection: 'column',
      background: '#000', overflow: 'hidden',
      fontFamily: "'Courier New', Courier, monospace",
    }}>

      {/* ── TOP NAV BAR ── */}
      <div style={{
        height: NAV_H,
        flexShrink: 0,
        display: 'flex',
        alignItems: 'center',
        background: '#0a0a0a',
        borderBottom: '1px solid #2a2a2a',
        padding: '0 20px',
        gap: 0,
        zIndex: 100,
        userSelect: 'none',
      }}>
        {/* Brand */}
        <div style={{
          fontSize: 14,
          letterSpacing: '0.35em',
          color: '#fff',
          fontWeight: 'bold',
          marginRight: 32,
          whiteSpace: 'nowrap',
        }}>
          FIBER<span style={{ color: '#555' }}>LAB</span>
        </div>

        {/* Tabs */}
        <div style={{ display: 'flex', height: '100%', gap: 0, flex: 1 }}>
          {TABS.map(({ id, icon, label }) => {
            const active = view === id;
            return (
              <button
                key={id}
                id={`nav-tab-${id}`}
                onClick={() => setView(id)}
                style={{
                  height: '100%',
                  padding: '0 24px',
                  background: active ? 'rgba(255,255,255,0.06)' : 'transparent',
                  border: 'none',
                  borderBottom: active ? '2px solid #fff' : '2px solid transparent',
                  color: active ? '#fff' : '#888',
                  fontFamily: "'Courier New', monospace",
                  fontSize: 13,
                  letterSpacing: '0.2em',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  transition: 'color 150ms, background 150ms, border-color 150ms',
                  whiteSpace: 'nowrap',
                }}
                onMouseEnter={e => {
                  if (!active) {
                    e.currentTarget.style.color = '#ccc';
                    e.currentTarget.style.background = 'rgba(255,255,255,0.03)';
                  }
                }}
                onMouseLeave={e => {
                  if (!active) {
                    e.currentTarget.style.color = '#888';
                    e.currentTarget.style.background = 'transparent';
                  }
                }}
              >
                <span style={{ fontSize: 16, lineHeight: 1 }}>{icon}</span>
                <span>{label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* ── PAGE CONTENT — fills exact remaining height ── */}
      <div style={{ flex: 1, overflow: 'hidden', display: 'flex', minHeight: 0 }}>
        {view === 'network'  && <NetworkBuilder />}
        {view === 'signal'   && <SignalVisualizer />}
        {view === 'fault'    && <FaultSimulator />}
        {view === 'routing'  && <RoutingVisualizer />}
        {view === 'light'    && <LightPropagationLab />}
      </div>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode><App /></React.StrictMode>
)
