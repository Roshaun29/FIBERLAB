import { useState, useEffect, useRef, useCallback } from 'react';

// ─── Math helpers ─────────────────────────────────────────────────────────────
const toRad = d => d * Math.PI / 180;
const toDeg = r => r * 180 / Math.PI;
const clamp = (v, mn, mx) => Math.max(mn, Math.min(mx, v));

// ─── Physics engine ───────────────────────────────────────────────────────────
function calcPhysics(incDeg, nCore, nCladding, wvNm, diamUm) {
  const sinRef = Math.sin(toRad(incDeg)) / nCore;
  const thetaRef = sinRef <= 1 ? Math.round(toDeg(Math.asin(sinRef)) * 10) / 10 : 90.0;
  const ratio = nCladding / nCore;
  const thetaCrit = ratio <= 1 ? Math.round(toDeg(Math.asin(ratio)) * 10) / 10 : 90.0;
  const NA = Math.sqrt(Math.max(0, nCore * nCore - nCladding * nCladding));
  const lambdaUm = wvNm / 1000;
  const V = (Math.PI * diamUm * NA) / lambdaUm;
  const TIR = thetaRef < (90 - thetaCrit);
  return {
    thetaRef,
    thetaCrit,
    NA: Math.round(NA * 1000) / 1000,
    V: Math.round(V * 100) / 100,
    isMultiMode: V >= 2.405,
    TIR,
  };
}

// ─── Ray tracer ───────────────────────────────────────────────────────────────
function traceRay(x0, y0, thetaDeg, topY, botY, maxBounces, W) {
  if (Math.abs(thetaDeg) < 0.05) {
    return { segs: [{ x1: x0, y1: y0, x2: W, y2: y0, op: 1.0, bounce: 0 }], pts: [] };
  }
  const tan = Math.abs(Math.tan(toRad(thetaDeg)));
  const segs = [], pts = [];
  let x = x0, y = y0, dir = 1, b = 0;

  while (x < W && b <= maxBounces) {
    const op = clamp(1.0 - b * 0.08, 0.03, 1.0);
    const tgtY = dir > 0 ? botY : topY;
    const dy = Math.abs(tgtY - y);
    if (dy < 0.5) { dir = -dir; continue; }
    const dx = dy / tan;

    if (x + dx >= W) {
      const rem = W - x;
      segs.push({ x1: x, y1: y, x2: W, y2: clamp(y + dir * rem * tan, topY, botY), op, bounce: b });
      break;
    }
    segs.push({ x1: x, y1: y, x2: x + dx, y2: tgtY, op, bounce: b });
    if (b > 0) pts.push({ x: x + dx, y: tgtY, bounce: b });
    x += dx; y = tgtY; dir = -dir; b++;
  }
  return { segs, pts };
}

// ─── Background atmosphere dashes ─────────────────────────────────────────────
function genBgDashes(W, H, topY, botY) {
  const out = [];
  for (let i = 0; i < 40; i++) {
    const above = Math.random() < 0.5;
    const y = above
      ? Math.random() * (topY - 4)
      : botY + 4 + Math.random() * (H - botY - 4);
    out.push({
      x: Math.random() * W,
      y,
      a: (Math.random() - 0.5) * 40,
      len: 8 + Math.random() * 18,
      op: 0.03 + Math.random() * 0.04,
    });
  }
  return out;
}

// ─── Drawing helpers (pure, module-level) ─────────────────────────────────────
function drawFiber(ctx, W, H, topY, botY) {
  // cladding subtle tint
  ctx.fillStyle = '#050505';
  ctx.fillRect(0, 0, W, topY);
  ctx.fillRect(0, botY, W, H - botY);
  // core tint
  ctx.fillStyle = '#030303';
  ctx.fillRect(0, topY, W, botY - topY);
  // boundary lines
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 1;
  ctx.setLineDash([]);
  ctx.beginPath();
  ctx.moveTo(0, topY); ctx.lineTo(W, topY);
  ctx.moveTo(0, botY); ctx.lineTo(W, botY);
  ctx.stroke();
}

