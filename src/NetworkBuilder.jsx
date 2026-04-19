import { useState, useReducer, useEffect, useRef, useCallback } from 'react';

// ─── Constants ────────────────────────────────────────────────────────────────
const SIDEBAR_WIDTH = 300;
const NODE_RADIUS = 24;
const NODE_GLOW_RADIUS = 34;
const LABELS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const LS_KEY = 'fiberlab_network';

// ─── Helpers ──────────────────────────────────────────────────────────────────
function uid() {
  return Math.random().toString(36).slice(2, 9);
}

function dist(a, b) {
  return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2);
}

function pixelsToKm(px) {
  return px * 0.01;
}

function calcReceivedPower(sourcePower, distancePx, attenuationFactor) {
  const km = pixelsToKm(distancePx);
  return sourcePower - km * attenuationFactor;
}

function signalLevel(dBm) {
  if (dBm > 7) return 'strong';
  if (dBm >= 3) return 'medium';
  return 'weak';
}

function signalColor(level) {
  if (level === 'strong') return 'rgba(0,255,100,0.45)';
  if (level === 'medium') return 'rgba(255,200,0,0.45)';
  return 'rgba(255,50,50,0.45)';
}

function signalOpacity(level) {
  if (level === 'strong') return 1.0;
  if (level === 'medium') return 0.7;
  return 0.3;
}

function getNextLabel(nodes) {
  const used = new Set(nodes.map(n => n.label.replace('Node ', '')));
  for (let i = 0; i < LABELS.length; i++) {
    if (!used.has(LABELS[i])) return `Node ${LABELS[i]}`;
  }
  return `Node ${uid().toUpperCase()}`;
}

// Default 4-node diamond layout — computed relative to viewport center
function defaultNodes(w, h) {
  const cx = (w - SIDEBAR_WIDTH) / 2;
  const cy = h / 2;
  return [
    { id: uid(), x: cx,        y: cy - 160, label: 'Node A', inputPower: 10, isSource: true },
    { id: uid(), x: cx + 190,  y: cy,       label: 'Node B', inputPower: 10, isSource: false },
    { id: uid(), x: cx,        y: cy + 160, label: 'Node C', inputPower: 10, isSource: false },
    { id: uid(), x: cx - 190,  y: cy,       label: 'Node D', inputPower: 10, isSource: false },
  ];
}

function defaultLinks(nodes) {
  const [a, b, c, d] = nodes;
  return [
    { id: uid(), sourceId: a.id, targetId: b.id },
    { id: uid(), sourceId: b.id, targetId: c.id },
    { id: uid(), sourceId: c.id, targetId: d.id },
    { id: uid(), sourceId: d.id, targetId: a.id },
  ];
}

function defaultParams() {
  return { attenuationFactor: 0.3, initialPower: 10, wavelength: 1550 };
}

function buildDefaultState() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  const nodes = defaultNodes(w, h);
  const links = defaultLinks(nodes);
  return { nodes, links, selectedNodeId: null, params: defaultParams() };
}

function loadState() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed.nodes && parsed.links && parsed.params) {
        // Sanity check: if nodes are too close (overlapping), layout is stale/bugged
        const ns = parsed.nodes;
        if (ns.length >= 2) {
          let tooClose = false;
          for (let i = 0; i < ns.length && !tooClose; i++) {
            for (let j = i + 1; j < ns.length && !tooClose; j++) {
              if (dist(ns[i], ns[j]) < 80) tooClose = true;
            }
          }
          if (tooClose) {
            localStorage.removeItem(LS_KEY);
            return buildDefaultState();
          }
        }
        return parsed;
      }
    }
  } catch {}
  return buildDefaultState();
}

