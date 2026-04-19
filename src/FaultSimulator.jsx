import { useState, useReducer, useEffect, useRef, useCallback } from 'react';

// ─── CSS Keyframes ─────────────────────────────────────────────────────────────
const CSS_ANIM = `
  @keyframes fault-pulse { 0%,100%{opacity:1} 50%{opacity:0.15} }
  @keyframes signal-flow { from{stroke-dashoffset:0} to{stroke-dashoffset:-24} }
  @keyframes reroute-flow { from{stroke-dashoffset:0} to{stroke-dashoffset:-16} }
  @keyframes badge-critical { 0%,100%{border-color:rgba(255,32,32,1);box-shadow:0 0 10px rgba(255,32,32,0.4)} 50%{border-color:rgba(255,32,32,0.3);box-shadow:none} }
  @keyframes sig-lost { 0%,100%{opacity:1} 50%{opacity:0.2} }
  @keyframes ripple-out { 0%{transform:scale(0.4);opacity:1} 100%{transform:scale(1);opacity:0} }
  @keyframes recovery { 0%{fill-opacity:0.35} 100%{fill-opacity:0} }
  @keyframes pending-warn { 0%,100%{stroke-opacity:1} 50%{stroke-opacity:0.15} }
`;

// ─── Preset Topology ──────────────────────────────────────────────────────────
const PRESET_NODES = [
  { id: 'src', label: 'SRC',    x: 90,  y: 290, r: 20, isSrc: true  },
  { id: 'dst', label: 'DST',    x: 910, y: 290, r: 20, isDst: true  },
  { id: 'bb1', label: 'BB-1',  x: 310, y: 185, r: 26, isBackbone: true },
  { id: 'bb2', label: 'BB-2',  x: 690, y: 185, r: 26, isBackbone: true },
  { id: 'e1',  label: 'Edge-1', x: 175, y: 400, r: 18 },
  { id: 'e2',  label: 'Edge-2', x: 825, y: 400, r: 18 },
  { id: 'e3',  label: 'Edge-3', x: 500, y: 100, r: 18 },
  { id: 'e4',  label: 'Edge-4', x: 500, y: 415, r: 18 },
];

const PRESET_LINKS = [
  { id: 'l1',  sourceId: 'src', targetId: 'bb1', label: 'SRC↔BB1'    },
  { id: 'l2',  sourceId: 'src', targetId: 'e1',  label: 'SRC↔E1'     },
  { id: 'l3',  sourceId: 'bb1', targetId: 'bb2', label: 'BB1↔BB2[A]', parallelOffset: -10 },
  { id: 'l4',  sourceId: 'bb1', targetId: 'bb2', label: 'BB1↔BB2[B]', parallelOffset:  10 },
  { id: 'l5',  sourceId: 'bb1', targetId: 'e3',  label: 'BB1↔E3'     },
  { id: 'l6',  sourceId: 'bb2', targetId: 'dst', label: 'BB2↔DST'    },
  { id: 'l7',  sourceId: 'bb2', targetId: 'e2',  label: 'BB2↔E2'     },
  { id: 'l8',  sourceId: 'e3',  targetId: 'bb2', label: 'E3↔BB2'     },
  { id: 'l9',  sourceId: 'e1',  targetId: 'e4',  label: 'E1↔E4'      },
  { id: 'l10', sourceId: 'e4',  targetId: 'e2',  label: 'E4↔E2'      },
  { id: 'l11', sourceId: 'e2',  targetId: 'dst', label: 'E2↔DST'     },
  { id: 'l12', sourceId: 'bb1', targetId: 'e4',  label: 'BB1↔E4'     },
];