function drawAtmosphere(ctx, dashes) {
  dashes.forEach(d => {
    const r = toRad(d.a);
    ctx.strokeStyle = `rgba(255,255,255,${d.op})`;
    ctx.lineWidth = 0.5;
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.moveTo(d.x, d.y);
    ctx.lineTo(d.x + Math.cos(r) * d.len, d.y + Math.sin(r) * d.len);
    ctx.stroke();
  });
}

function drawEntryExit(ctx, W, topY, botY) {
  ctx.strokeStyle = 'rgba(255,255,255,0.5)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(14, topY - 22); ctx.lineTo(14, botY + 22);
  ctx.moveTo(W - 14, topY - 22); ctx.lineTo(W - 14, botY + 22);
  ctx.stroke();
}

function drawIncidentRay(ctx, entryX, entryY, incDeg) {
  const len = 90;
  const r = toRad(incDeg);
  ctx.strokeStyle = '#777';
  ctx.lineWidth = 1;
  ctx.setLineDash([6, 4]);
  ctx.beginPath();
  ctx.moveTo(entryX - Math.cos(r) * len, entryY - Math.sin(r) * len);
  ctx.lineTo(entryX, entryY);
  ctx.stroke();
  ctx.setLineDash([]);
}

function drawCriticalArc(ctx, entryX, entryY, thetaCritDeg) {
  const critFromHoriz = toRad(90 - thetaCritDeg);
  ctx.strokeStyle = 'rgba(255,255,255,0.25)';
  ctx.lineWidth = 0.5;
  ctx.setLineDash([3, 4]);
  ctx.beginPath();
  ctx.arc(entryX, entryY, 55, -critFromHoriz, critFromHoriz);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.font = '10px Courier New';
  ctx.fillStyle = 'rgba(255,255,255,0.45)';
  ctx.fillText('θc', entryX + 60, entryY + 4);
}