// ─── Reducer ──────────────────────────────────────────────────────────────────
function reducer(state, action) {
  switch (action.type) {
    case 'ADD_NODE': {
      const node = {
        id: uid(),
        x: action.x,
        y: action.y,
        label: getNextLabel(state.nodes),
        inputPower: state.params.initialPower,
        isSource: false,
      };
      return { ...state, nodes: [...state.nodes, node], selectedNodeId: node.id };
    }
    case 'REMOVE_NODE': {
      const id = action.id ?? state.selectedNodeId;
      if (!id) return state;
      return {
        ...state,
        nodes: state.nodes.filter(n => n.id !== id),
        links: state.links.filter(l => l.sourceId !== id && l.targetId !== id),
        selectedNodeId: state.selectedNodeId === id ? null : state.selectedNodeId,
      };
    }
    case 'TOGGLE_LINK': {
      const { aId, bId } = action;
      const exists = state.links.find(
        l => (l.sourceId === aId && l.targetId === bId) ||
             (l.sourceId === bId && l.targetId === aId)
      );
      if (exists) {
        return { ...state, links: state.links.filter(l => l.id !== exists.id) };
      }
      return {
        ...state,
        links: [...state.links, { id: uid(), sourceId: aId, targetId: bId, animating: true }],
      };
    }
    case 'ANIMATE_LINK_DONE': {
      return {
        ...state,
        links: state.links.map(l => l.id === action.id ? { ...l, animating: false } : l),
      };
    }
    case 'MOVE_NODE': {
      return {
        ...state,
        nodes: state.nodes.map(n =>
          n.id === action.id ? { ...n, x: action.x, y: action.y } : n
        ),
      };
    }
    case 'SELECT_NODE': {
      return { ...state, selectedNodeId: action.id };
    }
    case 'DESELECT': {
      return { ...state, selectedNodeId: null };
    }
    case 'UPDATE_PARAMS': {
      return { ...state, params: { ...state.params, ...action.changes } };
    }
    case 'UPDATE_NODE': {
      return {
        ...state,
        nodes: state.nodes.map(n => n.id === action.id ? { ...n, ...action.changes } : n),
      };
    }
    case 'ISOLATE_NODE': {
      const id = action.id ?? state.selectedNodeId;
      return { ...state, links: state.links.filter(l => l.sourceId !== id && l.targetId !== id) };
    }
    case 'SET_SOURCE': {
      return {
        ...state,
        nodes: state.nodes.map(n => ({ ...n, isSource: n.id === action.id })),
      };
    }
    case 'CLEAR_ALL': {
      return { ...state, nodes: [], links: [], selectedNodeId: null };
    }
    default:
      return state;
  }
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const S = {
  root: {
    display: 'flex',
    width: '100%',
    height: '100%',
    background: '#000',
    fontFamily: "'Courier New', Courier, monospace",
    overflow: 'hidden',
    userSelect: 'none',
  },
  canvas: {
    flex: 1,
    position: 'relative',
    background: '#000',
    backgroundImage: 'radial-gradient(circle, #181818 1px, transparent 1px)',
    backgroundSize: '32px 32px',
    cursor: 'default',
  },
  sidebar: {
    width: SIDEBAR_WIDTH,
    minWidth: SIDEBAR_WIDTH,
    height: '100%',
    background: '#080808',
    borderLeft: '1px solid #222',
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
  },
  sidebarHeader: {
    padding: '22px 22px 16px',
    borderBottom: '1px solid #222',
  },
  sidebarTitle: {
    fontSize: 16,
    letterSpacing: '0.3em',
    color: '#fff',
    margin: 0,
    fontWeight: 'bold',
  },
  sidebarSubtitle: {
    fontSize: 11,
    letterSpacing: '0.2em',
    color: '#999',
    marginTop: 5,
  },
  sidebarScroll: {
    flex: 1,
    overflowY: 'auto',
    overflowX: 'hidden',
    scrollbarWidth: 'thin',
    scrollbarColor: '#222 #080808',
  },
  section: {
    padding: '16px 22px',
    borderBottom: '1px solid #1a1a1a',
  },
  sectionLabel: {
    fontSize: 11,
    letterSpacing: '0.2em',
    color: '#888',
    textTransform: 'uppercase',
    marginBottom: 12,
  },
  stat: {
    display: 'flex',
    justifyContent: 'space-between',
    marginBottom: 8,
    fontSize: 13,
    color: '#aaa',
  },
  statVal: {
    color: '#eee',
    fontFamily: "'Courier New', monospace",
  },
  statValWeak: {
    color: 'rgba(255,80,80,1)',
    fontFamily: "'Courier New', monospace",
  },
  sliderRow: {
    marginBottom: 16,
  },
  sliderLabel: {
    display: 'flex',
    justifyContent: 'space-between',
    fontSize: 12,
    color: '#aaa',
    marginBottom: 6,
    letterSpacing: '0.05em',
  },
  sliderVal: {
    color: '#ccc',
  },
  slider: {
    width: '100%',
    accentColor: '#fff',
    cursor: 'pointer',
    background: 'transparent',
    height: 20,
  },
  infoRow: {
    display: 'flex',
    justifyContent: 'space-between',
    marginBottom: 8,
    fontSize: 13,
    color: '#aaa',
  },
  infoVal: {
    color: '#eee',
    fontFamily: "'Courier New', monospace",
    fontSize: 13,
  },
  btn: {
    display: 'block',
    width: '100%',
    padding: '11px 14px',
    background: 'transparent',
    border: '1px solid #555',
    color: '#fff',
    fontFamily: "'Courier New', monospace",
    fontSize: 12,
    letterSpacing: '0.15em',
    cursor: 'pointer',
    textTransform: 'uppercase',
    transition: 'border-color 150ms, color 150ms, background 150ms',
    marginBottom: 8,
    textAlign: 'left',
    borderRadius: 4,
  },
  btnDanger: {
    borderColor: 'rgba(255,50,50,0.5)',
    color: 'rgba(255,100,100,0.95)',
  },
  btnDisabled: {
    opacity: 0.25,
    cursor: 'not-allowed',
    pointerEvents: 'none',
  },
  footer: {
    padding: '16px 22px',
    borderTop: '1px solid #1a1a1a',
    marginTop: 'auto',
  },
};

// ─── LinkLine Component ───────────────────────────────────────────────────────
function LinkLine({ link, nodeA, nodeB, params, onAnimDone }) {
  const [dashOffset, setDashOffset] = useState(0);
  const [opacity, setOpacity] = useState(1);
  const raf = useRef(null);
  const start = useRef(null);

  // Determine signal direction: higher inputPower is the source
  const sourceNode = nodeA.inputPower >= nodeB.inputPower ? nodeA : nodeB;
  const d = dist(nodeA, nodeB);
  const rxPower = calcReceivedPower(sourceNode.inputPower, d, params.attenuationFactor);
  const level = signalLevel(rxPower);
  const color = signalColor(level);
  const op = signalOpacity(level);

  // Entry animation for new links
  useEffect(() => {
    if (!link.animating) return;
    let elapsed = 0;
    let prev = null;
    function step(ts) {
      if (prev === null) prev = ts;
      elapsed += ts - prev;
      prev = ts;
      setDashOffset(-((elapsed / 600) * 100));
      if (elapsed < 600) {
        raf.current = requestAnimationFrame(step);
      } else {
        setDashOffset(0);
        onAnimDone(link.id);
      }
    }
    raf.current = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf.current);
  }, [link.animating]);

  // Fade transition when params change
  useEffect(() => {
    setOpacity(0.4);
    const t = setTimeout(() => setOpacity(1), 200);
    return () => clearTimeout(t);
  }, [rxPower]);

  const mx = (nodeA.x + nodeB.x) / 2;
  const my = (nodeA.y + nodeB.y) / 2;

  return (
    <g style={{ transition: 'opacity 200ms', opacity }}>
      {/* Color tint overlay line */}
      <line
        x1={nodeA.x} y1={nodeA.y}
        x2={nodeB.x} y2={nodeB.y}
        stroke={color}
        strokeWidth={6}
        strokeLinecap="round"
        style={{ opacity: op }}
      />
      {/* Main dashed white line */}
      <line
        x1={nodeA.x} y1={nodeA.y}
        x2={nodeB.x} y2={nodeB.y}
        stroke="rgba(255,255,255,0.9)"
        strokeWidth={2}
        strokeDasharray="8 5"
        strokeDashoffset={dashOffset}
        strokeLinecap="round"
        style={{ opacity: op }}
      />
      {/* Midpoint label */}
      <text
        x={mx}
        y={my - 10}
        textAnchor="middle"
        fill="#fff"
        fontSize={13}
        fontFamily="'Courier New', monospace"
        style={{ opacity, pointerEvents: 'none' }}
      >
        {rxPower.toFixed(1)} dBm
      </text>
    </g>
  );
}