// ─── Pathfinding ──────────────────────────────────────────────────────────────
function dijkstra(nodes, links, faultedIds, srcId, dstId) {
  const dist = {}, prev = {};
  nodes.forEach(n => { dist[n.id] = Infinity; prev[n.id] = null; });
  dist[srcId] = 0;
  const adj = {};
  nodes.forEach(n => (adj[n.id] = []));
  const nmap = Object.fromEntries(nodes.map(n => [n.id, n]));
  links.forEach(l => {
    if (faultedIds.has(l.id)) return;
    const a = nmap[l.sourceId], b = nmap[l.targetId];
    if (!a || !b) return;
    const d = Math.hypot(a.x - b.x, a.y - b.y);
    adj[l.sourceId].push({ to: l.targetId, d });
    adj[l.targetId].push({ to: l.sourceId, d });
  });
  const unvis = new Set(nodes.map(n => n.id));
  while (unvis.size) {
    let u = null;
    unvis.forEach(id => { if (u === null || dist[id] < dist[u]) u = id; });
    if (u === dstId || dist[u] === Infinity) break;
    unvis.delete(u);
    for (const { to, d } of adj[u] || []) {
      if (!unvis.has(to)) continue;
      const alt = dist[u] + d;
      if (alt < dist[to]) { dist[to] = alt; prev[to] = u; }
    }
  }
  if (dist[dstId] === Infinity) return { found: false, path: [], totalDistance: 0 };
  const path = [];
  for (let c = dstId; c !== null; c = prev[c]) path.unshift(c);
  return { found: true, path, totalDistance: Math.round(dist[dstId]) };
}

function bfsReachable(nodes, links, faultedIds, srcId) {
  const adj = {};
  nodes.forEach(n => (adj[n.id] = []));
  links.forEach(l => {
    if (faultedIds.has(l.id)) return;
    if (l.sourceId && l.targetId) { adj[l.sourceId].push(l.targetId); adj[l.targetId].push(l.sourceId); }
  });
  const vis = new Set([srcId]);
  const q = [srcId];
  while (q.length) {
    const cur = q.shift();
    for (const nb of adj[cur] || []) { if (!vis.has(nb)) { vis.add(nb); q.push(nb); } }
  }
  return vis;
}

function findAllPaths(nodes, links, faultedIds, srcId, dstId, max = 4) {
  const nmap = Object.fromEntries(nodes.map(n => [n.id, n]));
  const adj = {};
  nodes.forEach(n => (adj[n.id] = []));
  links.forEach(l => {
    if (faultedIds.has(l.id)) return;
    const a = nmap[l.sourceId], b = nmap[l.targetId];
    if (!a || !b) return;
    const d = Math.hypot(a.x - b.x, a.y - b.y);
    adj[l.sourceId].push({ to: l.targetId, d });
    adj[l.targetId].push({ to: l.sourceId, d });
  });
  const results = [];
  const vis = new Set();
  function dfs(cur, path, dist) {
    if (results.length >= max) return;
    if (cur === dstId) { results.push({ path: [...path], distance: Math.round(dist) }); return; }
    vis.add(cur);
    for (const { to, d } of adj[cur] || []) { if (!vis.has(to)) { path.push(to); dfs(to, path, dist + d); path.pop(); } }
    vis.delete(cur);
  }
  dfs(srcId, [srcId], 0);
  results.sort((a, b) => a.distance - b.distance);
  return results;
}

function getPathLinkIds(links, path) {
  const ids = new Set();
  for (let i = 0; i < path.length - 1; i++) {
    const from = path[i], to = path[i + 1];
    const lnk = links.find(l => (l.sourceId === from && l.targetId === to) || (l.sourceId === to && l.targetId === from));
    if (lnk) ids.add(lnk.id);
  }
  return ids;
}

function uid() { return Math.random().toString(36).slice(2, 8); }
function ts() { return new Date().toLocaleTimeString('en', { hour12: false }); }

function normCoords(nodes, tw = 850, th = 480, padX = 75, padY = 55) {
  if (!nodes.length) return nodes;
  const xs = nodes.map(n => n.x), ys = nodes.map(n => n.y);
  const mnX = Math.min(...xs), mxX = Math.max(...xs);
  const mnY = Math.min(...ys), mxY = Math.max(...ys);
  const rX = mxX - mnX || 1, rY = mxY - mnY || 1;
  const scale = Math.min(tw / rX, th / rY) * 0.85;
  const offX = (tw - rX * scale) / 2;
  const offY = (th - rY * scale) / 2;
  return nodes.map(n => ({ ...n, x: padX + offX + (n.x - mnX) * scale, y: padY + offY + (n.y - mnY) * scale }));
}

