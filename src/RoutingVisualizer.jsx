import { useState, useReducer, useEffect, useRef, useCallback } from 'react';

// ─── CSS ────────────────────────────────────────────────────────────────────────
const CSS_ANIM = `
  @keyframes rv-flow  { from{stroke-dashoffset:0} to{stroke-dashoffset:-24} }
  @keyframes rv-alt   { from{stroke-dashoffset:0} to{stroke-dashoffset:-16} }
  @keyframes rv-wide  { from{stroke-dashoffset:0} to{stroke-dashoffset:-12} }
  @keyframes rv-spin  { from{stroke-dashoffset:0} to{stroke-dashoffset:-30} }
  @keyframes rv-exp   { 0%{transform:scale(1);opacity:0.9} 100%{transform:scale(2.6);opacity:0} }
  @keyframes rv-blink { 0%,100%{opacity:0.55} 40%,60%{opacity:0.06} }
`;

// ─── Default Network (10 nodes, "interesting" non-grid layout) ────────────────
const DEF_NODES = [
  { id:'n0', label:'SRC',     x:108, y:290 },
  { id:'n1', label:'Alpha',   x:285, y:138 },
  { id:'n2', label:'Beta',    x:492, y: 82 },
  { id:'n3', label:'Gamma',   x:698, y:138 },
  { id:'n4', label:'DST',     x:892, y:290 },
  { id:'n5', label:'Delta',   x:182, y:428 },
  { id:'n6', label:'Epsilon', x:448, y:478 },
  { id:'n7', label:'Zeta',    x:668, y:442 },
  { id:'n8', label:'Eta',     x:368, y:242 },
  { id:'n9', label:'Theta',   x:596, y:296 },
];
const DEF_LINKS = [
  { id:'e0',  sourceId:'n0', targetId:'n1', distance:15, latency:8,  bandwidth:100 },
  { id:'e1',  sourceId:'n0', targetId:'n5', distance:12, latency:5,  bandwidth:40  },
  { id:'e2',  sourceId:'n1', targetId:'n2', distance:21, latency:14, bandwidth:80  },
  { id:'e3',  sourceId:'n1', targetId:'n8', distance:10, latency:6,  bandwidth:120 },
  { id:'e4',  sourceId:'n2', targetId:'n3', distance:22, latency:15, bandwidth:60  },
  { id:'e5',  sourceId:'n2', targetId:'n8', distance:14, latency:9,  bandwidth:90  },
  { id:'e6',  sourceId:'n3', targetId:'n4', distance:18, latency:10, bandwidth:110 },
  { id:'e7',  sourceId:'n3', targetId:'n9', distance:11, latency:7,  bandwidth:70  },
  { id:'e8',  sourceId:'n4', targetId:'n7', distance:19, latency:13, bandwidth:50  },
  { id:'e9',  sourceId:'n5', targetId:'n6', distance:16, latency:11, bandwidth:30  },
  { id:'e10', sourceId:'n6', targetId:'n7', distance:23, latency:14, bandwidth:55  },
  { id:'e11', sourceId:'n6', targetId:'n9', distance:19, latency:16, bandwidth:45  },
  { id:'e12', sourceId:'n7', targetId:'n4', distance:17, latency:9,  bandwidth:85  },
  { id:'e13', sourceId:'n8', targetId:'n9', distance:20, latency:22, bandwidth:95  },
  { id:'e14', sourceId:'n5', targetId:'n8', distance: 8, latency:4,  bandwidth:65  },
];

// ─── Algorithms ─────────────────────────────────────────────────────────────────
function dijkstraWeight(nodes, links, srcId, dstId, wKey) {
  const dist = {}, prev = {};
  nodes.forEach(n => { dist[n.id] = Infinity; prev[n.id] = null; });
  dist[srcId] = 0;
  const adj = {};
  nodes.forEach(n => (adj[n.id] = []));
  links.forEach(l => {
    const w = l[wKey] ?? 1;
    adj[l.sourceId]?.push({ to: l.targetId, w, linkId: l.id });
    adj[l.targetId]?.push({ to: l.sourceId, w, linkId: l.id });
  });
  const unvis = new Set(nodes.map(n => n.id));
  while (unvis.size) {
    let u = null;
    unvis.forEach(id => { if (u === null || dist[id] < dist[u]) u = id; });
    if (u === dstId || dist[u] === Infinity) break;
    unvis.delete(u);
    for (const { to, w, linkId } of adj[u] || []) {
      if (!unvis.has(to)) continue;
      const alt = dist[u] + w;
      if (alt < dist[to]) { dist[to] = alt; prev[to] = { from: u, linkId }; }
    }
  }
  if (dist[dstId] === Infinity) return { found: false, path: [], total: 0, hops: 0, pathLinkIds: [], allDist: dist };
  const path = [], pathLinkIds = [];
  for (let c = dstId; c !== null; c = prev[c]?.from ?? null) {
    path.unshift(c);
    if (prev[c]) pathLinkIds.unshift(prev[c].linkId);
  }
  return { found: true, path, total: Math.round(dist[dstId] * 10) / 10, hops: path.length - 1, pathLinkIds, allDist: dist };
}

function widestPathAlgo(nodes, links, srcId, dstId) {
  const bw = {}, prev = {};
  nodes.forEach(n => { bw[n.id] = -Infinity; prev[n.id] = null; });
  bw[srcId] = Infinity;
  const adj = {};
  nodes.forEach(n => (adj[n.id] = []));
  links.forEach(l => {
    const w = l.bandwidth ?? 10;
    adj[l.sourceId]?.push({ to: l.targetId, w, linkId: l.id });
    adj[l.targetId]?.push({ to: l.sourceId, w, linkId: l.id });
  });
  const unvis = new Set(nodes.map(n => n.id));
  while (unvis.size) {
    let u = null;
    unvis.forEach(id => { if (u === null || bw[id] > bw[u]) u = id; });
    if (u === dstId || bw[u] === -Infinity) break;
    unvis.delete(u);
    for (const { to, w, linkId } of adj[u] || []) {
      if (!unvis.has(to)) continue;
      const nb = Math.min(bw[u], w);
      if (nb > bw[to]) { bw[to] = nb; prev[to] = { from: u, linkId }; }
    }
  }
  if (bw[dstId] <= 0 || bw[dstId] === -Infinity) return { found: false, path: [], bottleneck: 0, hops: 0, pathLinkIds: [] };
  const path = [], pathLinkIds = [];
  for (let c = dstId; c !== null; c = prev[c]?.from ?? null) {
    path.unshift(c);
    if (prev[c]) pathLinkIds.unshift(prev[c].linkId);
  }
  return { found: true, path, bottleneck: bw[dstId] === Infinity ? 9999 : bw[dstId], hops: path.length - 1, pathLinkIds };
}