// ─── NodeCircle Component ─────────────────────────────────────────────────────
function NodeCircle({ node, isSelected, isHovered, onMouseDown, onClick, onDoubleClickLabel, onMouseEnter, onMouseLeave }) {
  return (
    <g
      transform={`translate(${node.x},${node.y})`}
      style={{ cursor: 'grab' }}
      onMouseDown={onMouseDown}
      onClick={onClick}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      {/* Large transparent hit-target for reliable click/drag */}
      <circle
        r={NODE_GLOW_RADIUS + 6}
        fill="transparent"
      />
      {/* Glow ring (selected) */}
      {isSelected && (
        <circle
          r={NODE_GLOW_RADIUS}
          fill="none"
          stroke="#fff"
          strokeWidth={1.5}
          opacity={0.22}
        />
      )}
      {/* Outer hover ring */}
      <circle
        r={NODE_RADIUS + (isHovered ? 5 : 0)}
        fill="none"
        stroke="#fff"
        strokeWidth={isSelected ? 2 : 1.5}
        opacity={isSelected ? 0.9 : 0.5}
        style={{ transition: 'r 200ms, opacity 200ms' }}
      />
      {/* Inner fill */}
      <circle
        r={NODE_RADIUS - 6}
        fill={isSelected ? 'rgba(255,255,255,0.12)' : 'rgba(255,255,255,0.04)'}
        style={{ transition: 'fill 200ms' }}
      />
      {/* Source fill dot */}
      {node.isSource && (
        <circle r={7} fill="#fff" opacity={0.95} />
      )}
      {/* Node label */}
      <text
        y={NODE_RADIUS + 18}
        textAnchor="middle"
        fill="#fff"
        fontSize={13}
        fontFamily="'Courier New', monospace"
        letterSpacing="0.12em"
        opacity={0.9}
        style={{ cursor: 'pointer', pointerEvents: 'all' }}
        onDoubleClick={onDoubleClickLabel}
      >
        {node.label}
      </text>
    </g>
  );
}