function computeAll(nodes, links, faultedLinks) {
  const srcNode = nodes.find(n => n.isSrc) ?? nodes[0];
  const dstNode = nodes.find(n => n.isDst) ?? nodes[nodes.length - 1];
  if (!srcNode || !dstNode || srcNode.id === dstNode.id) return null;
  const pathResult = dijkstra(nodes, links, faultedLinks, srcNode.id, dstNode.id);
  const allPaths = findAllPaths(nodes, links, faultedLinks, srcNode.id, dstNode.id, 4);
  const reachable = bfsReachable(nodes, links, faultedLinks, srcNode.id);
  const status = faultedLinks.size === 0 ? 'NOMINAL' : pathResult.found ? 'DEGRADED' : 'CRITICAL';
  return { pathResult, allPaths, reachable, status, srcId: srcNode.id, dstId: dstNode.id };
}

// ─── Reducer ──────────────────────────────────────────────────────────────────
function makeInitial() {
  const nodes = PRESET_NODES, links = PRESET_LINKS;
  const faultedLinks = new Set();
  const c = computeAll(nodes, links, faultedLinks);
  return { nodes, links, faultedLinks, pathResult: c.pathResult, allPaths: c.allPaths, reachable: c.reachable, status: 'NOMINAL', srcId: c.srcId, dstId: c.dstId, faultLog: [], autoFault: false, autoFaultSpeed: 1, pendingFaultId: null };
}

function reducer(state, action) {
  switch (action.type) {
    case 'APPLY': {
      const { faultedLinks, pathResult, allPaths, reachable, status, logEntry, pendingFaultId = null } = action;
      return { ...state, faultedLinks, pathResult, allPaths, reachable, status, pendingFaultId, faultLog: logEntry ? [logEntry, ...state.faultLog].slice(0, 10) : state.faultLog };
    }
    case 'SET_PENDING': return { ...state, pendingFaultId: action.linkId };
    case 'SET_AUTO_FAULT': return { ...state, autoFault: action.value };
    case 'SET_SPEED': return { ...state, autoFaultSpeed: parseFloat(action.value) };
    case 'LOAD_NETWORK': {
      const rawNodes = action.nodes.map((n, i) => ({ ...n, r: n.r ?? 18, isSrc: n.isSource === true || i === 0, isDst: i === action.nodes.length - 1, isBackbone: n.isBackbone ?? false }));
      const nodes = normCoords(rawNodes), links = action.links, faultedLinks = new Set();
      const c = computeAll(nodes, links, faultedLinks);
      if (!c) return state;
      return { ...state, nodes, links, faultedLinks, pathResult: c.pathResult, allPaths: c.allPaths, reachable: c.reachable, status: 'NOMINAL', srcId: c.srcId, dstId: c.dstId, pendingFaultId: null, faultLog: [{ time: ts(), msg: `LOADED: ${nodes.length} NODES, ${links.length} LINKS`, type: 'info' }] };
    }
    case 'RESET': return { ...makeInitial(), autoFault: state.autoFault, autoFaultSpeed: state.autoFaultSpeed };
    default: return state;
  }
}

// ─── Fault Marker ─────────────────────────────────────────────────────────────
function FaultX({ x, y }) {
  const s = 9;
  return (
    <g pointerEvents="none">
      <circle cx={x} cy={y} r={14} fill="rgba(255,32,32,0.15)" />
      <line x1={x - s} y1={y - s} x2={x + s} y2={y + s} stroke="#ff3030" strokeWidth={2.5} strokeLinecap="round" />
      <line x1={x + s} y1={y - s} x2={x - s} y2={y + s} stroke="#ff3030" strokeWidth={2.5} strokeLinecap="round" />
    </g>
  );
}

// ─── Sidebar Button ───────────────────────────────────────────────────────────
function SBtn({ onClick, disabled, danger, children }) {
  const [hov, setHov] = useState(false);
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{
        display: 'block', width: '100%',
        padding: '10px 12px', marginBottom: 8,
        background: hov && !disabled ? 'rgba(255,255,255,0.04)' : 'transparent',
        border: `1px solid ${danger ? (hov ? 'rgba(255,60,60,0.8)' : 'rgba(255,60,60,0.4)') : (hov ? '#555' : '#2a2a2a')}`,
        color: disabled ? '#2a2a2a' : danger ? (hov ? '#ff7070' : 'rgba(255,80,80,0.85)') : (hov ? '#fff' : '#888'),
        fontFamily: "'Courier New', monospace",
        fontSize: 12, letterSpacing: '0.12em',
        cursor: disabled ? 'not-allowed' : 'pointer',
        textAlign: 'left',
        transition: 'all 120ms',
        borderRadius: 4,
      }}
    >
      {children}
    </button>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────