function computeAll(nodes, links, srcId, dstId) {
  const dist = dijkstraWeight(nodes, links, srcId, dstId, 'distance');
  const lat  = dijkstraWeight(nodes, links, srcId, dstId, 'latency');
  const wide = widestPathAlgo(nodes, links, srcId, dstId);
  return { distance: dist, latency: lat, widest: wide };
}

function computePathDetails(nodes, links, path) {
  const nmap = Object.fromEntries(nodes.map(n => [n.id, n]));
  let cumD = 0, cumL = 0;
  return path.map((id, i) => {
    if (i === 0) return { id, label: nmap[id]?.label ?? id, segD: 0, cumD: 0, segL: 0, cumL: 0 };
    const lnk = links.find(l =>
      (l.sourceId === path[i-1] && l.targetId === id) ||
      (l.sourceId === id && l.targetId === path[i-1])
    );
    cumD += lnk?.distance ?? 0;
    cumL += lnk?.latency ?? 0;
    return { id, label: nmap[id]?.label ?? id, segD: lnk?.distance ?? 0, cumD, segL: lnk?.latency ?? 0, cumL };
  });
}

function buildMotionPath(nodes, pathNodeIds) {
  const nmap = Object.fromEntries(nodes.map(n => [n.id, n]));
  return pathNodeIds.map((id, i) => {
    const n = nmap[id];
    return n ? `${i === 0 ? 'M' : 'L'}${n.x},${n.y}` : '';
  }).filter(Boolean).join(' ');
}

function randomTopology() {
  const count = 8 + Math.floor(Math.random() * 5);
  const labels = 'ABCDEFGHIJKL'.split('').slice(0, count);
  const nodes = labels.map((l, i) => ({
    id: `rn${i}`, label: l,
    x: 80 + Math.random() * 840, y: 60 + Math.random() * 460,
  }));
  const vis = [0], unvis = nodes.map((_, i) => i).slice(1);
  const links = []; let lc = 0;
  while (unvis.length) {
    const fi = vis[Math.floor(Math.random() * vis.length)];
    const ti = unvis.splice(Math.floor(Math.random() * unvis.length), 1)[0];
    vis.push(ti);
    links.push({ id:`re${lc++}`, sourceId:nodes[fi].id, targetId:nodes[ti].id,
      distance:5+Math.floor(Math.random()*46), latency:1+Math.floor(Math.random()*100), bandwidth:10+Math.floor(Math.random()*91) });
  }
  for (let i = 0; i < 4 + count; i++) {
    let a = Math.floor(Math.random()*count), b = Math.floor(Math.random()*count);
    if (a === b) continue;
    const ex = links.some(l => (l.sourceId===nodes[a].id&&l.targetId===nodes[b].id)||(l.sourceId===nodes[b].id&&l.targetId===nodes[a].id));
    if (!ex) links.push({ id:`re${lc++}`, sourceId:nodes[a].id, targetId:nodes[b].id,
      distance:5+Math.floor(Math.random()*46), latency:1+Math.floor(Math.random()*100), bandwidth:10+Math.floor(Math.random()*91) });
  }
  return { nodes, links, srcId: nodes[0].id, dstId: nodes[count-1].id };
}

function normCoords(nodes, tw=850,th=470,padX=75,padY=55) {
  if (!nodes.length) return nodes;
  const xs=nodes.map(n=>n.x),ys=nodes.map(n=>n.y);
  const mnX=Math.min(...xs),mxX=Math.max(...xs),mnY=Math.min(...ys),mxY=Math.max(...ys);
  const rX=mxX-mnX||1,rY=mxY-mnY||1;
  const sc=Math.min(tw/rX,th/rY)*0.85;
  return nodes.map(n=>({...n,x:padX+(tw-rX*sc)/2+(n.x-mnX)*sc,y:padY+(th-rY*sc)/2+(n.y-mnY)*sc}));
}

// ─── Reducer ────────────────────────────────────────────────────────────────────
function makeInitial() {
  const nodes=DEF_NODES, links=DEF_LINKS, srcId='n0', dstId='n4';
  return {
    nodes, links, srcId, dstId,
    results: computeAll(nodes, links, srcId, dstId),
    activeAlgo: 'distance',
    compareMode: false,
    showWeights: false,
    weightView: 'distance',
    stepMode: false,
    currentStep: 0,
    animSpeed: 1,
  };
}