function drawEvanescent(ctx, entryX, entryY, thetaDeg, topY, botY, W) {
  const tan = Math.abs(Math.tan(toRad(thetaDeg)));
  const tgtY = thetaDeg >= 0 ? botY : topY;
  const dy = Math.abs(tgtY - entryY);
  const dx = dy / (tan || 0.001);
  const exitX = Math.min(entryX + dx, W);

  // ray to wall
  ctx.strokeStyle = 'rgba(255,255,255,0.35)';
  ctx.lineWidth = 1;
  ctx.setLineDash([]);
  ctx.beginPath(); ctx.moveTo(entryX, entryY); ctx.lineTo(exitX, tgtY); ctx.stroke();

  // evanescent extension into cladding
  const grad = ctx.createLinearGradient(exitX, tgtY, exitX + 60, tgtY + (tgtY === topY ? -40 : 40));
  grad.addColorStop(0, 'rgba(255,255,255,0.18)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.strokeStyle = grad;
  ctx.lineWidth = 0.8;
  ctx.setLineDash([3, 5]);
  ctx.beginPath();
  ctx.moveTo(exitX, tgtY);
  ctx.lineTo(exitX + 60, tgtY + (tgtY === topY ? -40 : 40));
  ctx.stroke();
  ctx.setLineDash([]);
}

function drawRays(ctx, segs, primary) {
  segs.forEach(s => {
    ctx.strokeStyle = `rgba(255,255,255,${primary ? s.op : s.op * 0.55})`;
    ctx.lineWidth = primary ? 1.5 : 1;
    ctx.setLineDash([]);
    ctx.beginPath(); ctx.moveTo(s.x1, s.y1); ctx.lineTo(s.x2, s.y2); ctx.stroke();
  });
}

function drawBouncePoints(ctx, pts) {
  pts.forEach(p => {
    ctx.beginPath(); ctx.arc(p.x, p.y, 2, 0, Math.PI * 2);
    ctx.fillStyle = '#ffffff'; ctx.fill();
  });
}

function drawAnimDot(ctx, segs, dotT) {
  const total = segs.reduce((s, e) => s + Math.hypot(e.x2 - e.x1, e.y2 - e.y1), 0);
  if (!total) return;
  let rem = dotT % total;
  for (const s of segs) {
    const len = Math.hypot(s.x2 - s.x1, s.y2 - s.y1);
    if (rem <= len) {
      const t = rem / len;
      const dx = s.x1 + (s.x2 - s.x1) * t;
      const dy = s.y1 + (s.y2 - s.y1) * t;
      ctx.beginPath(); ctx.arc(dx, dy, 4.5, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255,255,255,0.95)';
      ctx.shadowColor = '#fff'; ctx.shadowBlur = 8;
      ctx.fill(); ctx.shadowBlur = 0;
      return;
    }
    rem -= len;
  }
}

function drawWaveMode(ctx, topY, botY, W, phase, wvNm, corePx, combined) {
  const wvPx = clamp(wvNm / 7, 30, 300);
  const amp = corePx * 0.36;
  const centerY = (topY + botY) / 2;
  ctx.save();
  ctx.beginPath(); ctx.rect(0, topY, W, corePx); ctx.clip();
  ctx.strokeStyle = combined ? 'rgba(255,255,255,0.35)' : 'rgba(255,255,255,0.92)';
  ctx.lineWidth = combined ? 0.8 : 1.2;
  ctx.setLineDash([]);
  ctx.beginPath();
  for (let x = 0; x <= W; x += 2) {
    const y = centerY + amp * Math.sin(2 * Math.PI * (x / wvPx) - phase);
    x === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
  }
  ctx.stroke();
  ctx.restore();
}

function drawFieldMode(ctx, W, topY, botY, phase, dim) {
  const coreH = botY - topY;
  const lineCount = 40;
  ctx.save();
  ctx.beginPath(); ctx.rect(0, topY + 1, W, coreH - 2); ctx.clip();
  ctx.setLineDash([12, 6]);

  for (let i = 0; i < lineCount; i++) {
    const frac = i / (lineCount - 1);
    const yBase = topY + frac * coreH;
    const distFromCenter = Math.abs(frac - 0.5) * 2;
    const amp = 1.5 + distFromCenter * 6;
    const freq = 0.022 + i * 0.0006;
    const lPhase = phase * 0.4 + i * 0.22;
    const op = dim ? 0.04 : (0.13 - distFromCenter * 0.04);

    ctx.strokeStyle = `rgba(255,255,255,${Math.max(0.02, op)})`;
    ctx.lineWidth = 0.7;
    ctx.beginPath();
    for (let x = 0; x <= W; x += 3) {
      const y = yBase + amp * Math.sin(x * freq + lPhase);
      x === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  ctx.setLineDash([]);
  ctx.restore();
}

function drawCrossSection(ctx, angle, isMulti, rCount) {
  const W = 200, H = 200, cx = 100, cy = 100;
  ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);

  // rings
  [{ r: 90, col: '#1e1e1e' }, { r: 70, col: '#333' }, { r: 40, col: '#fff' }].forEach(({ r, col }) => {
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.strokeStyle = col; ctx.lineWidth = 1.5; ctx.stroke();
  });

  // Mode spots
  const spots = isMulti ? Math.min(rCount, 6) : 1;
  for (let s = 0; s < spots; s++) {
    const a = angle + (s / spots) * Math.PI * 2;
    const rr = isMulti ? 18 : 0;
    const sx = cx + rr * Math.cos(a), sy = cy + rr * Math.sin(a);
    const spotR = isMulti ? 4 : 9;
    // Glow
    ctx.beginPath(); ctx.arc(sx, sy, spotR + 8, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255,255,255,0.06)'; ctx.fill();
    ctx.beginPath(); ctx.arc(sx, sy, spotR, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255,255,255,0.92)'; ctx.fill();
  }

  // Labels with leader lines
  const lbls = [
    { r: 56, a: -Math.PI / 3, text: 'CORE' },
    { r: 82, a: Math.PI / 3, text: 'CLADDING' },
    { r: 98, a: -Math.PI, text: 'COATING' },
  ];
  ctx.font = '8px Courier New';
  lbls.forEach(l => {
    const lx = cx + l.r * Math.cos(l.a);
    const ly = cy + l.r * Math.sin(l.a);
    ctx.strokeStyle = 'rgba(255,255,255,0.2)'; ctx.lineWidth = 0.5;
    ctx.beginPath(); ctx.moveTo(cx + (l.r - 10) * Math.cos(l.a), cy + (l.r - 10) * Math.sin(l.a));
    ctx.lineTo(lx, ly); ctx.stroke();
    ctx.fillStyle = '#444'; ctx.fillText(l.text, lx + 2, ly + 3);
  });
}

// ─── Slider sub-component ─────────────────────────────────────────────────────
function Slider({ label, min, max, step, value, onChange, unit }) {
  return (
    <div style={{ flex: 1, padding: '0 12px', minWidth: 0 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: '#777', letterSpacing: '0.12em', marginBottom: 4 }}>
        <span>{label}</span>
        <span style={{ color: '#ccc', fontWeight: 'bold' }}>{value}{unit}</span>
      </div>
      <input type="range" min={min} max={max} step={step} value={value}
        onChange={e => onChange(parseFloat(e.target.value))}
        style={{ width: '100%', accentColor: '#fff', cursor: 'pointer', height: 18 }} />
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────
export default function LightPropagationLab() {
  const [incAngle, setIncAngle] = useState(30);
  const [nCore, setNCore] = useState(1.48);
  const [nCladding, setNCladding] = useState(1.44);
  const [wavelength, setWavelength] = useState(1550);
  const [coreDiam, setCoreDiam] = useState(9);
  const [maxBounces, setMaxBounces] = useState(12);
  const [rayCount, setRayCount] = useState(1);
  const [animSpeed, setAnimSpeed] = useState(1.0);
  const [vizMode, setVizMode] = useState('ray');
  const [tooltip, setTooltip] = useState(null);

  const mainCanvasRef = useRef(null);
  const xsCanvasRef = useRef(null);
  const containerRef = useRef(null);
  const rafRef = useRef(null);
  const phaseRef = useRef(0);
  const xsAngleRef = useRef(0);
  const dotTRef = useRef(0);
  const bgDashesRef = useRef([]);
  const bgFrameRef = useRef(0);
  const prRef = useRef({});
  const bpRef = useRef([]); // bounce points for tooltip
  const dragRef = useRef(null);

  // Keep params ref fresh
  useEffect(() => {
    prRef.current = { incAngle, nCore, nCladding, wavelength, coreDiam, maxBounces, rayCount, animSpeed, vizMode };
  }, [incAngle, nCore, nCladding, wavelength, coreDiam, maxBounces, rayCount, animSpeed, vizMode]);

  // Derived physics (for stats bar — reactive to state)
  const ph = calcPhysics(incAngle, nCore, nCladding, wavelength, coreDiam);

  // ── Draw (reads from refs, never stale) ──────────────────────────────────────
  const drawAll = useCallback(() => {
    const canvas = mainCanvasRef.current;
    const xsCanvas = xsCanvasRef.current;
    if (!canvas || canvas.width < 10) return;

    const ctx = canvas.getContext('2d');
    const W = canvas.width, H = canvas.height;
    const p = prRef.current;
    const phy = calcPhysics(p.incAngle, p.nCore, p.nCladding, p.wavelength, p.coreDiam);

    // Fiber geometry
    const PX_PER_UM = clamp((H * 0.65) / 100, 1.5, 7);
    const corePx = clamp(p.coreDiam * PX_PER_UM, 18, H * 0.75);
    const topY = H / 2 - corePx / 2;
    const botY = H / 2 + corePx / 2;
    const entryX = 18, entryY = H / 2;

    // Background
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, W, H);

    // Atmosphere (regenerate every ~3s)
    bgFrameRef.current++;
    if (bgFrameRef.current > 180 || bgDashesRef.current.length === 0) {
      bgDashesRef.current = genBgDashes(W, H, topY, botY);
      bgFrameRef.current = 0;
    }
    drawAtmosphere(ctx, bgDashesRef.current);

    drawFiber(ctx, W, H, topY, botY);
    drawEntryExit(ctx, W, topY, botY);
    drawIncidentRay(ctx, entryX, entryY, p.incAngle);
    if (phy.thetaCrit < 90) drawCriticalArc(ctx, entryX, entryY, phy.thetaCrit);

    // ── FIELD MODE (background) ──
    if (p.vizMode === 'field' || p.vizMode === 'combined') {
      drawFieldMode(ctx, W, topY, botY, phaseRef.current, p.vizMode === 'combined');
    }

    // ── RAY MODE ──
    const allSegs = [], allPts = [];

    if (p.vizMode === 'ray' || p.vizMode === 'combined') {
      const numRays = phy.isMultiMode ? clamp(p.rayCount, 1, 12) : 1;
      const spread = phy.isMultiMode && numRays > 1 ? 3.5 : 0;

      for (let r = 0; r < numRays; r++) {
        const off = numRays > 1 ? (r / (numRays - 1) - 0.5) * 2 * spread : 0;
        const rayAngle = phy.thetaRef + off;

        if (!phy.TIR && r === 0) {
          drawEvanescent(ctx, entryX + 4, entryY, rayAngle, topY, botY, W);
          continue;
        }

        const { segs, pts } = traceRay(entryX + 4, entryY, rayAngle, topY, botY, p.maxBounces, W - 18);
        drawRays(ctx, segs, r === 0);
        drawBouncePoints(ctx, pts);

        if (r === 0) { allSegs.push(...segs); allPts.push(...pts); }
      }

      // Animated traveling dot
      if (allSegs.length > 0) {
        dotTRef.current += 2.2 * p.animSpeed;
        drawAnimDot(ctx, allSegs, dotTRef.current);
      }
    }

    bpRef.current = allPts;

    // ── WAVE MODE ──
    if (p.vizMode === 'wave' || p.vizMode === 'combined') {
      drawWaveMode(ctx, topY, botY, W, phaseRef.current, p.wavelength, corePx, p.vizMode === 'combined');
    }

    // Phase update
    phaseRef.current += 0.06 * p.animSpeed;

    // ── Canvas watermark ──
    ctx.font = '11px Courier New';
    ctx.fillStyle = '#444';
    ctx.fillText('DRAG TO CHANGE ANGLE  ·  HOVER BOUNCE POINTS FOR INFO', 14, H - 10);

    // ── Cross-section ──
    if (xsCanvas) {
      const xsCtx = xsCanvas.getContext('2d');
      drawCrossSection(xsCtx, xsAngleRef.current, phy.isMultiMode, p.rayCount);
      xsAngleRef.current += 0.015 * p.animSpeed;
    }
  }, []); // stable — reads from refs

  // ── Animation loop + canvas sizing ───────────────────────────────────────────
  useEffect(() => {
    const updateSize = () => {
      const canvas = mainCanvasRef.current;
      const container = containerRef.current;
      if (!canvas || !container) return;
      canvas.width = Math.floor(container.clientWidth - 222);
      canvas.height = Math.floor(container.clientHeight);
      bgDashesRef.current = []; // force regeneration
    };

    updateSize();
    window.addEventListener('resize', updateSize);

    let active = true;
    const loop = () => {
      if (!active) return;
      drawAll();
      rafRef.current = requestAnimationFrame(loop);
    };
    rafRef.current = requestAnimationFrame(loop);

    return () => {
      active = false;
      cancelAnimationFrame(rafRef.current);
      window.removeEventListener('resize', updateSize);
    };
  }, [drawAll]);

  // ── Mouse interaction ─────────────────────────────────────────────────────────
  const handleMouseDown = (e) => {
    dragRef.current = { startY: e.clientY, startAngle: incAngle };
  };

  const handleMouseMove = useCallback((e) => {
    // Drag → change angle
    if (dragRef.current) {
      const dy = e.clientY - dragRef.current.startY;
      const newAngle = clamp(dragRef.current.startAngle - dy * 0.35, 0, 90);
      setIncAngle(Math.round(newAngle));
    }

    // Tooltip on bounce point
    const canvas = mainCanvasRef.current;
    if (!canvas) { setTooltip(null); return; }
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const mx = (e.clientX - rect.left) * scaleX;
    const my = (e.clientY - rect.top) * scaleY;

    let found = null;
    for (const bp of bpRef.current) {
      if (Math.hypot(mx - bp.x, my - bp.y) < 14) {
        found = { x: e.clientX, y: e.clientY, bounce: bp.bounce, reflAngle: prRef.current ? calcPhysics(prRef.current.incAngle, prRef.current.nCore, prRef.current.nCladding, prRef.current.wavelength, prRef.current.coreDiam).thetaRef : 0 };
        break;
      }
    }
    setTooltip(found);
  }, []);

  const handleMouseUp = () => { dragRef.current = null; };

  const handleCapture = () => {
    const c = mainCanvasRef.current;
    if (!c) return;
    const a = document.createElement('a');
    a.download = 'fiberlab-light-propagation.png';
    a.href = c.toDataURL('image/png');
    a.click();
  };

  // ─────────────────────────────────────────────────────────────────────────────
  return (
    <div style={{
      width: '100%', height: '100%', background: '#000',
      display: 'flex', flexDirection: 'column',
      fontFamily: "'Courier New', Courier, monospace",
      userSelect: 'none', overflow: 'hidden',
    }}>
      {/* ── Main simulation area ── */}
      <div ref={containerRef} style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
        {/* Simulation canvas */}
        <canvas ref={mainCanvasRef}
          style={{ flex: 1, display: 'block', cursor: dragRef.current ? 'ns-resize' : 'crosshair' }}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={() => { dragRef.current = null; setTooltip(null); }}
        />

        {/* Right panel: cross-section + mode controls */}
        <div style={{
          width: 248, flexShrink: 0, background: '#080808',
          borderLeft: '1px solid #222',
          display: 'flex', flexDirection: 'column',
          alignItems: 'center', padding: '14px 0', gap: 0,
        }}>
          <div style={{ fontSize: 12, color: '#888', letterSpacing: '0.2em', marginBottom: 10 }}>
            FIBER CROSS-SECTION
          </div>
          <canvas ref={xsCanvasRef} width={200} height={200}
            style={{ border: '1px solid #2a2a2a', display: 'block' }} />

          {/* Visualization mode buttons */}
          <div style={{ width: '100%', padding: '14px 16px 6px' }}>
            <div style={{ fontSize: 12, color: '#888', letterSpacing: '0.2em', marginBottom: 10, textAlign: 'center' }}>
              VISUALIZATION MODE
            </div>
            {[['ray', 'RAY OPTICS'], ['wave', 'EM WAVE'], ['field', 'FIELD LINES'], ['combined', 'COMBINED']].map(([id, lbl]) => (
              <button key={id} onClick={() => setVizMode(id)} style={{
                display: 'block', width: '100%', marginBottom: 7, padding: '9px 12px',
                background: vizMode === id ? 'rgba(255,255,255,0.07)' : 'transparent',
                border: `1px solid ${vizMode === id ? 'rgba(255,255,255,0.7)' : '#2a2a2a'}`,
                color: vizMode === id ? '#fff' : '#666',
                fontFamily: "'Courier New', monospace", fontSize: 12,
                letterSpacing: '0.15em', cursor: 'pointer', textAlign: 'left',
                transition: 'all 150ms', borderRadius: 4,
                fontWeight: vizMode === id ? 'bold' : 'normal',
              }}>
                {vizMode === id && '▶ '}{lbl}
              </button>
            ))}
          </div>

          {/* Capture button */}
          <div style={{ width: '100%', padding: '0 16px', marginTop: 'auto' }}>
            <button onClick={handleCapture} style={{
              display: 'block', width: '100%', padding: '9px 10px',
              background: 'transparent', border: '1px solid #2a2a2a',
              color: '#666', fontFamily: "'Courier New', monospace",
              fontSize: 12, letterSpacing: '0.12em', cursor: 'pointer',
              transition: 'all 150ms', borderRadius: 4,
            }}
              onMouseEnter={e => { e.target.style.color = '#ccc'; e.target.style.borderColor = '#555'; }}
              onMouseLeave={e => { e.target.style.color = '#666'; e.target.style.borderColor = '#2a2a2a'; }}
            >
              ⬇ CAPTURE PNG
            </button>
          </div>
        </div>
      </div>

      {/* ── Stats bar ── */}
      <div style={{
        height: 56, background: '#080808', borderTop: '1px solid #222',
        display: 'flex', alignItems: 'center', padding: '0 16px',
        overflowX: 'auto', flexShrink: 0,
      }}>
        {[
          ['θ_INC', `${incAngle}°`],
          ['θ_REF', `${ph.thetaRef}°`],
          ['θ_CRIT', `${ph.thetaCrit}°`],
          ['NA', `${ph.NA}`],
          ['V-NUM', `${ph.V}`],
          ['MODE', ph.isMultiMode ? 'MULTI' : 'SINGLE'],
          ['TIR', ph.TIR ? 'YES' : 'NO'],
        ].map(([label, val], i) => (
          <div key={label} style={{
            display: 'flex', alignItems: 'center', height: '100%',
            paddingRight: 20, marginRight: 20,
            borderRight: i < 6 ? '1px solid #222' : 'none',
            whiteSpace: 'nowrap',
          }}>
            <span style={{ fontSize: 12, color: '#888', marginRight: 8, letterSpacing: '0.1em' }}>{label}:</span>
            <span style={{
              fontSize: 16, letterSpacing: '0.05em', fontWeight: 'bold',
              color: label === 'MODE' && ph.isMultiMode ? '#ffd700'
                : label === 'TIR' && !ph.TIR ? '#ff5050'
                : '#fff',
            }}>{val}</span>
          </div>
        ))}
      </div>

      {/* ── Controls panel ── */}
      <div style={{
        height: 150, background: '#080808', borderTop: '1px solid #222',
        display: 'flex', flexDirection: 'column', justifyContent: 'space-around',
        padding: '8px 0', flexShrink: 0,
      }}>
        {/* Row 1 */}
        <div style={{ display: 'flex', height: 58 }}>
          <Slider label="INCIDENT ANGLE" min={0} max={90} step={1}
            value={incAngle} onChange={setIncAngle} unit="°" />
          <Slider label="N_CORE" min={1.40} max={1.60} step={0.01}
            value={nCore} onChange={v => { setNCore(v); if (v <= nCladding) setNCladding(Math.round((v - 0.01) * 100) / 100); }} unit="" />
          <Slider label="N_CLADDING" min={1.30} max={1.55} step={0.01}
            value={nCladding} onChange={v => setNCladding(Math.min(v, nCore - 0.01))} unit="" />
          <Slider label="WAVELENGTH" min={400} max={1700} step={10}
            value={wavelength} onChange={setWavelength} unit="nm" />
        </div>
        {/* Row 2 */}
        <div style={{ display: 'flex', height: 58 }}>
          <Slider label="CORE DIAMETER" min={4} max={100} step={1}
            value={coreDiam} onChange={setCoreDiam} unit="μm" />
          <Slider label="MAX BOUNCES" min={1} max={30} step={1}
            value={maxBounces} onChange={setMaxBounces} unit="" />
          <Slider label="RAY COUNT" min={1} max={12} step={1}
            value={rayCount} onChange={setRayCount} unit="" />
          <Slider label="ANIM SPEED" min={0.1} max={3} step={0.1}
            value={animSpeed} onChange={setAnimSpeed} unit="×" />
        </div>
      </div>

      {/* ── Hover tooltip ── */}
      {tooltip && (
        <div style={{
          position: 'fixed', left: tooltip.x + 16, top: tooltip.y - 64,
          background: '#050505', border: '1px solid rgba(255,255,255,0.7)', padding: '8px 14px',
          fontFamily: "'Courier New', monospace", fontSize: 13, color: '#fff',
          lineHeight: 1.8, pointerEvents: 'none', zIndex: 9999, borderRadius: 4,
          boxShadow: '0 4px 20px rgba(0,0,0,0.8)',
        }}>
          <div style={{ letterSpacing: '0.12em', fontWeight: 'bold' }}>Bounce #{tooltip.bounce}</div>
          <div style={{ color: '#999' }}>θ_refl: {tooltip.reflAngle}°</div>
          <div style={{ color: '#999' }}>Power: −{(tooltip.bounce * 0.5).toFixed(1)} dBm</div>
        </div>
      )}
    </div>
  );
}