export default function FaultSimulator() {
  const [state, dispatch] = useReducer(reducer, null, makeInitial);
  const { nodes, links, faultedLinks, pathResult, allPaths, reachable, status, srcId, dstId, faultLog, autoFault, autoFaultSpeed, pendingFaultId } = state;

  const [ripples, setRipples] = useState([]);
  const [recoverySet, setRecoverySet] = useState(new Set());
  const prevReachRef = useRef(new Set());
  const stateRef = useRef(state);
  stateRef.current = state;

  const autoTimerRef = useRef(null);
  const repairTimersRef = useRef([]);

  useEffect(() => {
    const prev = prevReachRef.current;
    const curr = reachable;
    const lostNodes = nodes.filter(n => prev.has(n.id) && !curr.has(n.id));
    const gainedIds = nodes.map(n => n.id).filter(id => !prev.has(id) && curr.has(id) && prev.size > 0);
    if (lostNodes.length > 0) setRipples(r => [...r, ...lostNodes.map(n => ({ key: uid(), x: n.x, y: n.y }))]);
    if (gainedIds.length > 0) {
      setRecoverySet(s => new Set([...s, ...gainedIds]));
      setTimeout(() => { setRecoverySet(s => { const n = new Set(s); gainedIds.forEach(id => n.delete(id)); return n; }); }, 320);
    }
    prevReachRef.current = curr;
  }, [reachable, nodes]);

  const applyFault = useCallback((newFaulted, logMsg, rawType) => {
    const s = stateRef.current;
    const c = computeAll(s.nodes, s.links, newFaulted);
    if (!c) return;
    let msg = logMsg, type = rawType;
    if (rawType === 'fault') {
      if (!c.pathResult.found) { msg += ' → SIGNAL LOST'; type = 'lost'; }
      else { msg += ' → REROUTED'; type = 'reroute'; }
    }
    dispatch({ type: 'APPLY', faultedLinks: newFaulted, pathResult: c.pathResult, allPaths: c.allPaths, reachable: c.reachable, status: c.status, logEntry: { time: ts(), msg, type } });
  }, []);

  const handleLinkClick = useCallback((linkId) => {
    const s = stateRef.current;
    if (s.pendingFaultId === linkId) return;
    const newF = new Set(s.faultedLinks);
    const repairing = newF.has(linkId);
    const lbl = s.links.find(l => l.id === linkId)?.label ?? linkId;
    if (repairing) { newF.delete(linkId); applyFault(newF, `REPAIRED: ${lbl}`, 'repair'); }
    else { newF.add(linkId); applyFault(newF, `FAULT: ${lbl}`, 'fault'); }
  }, [applyFault]);

  const handleRepair = useCallback((linkId) => {
    const s = stateRef.current;
    const newF = new Set(s.faultedLinks);
    newF.delete(linkId);
    const lbl = s.links.find(l => l.id === linkId)?.label ?? linkId;
    applyFault(newF, `REPAIRED: ${lbl}`, 'repair');
  }, [applyFault]);

  const handleRandomFault = useCallback(() => {
    const s = stateRef.current;
    const healthy = s.links.filter(l => !s.faultedLinks.has(l.id));
    if (!healthy.length) return;
    const lnk = healthy[Math.floor(Math.random() * healthy.length)];
    dispatch({ type: 'SET_PENDING', linkId: lnk.id });
    setTimeout(() => {
      const ns = stateRef.current;
      const newF = new Set(ns.faultedLinks);
      newF.add(lnk.id);
      applyFault(newF, `RANDOM FAULT: ${lnk.label}`, 'fault');
    }, 500);
  }, [applyFault]);

  const handleClearAll = useCallback(() => {
    const s = stateRef.current;
    const ids = [...s.faultedLinks];
    ids.forEach((id, i) => {
      setTimeout(() => {
        const ns = stateRef.current;
        const newF = new Set(ns.faultedLinks);
        newF.delete(id);
        const lbl = ns.links.find(l => l.id === id)?.label ?? id;
        applyFault(newF, `CLEARED: ${lbl}`, 'repair');
      }, i * 110);
    });
  }, [applyFault]);

  const handleLoadNetwork = useCallback(() => {
    try {
      const raw = localStorage.getItem('fiberlab_network');
      if (!raw) return;
      const { nodes: ln, links: ll } = JSON.parse(raw);
      if (ln?.length >= 2) dispatch({ type: 'LOAD_NETWORK', nodes: ln, links: ll });
    } catch {}
  }, []);

  useEffect(() => {
    if (!autoFault) { clearTimeout(autoTimerRef.current); repairTimersRef.current.forEach(clearTimeout); repairTimersRef.current = []; return; }
    function scheduleNext() {
      const delay = (3000 + Math.random() * 5000) / stateRef.current.autoFaultSpeed;
      autoTimerRef.current = setTimeout(() => {
        const s = stateRef.current;
        if (!s.autoFault) return;
        const healthy = s.links.filter(l => !s.faultedLinks.has(l.id));
        if (healthy.length) {
          const lnk = healthy[Math.floor(Math.random() * healthy.length)];
          dispatch({ type: 'SET_PENDING', linkId: lnk.id });
          setTimeout(() => {
            const ns = stateRef.current;
            const newF = new Set(ns.faultedLinks);
            newF.add(lnk.id);
            applyFault(newF, `AUTO-FAULT: ${lnk.label}`, 'fault');
            const rt = setTimeout(() => {
              const rns = stateRef.current;
              if (rns.faultedLinks.has(lnk.id)) {
                const rf = new Set(rns.faultedLinks);
                rf.delete(lnk.id);
                applyFault(rf, `AUTO-REPAIR: ${lnk.label}`, 'repair');
              }
            }, 5000 / stateRef.current.autoFaultSpeed);
            repairTimersRef.current.push(rt);
          }, 500);
        }
        scheduleNext();
      }, delay);
    }
    scheduleNext();
    return () => { clearTimeout(autoTimerRef.current); };
  }, [autoFault, applyFault]);

  const nmap = Object.fromEntries(nodes.map(n => [n.id, n]));
  const activePathLinkIds = pathResult?.found ? getPathLinkIds(links, pathResult.path) : new Set();

  const renderLink = (link) => {
    const a = nmap[link.sourceId], b = nmap[link.targetId];
    if (!a || !b) return null;
    const isFaulted = faultedLinks.has(link.id);
    const isPending = pendingFaultId === link.id;
    const isActive = activePathLinkIds.has(link.id);
    const isDegraded = status === 'DEGRADED';

    let x1 = a.x, y1 = a.y, x2 = b.x, y2 = b.y;
    if (link.parallelOffset) {
      const dx = b.x - a.x, dy = b.y - a.y;
      const len = Math.hypot(dx, dy) || 1;
      const px = (-dy / len) * link.parallelOffset;
      const py = (dx / len) * link.parallelOffset;
      x1 += px; y1 += py; x2 += px; y2 += py;
    }
    const mx = (x1 + x2) / 2, my = (y1 + y2) / 2;

    let lineStyle;
    if (isFaulted) {
      lineStyle = { stroke: '#ff3030', strokeWidth: 3, strokeDasharray: '3 4', animation: 'fault-pulse 600ms ease-in-out infinite' };
    } else if (isPending) {
      lineStyle = { stroke: '#fff', strokeWidth: 3, strokeDasharray: '6 4', animation: 'pending-warn 300ms linear infinite' };
    } else if (isActive) {
      lineStyle = isDegraded
        ? { stroke: 'rgba(255,200,0,0.85)', strokeWidth: 3, strokeDasharray: '5 5', animation: 'reroute-flow 800ms linear infinite' }
        : { stroke: '#fff', strokeWidth: 3, strokeDasharray: 'none', animation: 'signal-flow 800ms linear infinite' };
    } else {
      lineStyle = { stroke: 'rgba(255,255,255,0.35)', strokeWidth: 1.5, strokeDasharray: '6 4' };
    }

    return (
      <g key={link.id} onClick={() => handleLinkClick(link.id)} style={{ cursor: 'pointer' }}>
        <line x1={x1} y1={y1} x2={x2} y2={y2} stroke="transparent" strokeWidth={20} />
        <line x1={x1} y1={y1} x2={x2} y2={y2} style={lineStyle} fill="none" />
        {/* Link label on hover — always show for active/faulted */}
        {(isActive || isFaulted) && (
          <text x={mx} y={my - 8} textAnchor="middle" fill={isFaulted ? '#ff5050' : isActive ? '#fff' : '#666'} fontSize={11} fontFamily="'Courier New',monospace" pointerEvents="none">{link.label}</text>
        )}
        {isFaulted && <FaultX x={mx} y={my} />}
      </g>
    );
  };

  const renderNode = (node) => {
    const alive = reachable.has(node.id);
    const r = node.r ?? 18;
    const stroke = alive ? '#fff' : '#333';
    const isSrc = node.id === srcId;
    const isDst = node.id === dstId;

    return (
      <g key={node.id}>
        {recoverySet.has(node.id) && (
          <circle cx={node.x} cy={node.y} r={r} fill="#fff" style={{ animation: 'recovery 300ms ease-out forwards', fillOpacity: 0.35 }} pointerEvents="none" />
        )}
        {/* Glow for alive nodes */}
        {alive && (
          <circle cx={node.x} cy={node.y} r={r + 8} fill={isSrc ? 'rgba(255,255,255,0.06)' : isDst ? 'rgba(255,255,255,0.05)' : 'rgba(255,255,255,0.03)'} pointerEvents="none" />
        )}
        <circle cx={node.x} cy={node.y} r={r}
          fill={alive ? (isSrc ? 'rgba(255,255,255,0.1)' : 'transparent') : 'transparent'}
          stroke={stroke}
          strokeWidth={node.isBackbone ? 2.5 : 2}
          pointerEvents="none"
        />
        {isSrc && alive && <circle cx={node.x} cy={node.y} r={6} fill="#fff" pointerEvents="none" />}
        {isDst && (
          <circle cx={node.x} cy={node.y} r={r + 7}
            fill="none"
            stroke={alive ? 'rgba(255,255,255,0.3)' : 'rgba(60,60,60,0.3)'}
            strokeWidth={1.5} strokeDasharray="4 4"
            pointerEvents="none"
          />
        )}
        <text x={node.x} y={node.y + r + 18}
          textAnchor="middle"
          fill={alive ? '#fff' : '#333'}
          fontSize={13}
          fontFamily="'Courier New', monospace"
          letterSpacing="0.1em"
          fontWeight={isSrc || isDst ? 'bold' : 'normal'}
          pointerEvents="none"
        >
          {node.label}
        </text>
        {(isSrc || isDst) && (
          <text x={node.x} y={node.y + 5} textAnchor="middle" fill={alive ? (isSrc ? '#000' : '#fff') : '#333'} fontSize={10} fontFamily="'Courier New',monospace" fontWeight="bold" pointerEvents="none">
            {isSrc ? 'SRC' : 'DST'}
          </text>
        )}
      </g>
    );
  };

  const pathLabels = pathResult?.path?.map(id => nodes.find(n => n.id === id)?.label ?? id) ?? [];
  const badgeStyle = {
    NOMINAL:   { color: '#40ff80', border: '1px solid #40ff80', background: 'rgba(0,255,100,0.06)' },
    DEGRADED:  { color: '#ffd700', border: '1px solid #ffd700', background: 'rgba(255,200,0,0.06)' },
    CRITICAL:  { color: '#ff3030', border: '1px solid #ff3030', background: 'rgba(255,0,0,0.08)', animation: 'badge-critical 1.2s infinite' },
  }[status] ?? {};
  const logColors = { fault: '#ff5050', repair: '#40ff80', reroute: '#ffd700', lost: '#ff2020', info: '#666' };

  return (
    <div style={{ display: 'flex', width: '100%', height: '100%', background: '#000', fontFamily: "'Courier New', Courier, monospace", userSelect: 'none', overflow: 'hidden' }}>
      <style>{CSS_ANIM}</style>

      {/* ── SVG Canvas ── */}
      <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
        <svg width="100%" height="100%" viewBox="0 0 1000 580" preserveAspectRatio="xMidYMid meet">
          <defs>
            <pattern id="fs-diag" patternUnits="userSpaceOnUse" width="28" height="28">
              <line x1="0" y1="28" x2="28" y2="0" stroke="#0e0e0e" strokeWidth="1" />
            </pattern>
          </defs>
          <rect width="1000" height="580" fill="#000" />
          <rect width="1000" height="580" fill="url(#fs-diag)" />

          {links.map(renderLink)}

          {ripples.map(r => (
            <circle key={r.key} cx={r.x} cy={r.y} r={48}
              fill="none" stroke="#ff2020" strokeWidth={1.5}
              style={{ transformOrigin: `${r.x}px ${r.y}px`, animation: 'ripple-out 800ms ease-out forwards' }}
              onAnimationEnd={() => setRipples(prev => prev.filter(x => x.key !== r.key))}
              pointerEvents="none"
            />
          ))}

          {nodes.map(renderNode)}

          {/* Canvas hint — now visible */}
          <text x={16} y={28} fontSize={12} fill="#2a2a2a" fontFamily="monospace" letterSpacing="0.18em">
            CLICK LINK TO INJECT FAULT  ·  CLICK AGAIN TO REPAIR
          </text>
        </svg>
      </div>

      {/* ── Sidebar ── */}
      <div style={{ width: 300, flexShrink: 0, background: '#080808', borderLeft: '1px solid #222', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {/* Header */}
        <div style={{ padding: '18px 20px', borderBottom: '1px solid #2a2a2a', flexShrink: 0 }}>
          <div style={{ fontSize: 16, letterSpacing: '0.3em', color: '#fff', fontWeight: 'bold' }}>FAULT SIMULATOR</div>
          <div style={{ fontSize: 11, letterSpacing: '0.18em', color: '#777', marginTop: 4 }}>NETWORK RESILIENCE</div>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', scrollbarWidth: 'thin', scrollbarColor: '#222 #080808' }}>

          {/* Network Status */}
          <div style={{ padding: '14px 20px', borderBottom: '1px solid #2a2a2a' }}>
            <div style={{ fontSize: 11, letterSpacing: '0.2em', color: '#888', marginBottom: 10 }}>NETWORK STATUS</div>
            <div style={{ display: 'inline-block', padding: '5px 14px', fontSize: 13, letterSpacing: '0.2em', marginBottom: 12, borderRadius: 3, fontWeight: 'bold', ...badgeStyle }}>
              {status}
            </div>
            {[
              ['Active faults', faultedLinks.size, faultedLinks.size > 0 ? '#ff5050' : '#40ff80'],
              ['Alt paths', allPaths.length, '#ccc'],
            ].map(([label, val, col]) => (
              <div key={label} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, color: '#aaa', marginBottom: 6 }}>
                <span>{label}</span>
                <span style={{ color: col, fontWeight: 'bold' }}>{val}</span>
              </div>
            ))}
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, color: '#aaa' }}>
              <span>SRC→DST</span>
              <span style={{
                color: pathResult?.found ? '#40ff80' : '#ff3030',
                fontWeight: 'bold',
                animation: !pathResult?.found && faultedLinks.size > 0 ? 'sig-lost 1s infinite' : 'none',
              }}>
                {pathResult?.found ? '✓ REACHABLE' : '✕ UNREACHABLE'}
              </span>
            </div>
          </div>

          {/* Active Faults */}
          <div style={{ padding: '14px 20px', borderBottom: '1px solid #2a2a2a' }}>
            <div style={{ fontSize: 11, letterSpacing: '0.2em', color: '#888', marginBottom: 10 }}>ACTIVE FAULTS</div>
            {faultedLinks.size === 0
              ? <div style={{ fontSize: 13, color: '#555' }}>— no active faults —</div>
              : [...faultedLinks].map(id => {
                  const lnk = links.find(l => l.id === id);
                  return (
                    <div key={id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                      <span style={{ fontSize: 12, color: '#ff5050' }}>✕ {lnk?.label ?? id}</span>
                      <SBtn onClick={() => handleRepair(id)}>REPAIR</SBtn>
                    </div>
                  );
                })
            }
          </div>

          {/* Current Path */}
          <div style={{ padding: '14px 20px', borderBottom: '1px solid #2a2a2a' }}>
            <div style={{ fontSize: 11, letterSpacing: '0.2em', color: '#888', marginBottom: 10 }}>CURRENT PATH</div>
            {pathResult?.found ? (
              <>
                <div style={{ fontSize: 13, color: status === 'DEGRADED' ? '#ffd700' : '#fff', lineHeight: 1.7, wordBreak: 'break-all' }}>
                  {pathLabels.join(' → ')}
                </div>
                <div style={{ fontSize: 11, color: '#555', marginTop: 5 }}>
                  {pathResult.totalDistance} px  ·  {status === 'DEGRADED' ? '⎋ rerouted' : '✓ direct'}
                </div>
              </>
            ) : (
              <div style={{ fontSize: 13, color: '#ff3030', animation: 'sig-lost 1s infinite' }}>
                ✕ NO PATH AVAILABLE
              </div>
            )}
          </div>

          {/* Path Comparison */}
          <div style={{ padding: '14px 20px', borderBottom: '1px solid #2a2a2a' }}>
            <div style={{ fontSize: 11, letterSpacing: '0.2em', color: '#888', marginBottom: 10 }}>PATH COMPARISON</div>
            {allPaths.length === 0
              ? <div style={{ fontSize: 13, color: '#555' }}>— no paths found —</div>
              : allPaths.slice(0, 3).map((p, i) => {
                  const isActive = pathResult?.path?.join(',') === p.path.join(',');
                  const labels = p.path.map(id => nodes.find(n => n.id === id)?.label ?? id).join('→');
                  return (
                    <div key={i} style={{ marginBottom: 6, padding: '6px 8px', border: `1px solid ${isActive ? 'rgba(255,255,255,0.2)' : '#1a1a1a'}`, background: isActive ? 'rgba(255,255,255,0.03)' : 'transparent', borderRadius: 3 }}>
                      <div style={{ fontSize: 12, color: isActive ? '#fff' : '#555', lineHeight: 1.5, wordBreak: 'break-all' }}>
                        {i + 1}. {labels}
                      </div>
                      <div style={{ fontSize: 11, color: isActive ? '#666' : '#333' }}>{p.distance} px</div>
                    </div>
                  );
                })
            }
          </div>

          {/* Fault Log */}
          <div style={{ padding: '14px 20px', borderBottom: '1px solid #2a2a2a' }}>
            <div style={{ fontSize: 11, letterSpacing: '0.2em', color: '#888', marginBottom: 10 }}>EVENT LOG</div>
            {faultLog.length === 0
              ? <div style={{ fontSize: 12, color: '#555' }}>— no events —</div>
              : faultLog.map((e, i) => (
                  <div key={i} style={{ fontSize: 12, lineHeight: 1.6, marginBottom: 4, color: logColors[e.type] ?? '#555' }}>
                    <span style={{ color: '#333', marginRight: 8 }}>{e.time}</span>
                    {e.msg}
                  </div>
                ))
            }
          </div>

          {/* Simulation Controls */}
          <div style={{ padding: '14px 20px' }}>
            <div style={{ fontSize: 11, letterSpacing: '0.2em', color: '#888', marginBottom: 12 }}>SIMULATION CONTROLS</div>

            <SBtn onClick={handleRandomFault}>⚡ RANDOM FAULT</SBtn>
            <SBtn onClick={handleClearAll} disabled={faultedLinks.size === 0}>⊘ CLEAR ALL FAULTS</SBtn>
            <SBtn onClick={handleLoadNetwork}>⬇ LOAD MY NETWORK</SBtn>
            <SBtn onClick={() => dispatch({ type: 'RESET' })} danger>↺ RESET</SBtn>

            {/* Auto-fault toggle */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 8, marginBottom: 10 }}>
              <span style={{ fontSize: 12, color: '#aaa', letterSpacing: '0.1em' }}>AUTO FAULT</span>
              <button
                onClick={() => dispatch({ type: 'SET_AUTO_FAULT', value: !autoFault })}
                style={{
                  background: autoFault ? 'rgba(80,255,130,0.08)' : 'transparent',
                  border: `1px solid ${autoFault ? 'rgba(80,255,130,0.6)' : '#333'}`,
                  color: autoFault ? '#50ff80' : '#555',
                  fontFamily: "'Courier New', monospace",
                  fontSize: 12, letterSpacing: '0.1em',
                  padding: '5px 12px', cursor: 'pointer',
                  transition: 'all 150ms', borderRadius: 4,
                }}
              >
                {autoFault ? '◉ ON' : '○ OFF'}
              </button>
            </div>

            {/* Speed slider */}
            <div style={{ marginBottom: 6 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: '#aaa', marginBottom: 6 }}>
                <span>SPEED</span>
                <span style={{ color: '#ccc' }}>{autoFaultSpeed.toFixed(1)}×</span>
              </div>
              <input type="range" min={0.5} max={3} step={0.5} value={autoFaultSpeed}
                onChange={e => dispatch({ type: 'SET_SPEED', value: e.target.value })}
                disabled={!autoFault}
                style={{ width: '100%', accentColor: '#fff', opacity: autoFault ? 1 : 0.3, height: 18 }}
              />
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}