function reducer(state, action) {
  switch (action.type) {
    case 'SET_SRC': {
      if (action.id === state.dstId) return state;
      const s = { ...state, srcId: action.id, currentStep: 0 };
      return { ...s, results: computeAll(s.nodes, s.links, s.srcId, s.dstId) };
    }
    case 'SET_DST': {
      if (action.id === state.srcId) return state;
      const s = { ...state, dstId: action.id, currentStep: 0 };
      return { ...s, results: computeAll(s.nodes, s.links, s.srcId, s.dstId) };
    }
    case 'MOVE_NODE': {
      const nodes = state.nodes.map(n => n.id === action.id ? { ...n, x: action.x, y: action.y } : n);
      return { ...state, nodes, results: computeAll(nodes, state.links, state.srcId, state.dstId) };
    }
    case 'ADD_NODE': {
      const newNode = { id: `un${Date.now()}`, label: `N${state.nodes.length}`, x: action.x, y: action.y };
      // Auto-connect to nearest 2 nodes
      const sorted = [...state.nodes].sort((a,b) =>
        Math.hypot(a.x-action.x,a.y-action.y) - Math.hypot(b.x-action.x,b.y-action.y)
      );
      const newLinks = sorted.slice(0,2).map((nb,i) => ({
        id:`ul${Date.now()}${i}`, sourceId:newNode.id, targetId:nb.id,
        distance:Math.round(Math.hypot(nb.x-action.x,nb.y-action.y)/20),
        latency:5+Math.floor(Math.random()*20), bandwidth:50+Math.floor(Math.random()*50),
      }));
      const nodes=[...state.nodes, newNode], links=[...state.links, ...newLinks];
      return { ...state, nodes, links, results: computeAll(nodes, links, state.srcId, state.dstId) };
    }
    case 'UPDATE_LINK': {
      const links = state.links.map(l => l.id===action.id ? { ...l, ...action.updates } : l);
      return { ...state, links, results: computeAll(state.nodes, links, state.srcId, state.dstId) };
    }
    case 'SET_ALGO': return { ...state, activeAlgo: action.algo };
    case 'SET_COMPARE': return { ...state, compareMode: action.value };
    case 'SET_SHOW_WEIGHTS': return { ...state, showWeights: action.value };
    case 'SET_WEIGHT_VIEW': return { ...state, weightView: action.value };
    case 'SET_STEP_MODE': return { ...state, stepMode: action.value, currentStep: 0 };
    case 'SET_STEP': return { ...state, currentStep: action.step };
    case 'SET_SPEED': return { ...state, animSpeed: action.value };
    case 'RANDOMIZE': {
      const { nodes, links, srcId, dstId } = randomTopology();
      return { ...state, nodes, links, srcId, dstId, results: computeAll(nodes, links, srcId, dstId), currentStep: 0 };
    }
    case 'LOAD_NB': {
      const { nodes: rn, links: rl } = action;
      const nodes = normCoords(rn.map((n,i) => ({
        ...n, label: n.label ?? `N${i}`,
        isSrc: n.isSource===true || i===0,
        isDst: i===rn.length-1,
      })));
      const links = rl;
      const srcId = nodes.find(n=>n.isSrc)?.id ?? nodes[0]?.id;
      const dstId = nodes.find(n=>n.isDst)?.id ?? nodes[nodes.length-1]?.id;
      return { ...state, nodes, links, srcId, dstId, results: computeAll(nodes, links, srcId, dstId), currentStep: 0 };
    }
    case 'RESET': return makeInitial();
    default: return state;
  }
}

// ─── Sidebar Button ─────────────────────────────────────────────────────────────
function SBtn({ onClick, disabled, children, style: sx }) {
  const [h, setH] = useState(false);
  return (
    <button onClick={onClick} disabled={disabled} onMouseEnter={()=>setH(true)} onMouseLeave={()=>setH(false)}
      style={{ display:'block',width:'100%',padding:'6px 10px',marginBottom:5,background:'transparent',
        border:`1px solid ${h?'#444':'#1e1e1e'}`,color:disabled?'#222':h?'#fff':'#555',
        fontFamily:"'Courier New',monospace",fontSize:9,letterSpacing:'0.15em',cursor:disabled?'not-allowed':'pointer',
        textAlign:'left',transition:'all 120ms',...sx }}>
      {children}
    </button>
  );
}

// ─── Routing Table rows (decorative) ────────────────────────────────────────────
const RT_ROWS = [['SRC→DST','56km','45ms'],['Alpha→Zeta','41km','33ms'],['Beta→Epsilon','28km','21ms'],
  ['Gamma→Delta','62km','58ms'],['Eta→DST','37km','29ms'],['Theta→SRC','44km','36ms']];