// ─── FiberPulse Footer SVG ────────────────────────────────────────────────────
function FiberPulseFooter() {
  const [phase, setPhase] = useState(0);
  const raf = useRef(null);
  const prev = useRef(null);

  useEffect(() => {
    function step(ts) {
      if (prev.current === null) prev.current = ts;
      const elapsed = ts - prev.current;
      prev.current = ts;
      setPhase(p => (p + elapsed * 0.002) % 1);
      raf.current = requestAnimationFrame(step);
    }
    raf.current = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf.current);
  }, []);

  const dots = [0, 0.33, 0.66];

  return (
    <div style={S.footer}>
      <div style={{ fontSize: 11, color: '#444', letterSpacing: '0.15em', marginBottom: 8 }}>
        SIGNAL MONITOR
      </div>
      <svg width="100%" height="22" viewBox="0 0 256 22">
        {/* Dashes */}
        {[0, 1, 2, 3, 4].map(i => (
          <line
            key={i}
            x1={i * 51 + 10} y1={11}
            x2={i * 51 + 36} y2={11}
            stroke="#2a2a2a"
            strokeWidth={2}
            strokeLinecap="round"
          />
        ))}
        {/* Traveling pulse dots */}
        {dots.map((offset, i) => {
          const t = ((phase + offset) % 1);
          const x = t * 256;
          const op = Math.sin(t * Math.PI) * 0.85 + 0.15;
          return (
            <circle key={i} cx={x} cy={11} r={3} fill="#fff" opacity={op} />
          );
        })}
      </svg>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────
export default function NetworkBuilder() {
  const [state, dispatch] = useReducer(reducer, null, () => loadState());
  const { nodes, links, selectedNodeId, params } = state;

  const svgRef = useRef(null);
  const dragRef = useRef(null); // { nodeId, startX, startY, mouseStartX, mouseStartY }
  const movedRef = useRef(false); // tracks if current drag moved >4px
  const panRef = useRef(null);  // { startX, startY, originX, originY }
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [hoveredNodeId, setHoveredNodeId] = useState(null);
  const [editingNodeId, setEditingNodeId] = useState(null);
  const [labelDraft, setLabelDraft] = useState('');
  const labelInputRef = useRef(null);
  const [clearConfirm, setClearConfirm] = useState(false);
  const clearTimer = useRef(null);

  // Persist state to localStorage
  useEffect(() => {
    const toSave = { nodes, links, params, selectedNodeId };
    try { localStorage.setItem(LS_KEY, JSON.stringify(toSave)); } catch {}
  }, [nodes, links, params, selectedNodeId]);

  // Focus label input when editing starts
  useEffect(() => {
    if (editingNodeId && labelInputRef.current) {
      labelInputRef.current.focus();
      labelInputRef.current.select();
    }
  }, [editingNodeId]);

  // ── Stats computation ──
  const linkStats = links.map(link => {
    const a = nodes.find(n => n.id === link.sourceId);
    const b = nodes.find(n => n.id === link.targetId);
    if (!a || !b) return null;
    const src = a.inputPower >= b.inputPower ? a : b;
    const d = dist(a, b);
    const rx = calcReceivedPower(src.inputPower, d, params.attenuationFactor);
    return { link, rx, a, b, level: signalLevel(rx) };
  }).filter(Boolean);

  const avgSignal = linkStats.length > 0
    ? (linkStats.reduce((s, x) => s + x.rx, 0) / linkStats.length).toFixed(1)
    : '--';
  const weakest = linkStats.length > 0
    ? linkStats.reduce((w, x) => x.rx < w.rx ? x : w, linkStats[0])
    : null;

  const selectedNode = nodes.find(n => n.id === selectedNodeId);
  const selectedLinkCount = links.filter(
    l => l.sourceId === selectedNodeId || l.targetId === selectedNodeId
  ).length;

  // ── SVG coordinate helper ──
  function svgCoords(e) {
    const rect = svgRef.current.getBoundingClientRect();
    return {
      x: e.clientX - rect.left - pan.x,
      y: e.clientY - rect.top - pan.y,
    };
  }

  // ── Mouse handlers ──
  const handleSvgMouseDown = useCallback((e) => {
    // Middle mouse → pan
    if (e.button === 1) {
      e.preventDefault();
      panRef.current = { startX: e.clientX, startY: e.clientY, originX: pan.x, originY: pan.y };
      return;
    }
  }, [pan]);

  const handleNodeMouseDown = useCallback((e, nodeId) => {
    e.stopPropagation();
    if (e.button !== 0) return;
    const rect = svgRef.current.getBoundingClientRect();
    const node = nodes.find(n => n.id === nodeId);
    movedRef.current = false;
    dragRef.current = {
      nodeId,
      startX: node.x,
      startY: node.y,
      mouseStartX: e.clientX - rect.left - pan.x,
      mouseStartY: e.clientY - rect.top - pan.y,
    };
  }, [nodes, pan]);

  const handleMouseMove = useCallback((e) => {
    if (panRef.current) {
      const dx = e.clientX - panRef.current.startX;
      const dy = e.clientY - panRef.current.startY;
      setPan({ x: panRef.current.originX + dx, y: panRef.current.originY + dy });
      return;
    }
    if (dragRef.current) {
      const rect = svgRef.current.getBoundingClientRect();
      const mx = e.clientX - rect.left - pan.x;
      const my = e.clientY - rect.top - pan.y;
      // Mark as moved if moved >4px — stored in separate ref so it survives mouseup before click
      const dx = mx - dragRef.current.mouseStartX;
      const dy = my - dragRef.current.mouseStartY;
      if (Math.sqrt(dx * dx + dy * dy) > 4) {
        movedRef.current = true;
      }
      dispatch({ type: 'MOVE_NODE', id: dragRef.current.nodeId, x: mx, y: my });
    }
  }, [pan]);

  const handleMouseUp = useCallback(() => {
    dragRef.current = null;
    panRef.current = null;
    // movedRef is NOT cleared here — it must persist until onClick fires
  }, []);

  const handleNodeClick = useCallback((e, nodeId) => {
    e.stopPropagation();
    // If this was a drag (moved more than threshold), ignore the click
    if (movedRef.current) {
      movedRef.current = false;
      return;
    }
    movedRef.current = false;
    if (selectedNodeId && selectedNodeId !== nodeId) {
      // Toggle link between selected and clicked
      dispatch({ type: 'TOGGLE_LINK', aId: selectedNodeId, bId: nodeId });
    } else {
      dispatch({ type: 'SELECT_NODE', id: nodeId });
    }
  }, [selectedNodeId]);

  const handleSvgClick = useCallback(() => {
    dispatch({ type: 'DESELECT' });
    setEditingNodeId(null);
  }, []);

  // ── Double-click on canvas to add node ──
  const handleSvgDoubleClick = useCallback((e) => {
    // Don't add if we clicked on a node (nodes will stop propagation)
    const coords = svgCoords(e);
    dispatch({ type: 'ADD_NODE', x: coords.x, y: coords.y });
  }, [pan]);

  // Space+drag pan
  const spaceDown = useRef(false);
  useEffect(() => {
    const kd = (e) => {
      if (e.code === 'Space') { spaceDown.current = true; e.preventDefault(); }
    };
    const ku = (e) => {
      if (e.code === 'Space') { spaceDown.current = false; }
    };
    window.addEventListener('keydown', kd);
    window.addEventListener('keyup', ku);
    return () => { window.removeEventListener('keydown', kd); window.removeEventListener('keyup', ku); };
  }, []);

  const handleSvgMouseDownForPan = useCallback((e) => {
    if (spaceDown.current && e.button === 0) {
      panRef.current = { startX: e.clientX, startY: e.clientY, originX: pan.x, originY: pan.y };
    }
  }, [pan]);

  // Add node (sidebar button)
  const handleAddNode = () => {
    const svgRect = svgRef.current?.getBoundingClientRect();
    const cx = svgRect ? svgRect.width / 2 - pan.x : 300;
    const cy = svgRect ? svgRect.height / 2 - pan.y : 300;
    const x = cx + (Math.random() - 0.5) * 200;
    const y = cy + (Math.random() - 0.5) * 200;
    dispatch({ type: 'ADD_NODE', x, y });
  };

  // Remove selected node
  const handleRemoveNode = () => {
    dispatch({ type: 'REMOVE_NODE' });
  };

  // Clear all
  const handleClearAll = () => {
    if (!clearConfirm) {
      setClearConfirm(true);
      clearTimer.current = setTimeout(() => setClearConfirm(false), 4000);
    } else {
      clearTimeout(clearTimer.current);
      setClearConfirm(false);
      dispatch({ type: 'CLEAR_ALL' });
    }
  };

  // Label editing
  const handleDoubleClickLabel = (e, nodeId, currentLabel) => {
    e.stopPropagation();
    setEditingNodeId(nodeId);
    setLabelDraft(currentLabel);
  };

  const commitLabelEdit = () => {
    if (editingNodeId && labelDraft.trim()) {
      dispatch({ type: 'UPDATE_NODE', id: editingNodeId, changes: { label: labelDraft.trim() } });
    }
    setEditingNodeId(null);
  };

  const handleLabelKeyDown = (e) => {
    if (e.key === 'Enter') commitLabelEdit();
    if (e.key === 'Escape') setEditingNodeId(null);
  };

  // Anim done callback
  const handleAnimDone = useCallback((linkId) => {
    dispatch({ type: 'ANIMATE_LINK_DONE', id: linkId });
  }, []);

  // Prevent middle click default scroll
  useEffect(() => {
    const prevent = (e) => { if (e.button === 1) e.preventDefault(); };
    window.addEventListener('mousedown', prevent);
    return () => window.removeEventListener('mousedown', prevent);
  }, []);

  // Stop double-click propagation on node to prevent canvas double-click
  const handleNodeDoubleClick = useCallback((e) => {
    e.stopPropagation();
  }, []);

  // ── Render ──
  return (
    <div
      style={S.root}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
    >
      {/* ── Canvas ── */}
      <div
        style={S.canvas}
        onMouseDown={handleSvgMouseDownForPan}
      >
        <svg
          ref={svgRef}
          width="100%"
          height="100%"
          style={{ display: 'block', cursor: spaceDown.current ? 'grab' : 'crosshair' }}
          onMouseDown={handleSvgMouseDown}
          onClick={handleSvgClick}
          onDoubleClick={handleSvgDoubleClick}
        >
          <g transform={`translate(${pan.x},${pan.y})`}>
            {/* Links */}
            {links.map(link => {
              const a = nodes.find(n => n.id === link.sourceId);
              const b = nodes.find(n => n.id === link.targetId);
              if (!a || !b) return null;
              return (
                <LinkLine
                  key={link.id}
                  link={link}
                  nodeA={a}
                  nodeB={b}
                  params={params}
                  onAnimDone={handleAnimDone}
                />
              );
            })}

            {/* Nodes */}
            {nodes.map(node => (
              <g key={node.id} onDoubleClick={handleNodeDoubleClick}>
                <NodeCircle
                  node={node}
                  isSelected={node.id === selectedNodeId}
                  isHovered={node.id === hoveredNodeId}
                  onMouseDown={(e) => handleNodeMouseDown(e, node.id)}
                  onClick={(e) => handleNodeClick(e, node.id)}
                  onDoubleClickLabel={(e) => handleDoubleClickLabel(e, node.id, node.label)}
                  onMouseEnter={() => setHoveredNodeId(node.id)}
                  onMouseLeave={() => setHoveredNodeId(null)}
                />
              </g>
            ))}
          </g>
        </svg>

        {/* Floating label inputs for editing */}
        {editingNodeId && (() => {
          const node = nodes.find(n => n.id === editingNodeId);
          if (!node) return null;
          const rect = svgRef.current?.getBoundingClientRect();
          if (!rect) return null;
          const px = node.x + pan.x + rect.left;
          const py = node.y + pan.y + NODE_RADIUS + 20 + rect.top;
          return (
            <input
              ref={labelInputRef}
              value={labelDraft}
              onChange={e => setLabelDraft(e.target.value)}
              onBlur={commitLabelEdit}
              onKeyDown={handleLabelKeyDown}
              onClick={e => e.stopPropagation()}
              style={{
                position: 'fixed',
                left: px - 70,
                top: py - 10,
                width: 140,
                background: '#111',
                border: '1px solid #555',
                color: '#fff',
                fontFamily: "'Courier New', monospace",
                fontSize: 13,
                letterSpacing: '0.1em',
                padding: '5px 8px',
                outline: 'none',
                textAlign: 'center',
                zIndex: 100,
                borderRadius: 4,
              }}
            />
          );
        })()}

        {/* Top-left hint overlay */}
        <div style={{
          position: 'absolute',
          top: 20,
          left: 20,
          fontSize: 12,
          color: '#555',
          letterSpacing: '0.12em',
          fontFamily: "'Courier New', monospace",
          lineHeight: 2.0,
          pointerEvents: 'none',
          background: 'rgba(0,0,0,0.6)',
          padding: '10px 14px',
          border: '1px solid #222',
          borderRadius: 6,
        }}>
          <div style={{ color: '#888', marginBottom: 4, letterSpacing: '0.2em', fontSize: 11 }}>CONTROLS</div>
          <div>🖱 <span style={{ color: '#aaa' }}>CLICK NODE</span> — Select</div>
          <div>🔗 <span style={{ color: '#aaa' }}>CLICK TWO NODES</span> — Link / Unlink</div>
          <div>✥ <span style={{ color: '#aaa' }}>DRAG NODE</span> — Move</div>
          <div>✦ <span style={{ color: '#aaa' }}>DBL-CLICK CANVAS</span> — Add Node</div>
          <div>✎ <span style={{ color: '#aaa' }}>DBL-CLICK LABEL</span> — Rename</div>
          <div>⤢ <span style={{ color: '#aaa' }}>SPACE+DRAG / MID-BTN</span> — Pan</div>
        </div>
      </div>

      {/* ── Sidebar ── */}
      <aside style={S.sidebar}>
        <div style={S.sidebarHeader}>
          <div style={S.sidebarTitle}>FIBERLAB</div>
          <div style={S.sidebarSubtitle}>NETWORK BUILDER</div>
        </div>

        <div style={S.sidebarScroll}>

          {/* Network Stats */}
          <div style={S.section}>
            <div style={S.sectionLabel}>Network Stats</div>
            <div style={S.stat}>
              <span>Total nodes</span>
              <span style={S.statVal}>{nodes.length}</span>
            </div>
            <div style={S.stat}>
              <span>Total links</span>
              <span style={S.statVal}>{links.length}</span>
            </div>
            <div style={S.stat}>
              <span>Avg signal</span>
              <span style={S.statVal}>{avgSignal !== '--' ? `${avgSignal} dBm` : '--'}</span>
            </div>
            {weakest && (
              <div style={S.stat}>
                <span>Weakest link</span>
                <span style={weakest.rx < 3 ? S.statValWeak : S.statVal}>
                  {weakest.rx.toFixed(1)} dBm
                </span>
              </div>
            )}
          </div>

          {/* Link Parameters */}
          <div style={S.section}>
            <div style={S.sectionLabel}>Link Parameters</div>

            <div style={S.sliderRow}>
              <div style={S.sliderLabel}>
                <span>Attenuation</span>
                <span style={S.sliderVal}>{params.attenuationFactor.toFixed(2)} dB/km</span>
              </div>
              <input
                id="slider-attenuation"
                type="range"
                min={0.1} max={1.0} step={0.05}
                value={params.attenuationFactor}
                style={S.slider}
                onChange={e => dispatch({
                  type: 'UPDATE_PARAMS',
                  changes: { attenuationFactor: parseFloat(e.target.value) }
                })}
              />
            </div>

            <div style={S.sliderRow}>
              <div style={S.sliderLabel}>
                <span>Initial power</span>
                <span style={S.sliderVal}>{params.initialPower.toFixed(1)} dBm</span>
              </div>
              <input
                id="slider-initial-power"
                type="range"
                min={1} max={20} step={0.5}
                value={params.initialPower}
                style={S.slider}
                onChange={e => dispatch({
                  type: 'UPDATE_PARAMS',
                  changes: { initialPower: parseFloat(e.target.value) }
                })}
              />
            </div>

            <div style={S.stat}>
              <span>Wavelength</span>
              <span style={S.statVal}>{params.wavelength} nm</span>
            </div>
          </div>

          {/* Selected Node */}
          <div style={S.section}>
            <div style={S.sectionLabel}>Selected Node</div>
            {selectedNode ? (
              <>
                <div style={S.infoRow}>
                  <span style={{ color: '#888', fontSize: 13 }}>Label</span>
                  <span style={S.infoVal}>{selectedNode.label}</span>
                </div>
                <div style={S.infoRow}>
                  <span style={{ color: '#888', fontSize: 13 }}>Position</span>
                  <span style={S.infoVal}>
                    {Math.round(selectedNode.x)}, {Math.round(selectedNode.y)}
                  </span>
                </div>
                <div style={S.infoRow}>
                  <span style={{ color: '#888', fontSize: 13 }}>Links</span>
                  <span style={S.infoVal}>{selectedLinkCount}</span>
                </div>
                <div style={S.infoRow}>
                  <span style={{ color: '#888', fontSize: 13 }}>Power</span>
                  <span style={S.infoVal}>{selectedNode.inputPower.toFixed(1)} dBm</span>
                </div>
                <div style={{ marginTop: 10 }}>
                  <button
                    style={S.btn}
                    id="btn-isolate"
                    onMouseEnter={e => { e.currentTarget.style.borderColor = '#666'; e.currentTarget.style.background = '#111'; }}
                    onMouseLeave={e => { e.currentTarget.style.borderColor = '#333'; e.currentTarget.style.background = 'transparent'; }}
                    onClick={() => dispatch({ type: 'ISOLATE_NODE', id: selectedNodeId })}
                  >
                    ◈ ISOLATE NODE
                  </button>
                  <button
                    style={selectedNode.isSource
                      ? { ...S.btn, borderColor: 'rgba(0,255,100,0.6)', color: 'rgba(0,255,120,1)', background: 'rgba(0,255,100,0.06)' }
                      : S.btn}
                    id="btn-set-source"
                    onMouseEnter={e => { e.currentTarget.style.borderColor = '#666'; e.currentTarget.style.background = '#111'; }}
                    onMouseLeave={e => {
                      e.currentTarget.style.borderColor = selectedNode.isSource ? 'rgba(0,255,100,0.6)' : '#333';
                      e.currentTarget.style.background = selectedNode.isSource ? 'rgba(0,255,100,0.06)' : 'transparent';
                    }}
                    onClick={() => dispatch({ type: 'SET_SOURCE', id: selectedNodeId })}
                  >
                    {selectedNode.isSource ? '● SOURCE (ACTIVE)' : '○ SET AS SOURCE'}
                  </button>
                </div>
              </>
            ) : (
              <div style={{ fontSize: 13, color: '#444', letterSpacing: '0.05em' }}>
                — no selection —
              </div>
            )}
          </div>

          {/* Actions */}
          <div style={S.section}>
            <div style={S.sectionLabel}>Actions</div>
            <button
              id="btn-add-node"
              style={S.btn}
              onMouseEnter={e => { e.currentTarget.style.borderColor = '#666'; e.currentTarget.style.background = '#111'; }}
              onMouseLeave={e => { e.currentTarget.style.borderColor = '#333'; e.currentTarget.style.background = 'transparent'; }}
              onClick={handleAddNode}
            >
              + ADD NODE
            </button>
            <button
              id="btn-remove-node"
              style={selectedNodeId ? S.btn : { ...S.btn, ...S.btnDisabled }}
              onMouseEnter={e => { if (selectedNodeId) { e.currentTarget.style.borderColor = '#666'; e.currentTarget.style.background = '#111'; } }}
              onMouseLeave={e => { if (selectedNodeId) { e.currentTarget.style.borderColor = '#333'; e.currentTarget.style.background = 'transparent'; } }}
              onClick={handleRemoveNode}
              disabled={!selectedNodeId}
            >
              − REMOVE NODE
            </button>
            <button
              id="btn-clear-all"
              style={clearConfirm
                ? { ...S.btn, ...S.btnDanger, borderColor: 'rgba(255,50,50,0.9)', background: 'rgba(255,0,0,0.07)' }
                : { ...S.btn, ...S.btnDanger }
              }
              onMouseEnter={e => { e.currentTarget.style.borderColor = 'rgba(255,80,80,0.9)'; e.currentTarget.style.background = 'rgba(255,0,0,0.07)'; }}
              onMouseLeave={e => {
                e.currentTarget.style.borderColor = clearConfirm ? 'rgba(255,50,50,0.9)' : 'rgba(255,50,50,0.5)';
                e.currentTarget.style.background = clearConfirm ? 'rgba(255,0,0,0.07)' : 'transparent';
              }}
              onClick={handleClearAll}
            >
              {clearConfirm ? '⚠ CONFIRM CLEAR?' : '⊘ CLEAR ALL'}
            </button>
          </div>

        </div>

        {/* Footer pulse */}
        <FiberPulseFooter />
      </aside>
    </div>
  );
}