// ─── Main Component ─────────────────────────────────────────────────────────────
export default function RoutingVisualizer() {
  const [state, dispatch] = useReducer(reducer, null, makeInitial);
  const { nodes, links, srcId, dstId, results, activeAlgo, compareMode,
          showWeights, weightView, stepMode, currentStep, animSpeed } = state;

  // Animation state
  const [litLinkIds, setLitLinkIds] = useState(new Set());
  const [animPhase, setAnimPhase] = useState('idle'); // 'drawing' | 'done'
  const [motionKey, setMotionKey] = useState(0);
  const [replayCount, setReplayCount] = useState(0);
  const litTimersRef = useRef([]);

  // Interaction state
  const [tooltip, setTooltip] = useState(null);   // { x,y,label,degree,distSrc }
  const [ctxMenu, setCtxMenu] = useState(null);   // { linkId,x,y,distance,latency,bandwidth }
  const [ctxVals, setCtxVals] = useState({});
  const [pulsedNodeId, setPulsedNodeId] = useState(null);
  const pulseTimerRef = useRef(null);

  const svgRef = useRef(null);
  const dragRef = useRef(null);
  const stateRef = useRef(state);
  stateRef.current = state;

  const activeResult = results[activeAlgo] ?? { found:false, path:[], pathLinkIds:[], hops:0, total:0, allDist:{} };
  const activePathLinkIdsSet = new Set(activeResult.pathLinkIds ?? []);
  const activePathNodeIdsSet = new Set(activeResult.path ?? []);

  const distResult = results.distance ?? { found:false, path:[], pathLinkIds:[], allDist:{} };
  const allDistFromSrc = distResult.allDist ?? {};

  // Degree count
  const degreeMap = {};
  nodes.forEach(n => (degreeMap[n.id] = 0));
  links.forEach(l => { degreeMap[l.sourceId]=(degreeMap[l.sourceId]||0)+1; degreeMap[l.targetId]=(degreeMap[l.targetId]||0)+1; });

  // ── Sequential link animation ─────────────────────────────────────────────────
  const activePathKey = `${srcId}-${dstId}-${activeAlgo}-${replayCount}`;
  useEffect(() => {
    litTimersRef.current.forEach(clearTimeout);
    litTimersRef.current = [];
    setLitLinkIds(new Set());
    setAnimPhase('drawing');
    const linkIds = activeResult.pathLinkIds ?? [];
    if (!linkIds.length) { setAnimPhase('done'); return; }
    const baseDelay = 220 / animSpeed;
    linkIds.forEach((id, i) => {
      const t = setTimeout(() => setLitLinkIds(prev => new Set([...prev, id])), (i+1)*baseDelay);
      litTimersRef.current.push(t);
    });
    const finT = setTimeout(() => { setAnimPhase('done'); setMotionKey(k => k+1); }, (linkIds.length+1.5)*baseDelay);
    litTimersRef.current.push(finT);
    return () => litTimersRef.current.forEach(clearTimeout);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activePathKey, animSpeed]);

  // ── SVG coordinate conversion ─────────────────────────────────────────────────
  const toSVGCoords = useCallback((e) => {
    const svg = svgRef.current; if (!svg) return {x:0,y:0};
    const rect = svg.getBoundingClientRect();
    const vb = svg.viewBox.baseVal;
    return { x:(e.clientX-rect.left)/rect.width*vb.width, y:(e.clientY-rect.top)/rect.height*vb.height };
  }, []);

  // ── Drag handlers ─────────────────────────────────────────────────────────────
  const handleNodeMouseDown = useCallback((e, nodeId) => {
    e.stopPropagation();
    const pt = toSVGCoords(e);
    const node = stateRef.current.nodes.find(n=>n.id===nodeId);
    if (!node) return;
    dragRef.current = { nodeId, startE:{x:e.clientX,y:e.clientY}, origNode:{x:node.x,y:node.y}, moved:false };
  }, [toSVGCoords]);

  const handleSVGMouseMove = useCallback((e) => {
    if (!dragRef.current) return;
    const dr = dragRef.current;
    const svg = svgRef.current;
    const rect = svg.getBoundingClientRect();
    const vb = svg.viewBox.baseVal;
    const scX = vb.width/rect.width, scY = vb.height/rect.height;
    const dx = (e.clientX-dr.startE.x)*scX, dy = (e.clientY-dr.startE.y)*scY;
    if (Math.hypot(dx,dy) > 3) dr.moved = true;
    if (dr.moved) {
      dispatch({ type:'MOVE_NODE', id:dr.nodeId, x:dr.origNode.x+dx, y:dr.origNode.y+dy });
    }
  }, []);

  const handleSVGMouseUp = useCallback((e) => {
    if (!dragRef.current) return;
    if (!dragRef.current.moved) {
      // It was a click — handle SRC/DST selection
      const { nodeId } = dragRef.current;
      if (e.shiftKey) dispatch({ type:'SET_DST', id:nodeId });
      else dispatch({ type:'SET_SRC', id:nodeId });
    }
    dragRef.current = null;
  }, []);

  // ── Canvas double-click → add node ───────────────────────────────────────────
  const handleSVGDblClick = useCallback((e) => {
    const tgt = e.target;
    const isCanvas = tgt.tagName==='svg' || tgt.tagName==='rect' || tgt.getAttribute?.('data-bg');
    if (!isCanvas) return;
    const {x,y} = toSVGCoords(e);
    dispatch({ type:'ADD_NODE', x, y });
  }, [toSVGCoords]);

  // ── Link right-click context menu ─────────────────────────────────────────────
  const handleLinkCtx = useCallback((e, link) => {
    e.preventDefault();
    setCtxMenu({ linkId:link.id, x:e.clientX, y:e.clientY });
    setCtxVals({ distance:link.distance, latency:link.latency, bandwidth:link.bandwidth });
  }, []);

  const saveCtxMenu = () => {
    if (!ctxMenu) return;
    dispatch({ type:'UPDATE_LINK', id:ctxMenu.linkId, updates:{
      distance:parseFloat(ctxVals.distance)||1,
      latency:parseFloat(ctxVals.latency)||1,
      bandwidth:parseFloat(ctxVals.bandwidth)||1,
    }});
    setCtxMenu(null);
  };

  // ── Step mode ──────────────────────────────────────────────────────────────────
  const maxStep = (activeResult.path?.length ?? 1) - 1;
  const handleNextStep = () => {
    const ns = Math.min(currentStep+1, maxStep);
    dispatch({ type:'SET_STEP', step:ns });
    const nodeId = activeResult.path?.[ns];
    if (nodeId) {
      setPulsedNodeId(nodeId);
      clearTimeout(pulseTimerRef.current);
      pulseTimerRef.current = setTimeout(()=>setPulsedNodeId(null), 700);
    }
  };
  const handlePrevStep = () => dispatch({ type:'SET_STEP', step:Math.max(currentStep-1,0) });

  // ── Derived display data (step mode overrides animation) ──────────────────────
  const effectiveLitSet = stepMode
    ? new Set((activeResult.pathLinkIds??[]).slice(0, currentStep))
    : litLinkIds;
  const effectivePathNodes = stepMode
    ? new Set((activeResult.path??[]).slice(0, currentStep+1))
    : activePathNodeIdsSet;

  // Step details display
  const stepDetails = stepMode && activeResult.path ? (() => {
    let d=0,l=0;
    const cumPath = activeResult.path.slice(0,currentStep+1);
    for (let i=1;i<cumPath.length;i++){
      const lk=links.find(x=>(x.sourceId===cumPath[i-1]&&x.targetId===cumPath[i])||(x.sourceId===cumPath[i]&&x.targetId===cumPath[i-1]));
      if(lk){d+=lk.distance;l+=lk.latency;}
    }
    return {d:Math.round(d*10)/10,l};
  })() : null;

  // Path details for sidebar table
  const pathDetails = computePathDetails(nodes, links, activeResult.path ?? []);

  // Motion path string
  const motionPathStr = buildMotionPath(nodes, activeResult.path ?? []);

  // Compare path link ID sets
  const distLinkSet  = new Set(results.distance?.pathLinkIds ?? []);
  const latLinkSet   = new Set(results.latency?.pathLinkIds ?? []);
  const wideLinkSet  = new Set(results.widest?.pathLinkIds ?? []);

  // Node label for a path array
  const pathLabel = (path) => (path??[]).map(id=>nodes.find(n=>n.id===id)?.label??id).join(' → ') || '—';

  // Weight label for a link
  const wLabel = (l) => {
    if (!showWeights) return null;
    if (weightView==='distance') return `${l.distance}km`;
    if (weightView==='latency')  return `${l.latency}ms`;
    return `${l.bandwidth}G`;
  };

  // ── Link SVG rendering ────────────────────────────────────────────────────────
  const renderLink = (link) => {
    const a = nodes.find(n=>n.id===link.sourceId), b = nodes.find(n=>n.id===link.targetId);
    if (!a||!b) return null;
    const mx=(a.x+b.x)/2, my=(a.y+b.y)/2;
    const inActive    = effectiveLitSet.has(link.id);
    const inActivePath = activePathLinkIdsSet.has(link.id);
    const inDist   = compareMode && distLinkSet.has(link.id);
    const inLat    = compareMode && latLinkSet.has(link.id);
    const inWide   = compareMode && wideLinkSet.has(link.id);
    const wl = wLabel(link);

    // Perpendicular offset for compare mode parallel lines
    const getOffset = (mul) => {
      const dx=b.x-a.x, dy=b.y-a.y, len=Math.hypot(dx,dy)||1;
      return { px:(-dy/len)*mul, py:(dx/len)*mul };
    };

    return (
      <g key={link.id} onContextMenu={e=>handleLinkCtx(e,link)} style={{cursor:'context-menu'}}>
        {/* Hit area */}
        <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="transparent" strokeWidth={14}
          style={{cursor:'context-menu'}} />

        {/* Baseline (faint) */}
        {!compareMode && (
          <line x1={a.x} y1={a.y} x2={b.x} y2={b.y}
            stroke="#fff" strokeWidth={inActive?2.5:1}
            opacity={inActivePath?(inActive?0.95:0.2):0.1}
            strokeDasharray={inActive&&!stepMode?'none':'6 4'}
            style={inActive&&animPhase==='done'&&!stepMode?{animation:'rv-flow 800ms linear infinite'}:{}}
          />
        )}

        {/* Compare mode: 3 separate lines with offsets */}
        {compareMode && (() => {
          const lines = [];
          if (inDist) {
            const {px,py}=getOffset(0);
            lines.push(<line key="d" x1={a.x+px} y1={a.y+py} x2={b.x+px} y2={b.y+py}
              stroke="#fff" strokeWidth={2.5} opacity={activeAlgo==='distance'?0.95:0.4}
              strokeDasharray={activeAlgo==='distance'?'none':'none'}
              style={activeAlgo==='distance'?{animation:'rv-flow 800ms linear infinite'}:{}}
            />);
          }
          if (inLat) {
            const {px,py}=getOffset(inDist?4:0);
            lines.push(<line key="l" x1={a.x+px} y1={a.y+py} x2={b.x+px} y2={b.y+py}
              stroke="#fff" strokeWidth={1.5} opacity={activeAlgo==='latency'?0.85:0.4}
              strokeDasharray="8 4"
              style={{animation:'rv-alt 1.2s linear infinite'}}
            />);
          }
          if (inWide) {
            const {px,py}=getOffset((inDist&&inLat)?-4:inDist?4:0);
            lines.push(<line key="w" x1={a.x+px} y1={a.y+py} x2={b.x+px} y2={b.y+py}
              stroke="#fff" strokeWidth={1} opacity={activeAlgo==='widest'?0.75:0.3}
              strokeDasharray="2 7"
            />);
          }
          if (!inDist&&!inLat&&!inWide)
            lines.push(<line key="bg" x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="#fff" strokeWidth={1} opacity={0.08} />);
          return lines;
        })()}

        {/* Weight label */}
        {wl && (
          <text x={mx} y={my-6} textAnchor="middle" fill="#333" fontSize={9}
            fontFamily="'Courier New',monospace">{wl}</text>
        )}
      </g>
    );
  };

  // ── Node SVG rendering ────────────────────────────────────────────────────────
  const renderNode = (node) => {
    const isSrc = node.id===srcId, isDst = node.id===dstId;
    const onPath = effectivePathNodes.has(node.id);
    const isOffPath = !onPath && (activeResult.path?.length??0)>0;
    const isPulsed = node.id===pulsedNodeId;
    const r = isSrc||isDst ? 18 : onPath ? 16 : 14;

    return (
      <g key={node.id}
        onMouseDown={e=>handleNodeMouseDown(e,node.id)}
        onMouseEnter={e=>{
          const dist=allDistFromSrc[node.id];
          setTooltip({x:e.clientX,y:e.clientY-38,label:node.label,degree:degreeMap[node.id]??0,
            distSrc:dist===Infinity||dist==null?'∞':`${Math.round(dist*10)/10}km`});
        }}
        onMouseLeave={()=>setTooltip(null)}
        onMouseMove={e=>setTooltip(t=>t?{...t,x:e.clientX,y:e.clientY-38}:null)}
        style={{cursor:'pointer'}}
      >
        {/* Pulsed ring animation */}
        {isPulsed && (
          <circle cx={node.x} cy={node.y} r={r} fill="none" stroke="#fff" strokeWidth={1}
            style={{transformOrigin:`${node.x}px ${node.y}px`, animation:'rv-exp 700ms ease-out forwards'}}
            pointerEvents="none"
          />
        )}

        {/* SRC: filled + spinning ring */}
        {isSrc && (<>
          <circle cx={node.x} cy={node.y} r={18} fill="#fff" opacity={0.95} pointerEvents="none"/>
          <circle cx={node.x} cy={node.y} r={26} fill="none" stroke="#fff" strokeWidth={1}
            strokeDasharray="3 3" opacity={0.4}
            style={{transformOrigin:`${node.x}px ${node.y}px`, animation:'rv-spin 2s linear infinite'}}
            pointerEvents="none"/>
          <text x={node.x} y={node.y+4} textAnchor="middle" fill="#000" fontSize={9}
            fontFamily="'Courier New',monospace" fontWeight="bold" pointerEvents="none">SRC</text>
        </>)}

        {/* DST: hollow + 2 concentric rings */}
        {isDst && !isSrc && (<>
          <circle cx={node.x} cy={node.y} r={18} fill="transparent" stroke="#fff" strokeWidth={1.5} opacity={0.9} pointerEvents="none"/>
          <circle cx={node.x} cy={node.y} r={24} fill="none" stroke="#fff" strokeWidth={0.5} strokeDasharray="4 4" opacity={0.3} pointerEvents="none"/>
          <circle cx={node.x} cy={node.y} r={30} fill="none" stroke="#fff" strokeWidth={0.5} strokeDasharray="3 5" opacity={0.15} pointerEvents="none"/>
          <text x={node.x} y={node.y+32+6} textAnchor="middle" fill="#fff" fontSize={9}
            fontFamily="'Courier New',monospace" opacity={0.7} pointerEvents="none">DST</text>
        </>)}

        {/* Regular on-path node */}
        {!isSrc && !isDst && onPath && (
          <circle cx={node.x} cy={node.y} r={r} fill="#fff" opacity={0.95} pointerEvents="none"/>
        )}

        {/* Regular off-path or neutral node */}
        {!isSrc && !isDst && !onPath && (
          <circle cx={node.x} cy={node.y} r={r} fill="transparent" stroke="#fff"
            strokeWidth={1} opacity={isOffPath?0.2:0.5} pointerEvents="none"/>
        )}

        {/* Label (regular nodes) */}
        {!isSrc && (
          <text x={node.x} y={node.y+(r)+14} textAnchor="middle"
            fill="#fff" fontSize={9} fontFamily="'Courier New',monospace"
            opacity={isOffPath?0.2:0.7} letterSpacing="0.08em" pointerEvents="none">
            {node.label}
          </text>
        )}
        {/* SRC node label (drawn inside, handled above) skip extra label */}
      </g>
    );
  };

  // ── Radial burst background ────────────────────────────────────────────────────
  const radialBurst = (
    <g pointerEvents="none">
      {Array.from({length:36},(_,i)=>{
        const a=(i/36)*Math.PI*2, cx=500, cy=290, len=620;
        return <line key={i} x1={cx} y1={cy} x2={cx+Math.cos(a)*len} y2={cy+Math.sin(a)*len}
          stroke="#0c0c0c" strokeWidth={1}/>;
      })}
    </g>
  );

  // ── animateMotion traveling dot ───────────────────────────────────────────────
  const travelingDot = animPhase==='done' && !stepMode && motionPathStr ? (
    <circle key={motionKey} r={5} fill="#fff" opacity={0.9} pointerEvents="none">
      <animateMotion dur={`${(activeResult.path?.length??1)*0.35/animSpeed}s`}
        repeatCount="1" fill="freeze" path={motionPathStr} />
    </circle>
  ) : null;

  // ── Sidebar algorithm card ────────────────────────────────────────────────────
  const AlgoCard = ({ algo, title, metric, unit, result }) => {
    const active = activeAlgo===algo;
    return (
      <div onClick={()=>dispatch({type:'SET_ALGO',algo})} style={{
        border:`1px solid ${active?'rgba(255,255,255,0.8)':'#333'}`,padding:'10px 12px',marginBottom:8,
        cursor:'pointer',transition:'border-color 150ms',
        background:active?'rgba(255,255,255,0.04)':'transparent',
        borderRadius:3,
      }}>
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:5}}>
          <span style={{fontSize:11,letterSpacing:'0.15em',color:active?'#fff':'#888',fontWeight:active?'bold':'normal'}}>{title}</span>
          {active&&<span style={{width:6,height:6,borderRadius:'50%',background:'#fff',display:'inline-block'}}/>}
        </div>
        <div style={{fontSize:11,color:active?'#bbb':'#666',lineHeight:1.5,wordBreak:'break-all',marginBottom:4}}>
          {pathLabel(result?.path)}
        </div>
        <div style={{fontSize:13,color:active?'#fff':'#999',fontWeight:active?'bold':'normal'}}>
          {result?.found ? `${metric} · ${result.hops} hops` : '— no path —'}
        </div>
      </div>
    );
  };

  // ─────────────────────────────────────────────────────────────────────────────
  return (
    <div style={{display:'flex',width:'100%',height:'100%',background:'#000',
      fontFamily:"'Courier New',Courier,monospace",userSelect:'none',overflow:'hidden'}}>
      <style>{CSS_ANIM}</style>

      {/* ── Canvas ── */}
      <div style={{flex:1,position:'relative',overflow:'hidden'}}>
        <svg ref={svgRef} width="100%" height="100%"
          viewBox="0 0 1000 580" preserveAspectRatio="xMidYMid meet"
          onMouseMove={handleSVGMouseMove}
          onMouseUp={handleSVGMouseUp}
          onMouseLeave={()=>{dragRef.current=null;setTooltip(null);}}
          onDoubleClick={handleSVGDblClick}
          style={{cursor:'crosshair'}}
        >
          {/* Background */}
          <rect width="1000" height="580" fill="#000" data-bg="1"/>
          {radialBurst}

          {/* Links */}
          {links.map(renderLink)}

          {/* Traveling dot */}
          {travelingDot}

          {/* Nodes */}
          {nodes.map(renderNode)}

          {/* Canvas hint */}
          <text x={12} y={24} fontSize={11} fill="#444" fontFamily="'Courier New',monospace" letterSpacing="0.18em">
            CLICK=SRC · SHIFT+CLICK=DST · DBLCLICK=ADD · RMB LINK=EDIT
          </text>
        </svg>
      </div>

      {/* ── Sidebar ── */}
      <div style={{width:320,flexShrink:0,background:'#080808',borderLeft:'1px solid #222',
        display:'flex',flexDirection:'column',overflow:'hidden'}}>

        {/* Header */}
        <div style={{padding:'18px 20px',borderBottom:'1px solid #2a2a2a',flexShrink:0}}>
          <div style={{fontSize:16,letterSpacing:'0.3em',color:'#fff',fontWeight:'bold'}}>ROUTING VISUALIZER</div>
          <div style={{fontSize:11,letterSpacing:'0.18em',color:'#777',marginTop:4}}>PATH ANALYSIS ENGINE</div>
        </div>

        <div style={{flex:1,overflowY:'auto',scrollbarWidth:'thin',scrollbarColor:'#222 #080808'}}>

          {/* SELECT ROUTE */}
          <div style={{padding:'14px 20px',borderBottom:'1px solid #1a1a1a'}}>
            <div style={{fontSize:11,letterSpacing:'0.2em',color:'#555',marginBottom:10}}>SELECT ROUTE</div>
            {[['SRC','SET_SRC',srcId],['DST','SET_DST',dstId]].map(([lbl,act,val])=>(
              <div key={lbl} style={{display:'flex',alignItems:'center',gap:10,marginBottom:8}}>
                <span style={{fontSize:12,color:'#888',width:30,flexShrink:0,fontWeight:'bold'}}>{lbl}</span>
                <select value={val} onChange={e=>dispatch({type:act,id:e.target.value})}
                  style={{flex:1,background:'#0d0d0d',border:'1px solid #2a2a2a',color:'#fff',
                    fontFamily:"'Courier New',monospace",fontSize:12,padding:'5px 8px',cursor:'pointer',
                    outline:'none',accentColor:'#fff',borderRadius:3}}>
                  {nodes.map(n=><option key={n.id} value={n.id}>{n.label}</option>)}
                </select>
              </div>
            ))}
          </div>

          {/* ALGORITHM RESULTS */}
          <div style={{padding:'14px 20px',borderBottom:'1px solid #1a1a1a'}}>
            <div style={{fontSize:11,letterSpacing:'0.2em',color:'#555',marginBottom:10}}>ALGORITHM RESULTS</div>
            <AlgoCard algo="distance" title="SHORTEST DISTANCE"
              metric={results.distance?.found?`${results.distance.total}km`:'—'} result={results.distance}/>
            <AlgoCard algo="latency" title="LOWEST LATENCY"
              metric={results.latency?.found?`${results.latency.total}ms`:'—'} result={results.latency}/>
            <AlgoCard algo="widest" title="WIDEST PATH"
              metric={results.widest?.found?`${results.widest.bottleneck}G BW`:'—'} result={results.widest}/>
          </div>

          {/* PATH DETAILS TABLE */}
          <div style={{padding:'14px 20px',borderBottom:'1px solid #1a1a1a'}}>
            <div style={{fontSize:11,letterSpacing:'0.2em',color:'#555',marginBottom:10}}>PATH DETAILS</div>
            {pathDetails.length>0 ? (
              <table style={{width:'100%',borderCollapse:'collapse'}}>
                <thead>
                  <tr>{['NODE','DIST','CUM-D','LAT'].map(h=>(
                    <th key={h} style={{fontSize:10,color:'#555',fontWeight:'bold',letterSpacing:'0.1em',
                      textAlign:'left',padding:'4px 4px',borderBottom:'1px solid #222'}}>{h}</th>
                  ))}</tr>
                </thead>
                <tbody>
                  {pathDetails.map((row,i)=>(
                    <tr key={row.id} style={{borderBottom:'1px solid #1a1a1a'}}>
                      <td style={{fontSize:12,color:i===0||i===pathDetails.length-1?'#eee':'#888',padding:'5px 4px'}}>{row.label}</td>
                      <td style={{fontSize:12,color:'#777',padding:'5px 4px'}}>{row.segD?`${row.segD}`:'-'}</td>
                      <td style={{fontSize:12,color:'#aaa',padding:'5px 4px'}}>{row.cumD}</td>
                      <td style={{fontSize:12,color:'#777',padding:'5px 4px'}}>{row.segL?`${row.segL}`:'-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : <div style={{fontSize:12,color:'#333'}}>— select SRC and DST —</div>}
          </div>

          {/* COMPARE + WEIGHTS OPTIONS */}
          <div style={{padding:'14px 20px',borderBottom:'1px solid #1a1a1a'}}>
            <div style={{fontSize:11,letterSpacing:'0.2em',color:'#555',marginBottom:10}}>OPTIONS</div>
            {[
              ['COMPARE PATHS','SET_COMPARE',compareMode],
              ['SHOW WEIGHTS','SET_SHOW_WEIGHTS',showWeights],
            ].map(([lbl,act,val])=>(
              <div key={lbl} style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:9}}>
                <span style={{fontSize:12,color:'#777',letterSpacing:'0.1em'}}>{lbl}</span>
                <button onClick={()=>dispatch({type:act,value:!val})} style={{
                  background:val?'rgba(80,255,130,0.08)':'transparent',
                  border:`1px solid ${val?'rgba(80,255,130,0.6)':'#333'}`,
                  color:val?'#50ff80':'#666',fontFamily:"'Courier New',monospace",
                  fontSize:12,padding:'4px 12px',cursor:'pointer',letterSpacing:'0.1em',transition:'all 150ms',borderRadius:4}}>
                  {val?'◉ ON':'○ OFF'}
                </button>
              </div>
            ))}
            {showWeights && (
              <div style={{marginTop:6}}>
                <div style={{fontSize:11,color:'#555',marginBottom:6,letterSpacing:'0.1em'}}>VIEW BY</div>
                {['distance','latency','bandwidth'].map(w=>(
                  <label key={w} style={{display:'flex',alignItems:'center',gap:8,marginBottom:6,cursor:'pointer'}}>
                    <span style={{width:10,height:10,border:`1px solid ${weightView===w?'#fff':'#444'}`,
                      background:weightView===w?'#fff':'transparent',display:'inline-block',cursor:'pointer',borderRadius:2}}
                      onClick={()=>dispatch({type:'SET_WEIGHT_VIEW',value:w})}/>
                    <span style={{fontSize:12,color:weightView===w?'#fff':'#666',cursor:'pointer',textTransform:'uppercase',letterSpacing:'0.1em'}}
                      onClick={()=>dispatch({type:'SET_WEIGHT_VIEW',value:w})}>{w}</span>
                  </label>
                ))}
              </div>
            )}
          </div>

          {/* SIMULATION CONTROLS */}
          <div style={{padding:'14px 20px',borderBottom:'1px solid #1a1a1a'}}>
            <div style={{fontSize:11,letterSpacing:'0.2em',color:'#555',marginBottom:10}}>SIMULATION</div>

            {/* Step mode */}
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:10}}>
              <span style={{fontSize:12,color:'#777',letterSpacing:'0.1em'}}>STEP MODE</span>
              <button onClick={()=>dispatch({type:'SET_STEP_MODE',value:!stepMode})} style={{
                background:stepMode?'rgba(255,220,80,0.08)':'transparent',
                border:`1px solid ${stepMode?'rgba(255,220,80,0.6)':'#333'}`,
                color:stepMode?'#ffd700':'#666',fontFamily:"'Courier New',monospace",
                fontSize:12,padding:'4px 12px',cursor:'pointer',letterSpacing:'0.1em',transition:'all 150ms',borderRadius:4}}>
                {stepMode?'◉ ON':'○ OFF'}
              </button>
            </div>

            {stepMode && (
              <div style={{marginBottom:10}}>
                <div style={{fontSize:12,color:'#777',marginBottom:8,textAlign:'center',letterSpacing:'0.1em'}}>
                  Step {currentStep} of {maxStep}
                  {stepDetails&&<span style={{color:'#999',marginLeft:10}}>{stepDetails.d}km / {stepDetails.l}ms</span>}
                </div>
                <div style={{display:'flex',gap:6}}>
                  <SBtn onClick={handlePrevStep} disabled={currentStep===0} sx={{flex:1,textAlign:'center',marginBottom:0}}>◂ PREV</SBtn>
                  <SBtn onClick={handleNextStep} disabled={currentStep>=maxStep} sx={{flex:1,textAlign:'center',marginBottom:0}}>NEXT ▸</SBtn>
                </div>
              </div>
            )}

            {!stepMode && (
              <SBtn onClick={()=>setReplayCount(c=>c+1)}>↺ REPLAY ANIMATION</SBtn>
            )}

            {/* Speed */}
            <div style={{marginBottom:8}}>
              <div style={{display:'flex',justifyContent:'space-between',fontSize:12,color:'#666',marginBottom:6}}>
                <span>SPEED</span><span style={{color:'#999'}}>{animSpeed.toFixed(1)}×</span>
              </div>
              <input type="range" min={0.5} max={3} step={0.5} value={animSpeed}
                onChange={e=>dispatch({type:'SET_SPEED',value:parseFloat(e.target.value)})}
                style={{width:'100%',accentColor:'#fff',height:18}}/>
            </div>

            <SBtn onClick={()=>dispatch({type:'RANDOMIZE'})}>⟳ RANDOMIZE NETWORK</SBtn>
            <SBtn onClick={()=>{
              try{const r=localStorage.getItem('fiberlab_network');
                if(r){const {nodes:n,links:l}=JSON.parse(r);if(n?.length>=2)dispatch({type:'LOAD_NB',nodes:n,links:l});}}catch{}
            }}>⬇ LOAD MY NETWORK</SBtn>
            <SBtn onClick={()=>dispatch({type:'RESET'})} sx={{borderColor:'rgba(255,60,60,0.4)',color:'rgba(255,80,80,0.8)'}}>↩ RESET DEFAULT</SBtn>
          </div>

          {/* Decorative routing table */}
          <div style={{padding:'14px 20px'}}>
            <div style={{fontSize:10,letterSpacing:'0.2em',color:'#777',marginBottom:8}}>ROUTING TABLE</div>
            {RT_ROWS.map(([route,dist,lat],i)=>(
              <div key={i} style={{display:'flex',justifyContent:'space-between',
                fontSize:11,color:'#555',padding:'4px 0',
                animation:`rv-blink ${1.8+i*0.6}s ${i*0.25}s ease-in-out infinite`}}>
                <span style={{letterSpacing:'0.05em'}}>{route}</span>
                <span>{dist}</span>
                <span>{lat}</span>
              </div>
            ))}
          </div>

        </div>
      </div>

      {/* ── Hover Tooltip (screen-coord fixed) ── */}
      {tooltip && (
        <div style={{position:'fixed',left:tooltip.x,top:tooltip.y,pointerEvents:'none',
          background:'#000',border:'1px solid #fff',padding:'5px 9px',zIndex:9999,
          fontFamily:"'Courier New',monospace",fontSize:9,color:'#fff',lineHeight:1.7,transform:'translateX(-50%)'}}>
          <div style={{letterSpacing:'0.15em'}}>{tooltip.label}</div>
          <div style={{color:'#555'}}>Links: {tooltip.degree}</div>
          <div style={{color:'#555'}}>From SRC: {tooltip.distSrc}</div>
        </div>
      )}

      {/* ── Link Context Menu ── */}
      {ctxMenu && (
        <div style={{position:'fixed',left:ctxMenu.x,top:ctxMenu.y,zIndex:9998,
          background:'#0a0a0a',border:'1px solid #2a2a2a',padding:'12px 14px',minWidth:160,
          fontFamily:"'Courier New',monospace"}} onClick={e=>e.stopPropagation()}>
          <div style={{fontSize:9,letterSpacing:'0.2em',color:'#444',marginBottom:10}}>EDIT LINK WEIGHTS</div>
          {[['DISTANCE (km)','distance'],['LATENCY (ms)','latency'],['BANDWIDTH (G)','bandwidth']].map(([lbl,key])=>(
            <div key={key} style={{marginBottom:7}}>
              <div style={{fontSize:8,color:'#333',marginBottom:3,letterSpacing:'0.1em'}}>{lbl}</div>
              <input type="number" value={ctxVals[key]??''} onChange={e=>setCtxVals(v=>({...v,[key]:e.target.value}))}
                style={{width:'100%',background:'#000',border:'1px solid #222',color:'#fff',
                  fontFamily:"'Courier New',monospace",fontSize:10,padding:'3px 6px',outline:'none'}}/>
            </div>
          ))}
          <div style={{display:'flex',gap:6}}>
            <SBtn onClick={saveCtxMenu} sx={{flex:1,textAlign:'center',marginBottom:0,borderColor:'rgba(80,255,130,0.4)',color:'rgba(80,255,130,0.8)'}}>SAVE</SBtn>
            <SBtn onClick={()=>setCtxMenu(null)} sx={{flex:1,textAlign:'center',marginBottom:0}}>CANCEL</SBtn>
          </div>
        </div>
      )}

      {/* Dismiss context menu on backdrop click */}
      {ctxMenu && <div style={{position:'fixed',inset:0,zIndex:9997}} onClick={()=>setCtxMenu(null)}/>}
    </div>
  );
}
