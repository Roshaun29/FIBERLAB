import { useState, useEffect, useRef, useCallback } from 'react';

// ─── Constants ────────────────────────────────────────────────────────────────
const RX_SENSITIVITY = -20; // dBm hardcoded
const PAD = { top: 40, right: 36, bottom: 64, left: 80 };
const ANIM_DUR = 400; // ms

// ─── Physics Helpers ──────────────────────────────────────────────────────────
function wlOffset(nm) {
  if (nm <= 1310) return 0.05;
  if (nm <= 1550) return 0.05 - 0.05 * ((nm - 1310) / 240);
  if (nm <= 1625) return 0.02 * ((nm - 1550) / 75);
  return 0.02;
}

function getBand(nm) {
  if (Math.abs(nm - 1310) <= 8) return 'O-BAND';
  if (Math.abs(nm - 1550) <= 8) return 'C-BAND';
  if (Math.abs(nm - 1625) <= 8) return 'L-BAND';
  return null;
}

function calcMaxRange(p) {
  const att = p.attenuation + wlOffset(p.wavelength);
  if (att <= 0) return Infinity;
  return (p.initialPower - RX_SENSITIVITY) / att;
}

// ─── Curve Generation ─────────────────────────────────────────────────────────
function makePrimary(p, W, H) {
  const att = p.attenuation + wlOffset(p.wavelength);
  const pw = W - PAD.left - PAD.right;
  const ph = H - PAD.top - PAD.bottom;
  const yMax = p.initialPower + 5;
  const yRange = yMax - (-30);
  return Array.from({ length: 201 }, (_, i) => {
    const d = (i / 200) * p.maxDistance;
    const sig = p.initialPower - att * d;
    return {
      x: PAD.left + (i / 200) * pw,
      y: PAD.top + ((yMax - sig) / yRange) * ph,
      d, sig,
    };
  });
}

function makeSplice(p, W, H) {
  const att = p.attenuation + wlOffset(p.wavelength);
  const pw = W - PAD.left - PAD.right;
  const ph = H - PAD.top - PAD.bottom;
  const yMax = p.initialPower + 5;
  const yRange = yMax - (-30);
  const toX = d => PAD.left + (d / p.maxDistance) * pw;
  const toY = s => PAD.top + ((yMax - s) / yRange) * ph;

  const spliceDists = [];
  for (let d = p.spliceInterval; d < p.maxDistance - 0.0001; d += p.spliceInterval) {
    spliceDists.push(parseFloat(d.toFixed(4)));
  }

  const bounds = [0, ...spliceDists, p.maxDistance];
  const pts = [];
  const markers = [];
  const PPS = 30;

  for (let seg = 0; seg < bounds.length - 1; seg++) {
    const d0 = bounds[seg];
    const d1 = bounds[seg + 1];
    const cumLoss = seg * p.spliceLoss;

    for (let j = (seg === 0 ? 0 : 1); j <= PPS; j++) {
      const d = d0 + (d1 - d0) * (j / PPS);
      const sig = p.initialPower - att * d - cumLoss;
      pts.push({ x: toX(d), y: toY(sig), d, sig });
    }

    if (seg < bounds.length - 2) {
      const sd = d1;
      const sigBefore = p.initialPower - att * sd - cumLoss;
      const sigAfter = sigBefore - p.spliceLoss;
      markers.push({ x: toX(sd), yBefore: toY(sigBefore), yAfter: toY(sigAfter), d: sd, sigBefore, sigAfter });
      pts.push({ x: toX(sd), y: toY(sigAfter), d: sd, sig: sigAfter });
    }
  }

  return { pts, markers };
}

// ─── Canvas Draw Function ─────────────────────────────────────────────────────
function drawCanvas(ctx, p, W, H, prevPts, progress, wavePhase, mouse) {
  const ph = H - PAD.top - PAD.bottom;
  const pw = W - PAD.left - PAD.right;
  const yMax = p.initialPower + 5;
  const yRange = yMax - (-30);
  const att = p.attenuation + wlOffset(p.wavelength);

  const toX = d => PAD.left + (d / p.maxDistance) * pw;
  const toY = s => PAD.top + ((yMax - s) / yRange) * ph;

  // ── Background ──────────────────────────────────────────────────────────────
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, W, H);

  // ── Grid ────────────────────────────────────────────────────────────────────
  ctx.save();
  ctx.strokeStyle = '#1c1c1c';
  ctx.lineWidth = 1;
  for (let i = 0; i <= 10; i++) {
    const x = PAD.left + (i / 10) * pw;
    ctx.beginPath(); ctx.moveTo(x, PAD.top); ctx.lineTo(x, PAD.top + ph); ctx.stroke();
    const y = PAD.top + (i / 10) * ph;
    ctx.beginPath(); ctx.moveTo(PAD.left, y); ctx.lineTo(PAD.left + pw, y); ctx.stroke();
  }
  ctx.restore();

  // ── Zone fills ───────────────────────────────────────────────────────────────
  const y7 = toY(7);
  const y3 = toY(3);
  const plotTop = PAD.top;
  const plotBot = PAD.top + ph;

  if (y7 > plotTop) {
    ctx.fillStyle = 'rgba(0,255,100,0.05)';
    ctx.fillRect(PAD.left, plotTop, pw, Math.min(y7, plotBot) - plotTop);
  }
  const medTop = Math.max(plotTop, y7);
  const medBot = Math.min(plotBot, y3);
  if (medBot > medTop) {
    ctx.fillStyle = 'rgba(255,200,0,0.04)';
    ctx.fillRect(PAD.left, medTop, pw, medBot - medTop);
  }
  if (y3 < plotBot) {
    ctx.fillStyle = 'rgba(255,30,30,0.07)';
    ctx.fillRect(PAD.left, Math.max(plotTop, y3), pw, plotBot - Math.max(plotTop, y3));
  }

  // ── Threshold lines ─────────────────────────────────────────────────────────
  ctx.save();
  ctx.setLineDash([5, 5]);
  ctx.font = 'bold 12px "Courier New", monospace';
  ctx.textAlign = 'left';

  [[7, y7, 'rgba(0,255,100,0.7)', '7 dBm (STRONG)'], [3, y3, 'rgba(255,200,0,0.7)', '3 dBm (MEDIUM)']].forEach(([, y, col, label]) => {
    if (y >= plotTop && y <= plotBot) {
      ctx.strokeStyle = col;
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(PAD.left, y); ctx.lineTo(PAD.left + pw, y); ctx.stroke();
      ctx.fillStyle = col;
      ctx.fillText(label, PAD.left + 6, y - 6);
    }
  });
  ctx.setLineDash([]);
  ctx.restore();

  // ── RX Sensitivity threshold ─────────────────────────────────────────────────
  const yRx = toY(RX_SENSITIVITY);
  if (yRx >= plotTop && yRx <= plotBot) {
    ctx.save();
    ctx.strokeStyle = 'rgba(255,80,80,0.8)';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([6, 4]);
    ctx.beginPath(); ctx.moveTo(PAD.left, yRx); ctx.lineTo(PAD.left + pw, yRx); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = 'rgba(255,80,80,0.9)';
    ctx.font = 'bold 12px "Courier New", monospace';
    ctx.textAlign = 'left';
    ctx.fillText('RX THRESHOLD  −20 dBm', PAD.left + 8, yRx - 6);
    ctx.restore();
  }

  // ── Compute & lerp primary curve ─────────────────────────────────────────────
  const newPts = makePrimary(p, W, H);
  let renderPts = newPts;
  if (prevPts && prevPts.length === newPts.length && progress < 1) {
    renderPts = newPts.map((pt, i) => ({
      ...pt,
      y: prevPts[i].y + (pt.y - prevPts[i].y) * progress,
    }));
  }

  // ── Secondary splice curve ───────────────────────────────────────────────────
  if (p.showSplice) {
    const { pts: splPts, markers } = makeSplice(p, W, H);

    ctx.save();
    ctx.globalAlpha = 0.55;
    ctx.strokeStyle = 'rgba(255,200,0,0.9)';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([3, 6]);
    ctx.beginPath();
    splPts.forEach((pt, i) => {
      if (i === 0) ctx.moveTo(pt.x, pt.y);
      else ctx.lineTo(pt.x, pt.y);
    });
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;

    markers.forEach(sm => {
      ctx.save();
      ctx.strokeStyle = 'rgba(255,200,0,0.8)';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([2, 3]);
      ctx.beginPath(); ctx.moveTo(sm.x, sm.yBefore); ctx.lineTo(sm.x, sm.yAfter); ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = 'rgba(255,200,0,0.95)';
      ctx.beginPath(); ctx.arc(sm.x, sm.yBefore, 4, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    });
  }

  // ── Primary signal curve ────────────────────────────────────────────────────
  if (renderPts.length > 1) {
    // Glow
    ctx.save();
    ctx.strokeStyle = 'rgba(255,255,255,0.12)';
    ctx.lineWidth = 8;
    ctx.beginPath();
    ctx.moveTo(renderPts[0].x, renderPts[0].y);
    for (let i = 1; i < renderPts.length - 1; i++) {
      const mxc = (renderPts[i].x + renderPts[i + 1].x) / 2;
      const myc = (renderPts[i].y + renderPts[i + 1].y) / 2;
      ctx.quadraticCurveTo(renderPts[i].x, renderPts[i].y, mxc, myc);
    }
    ctx.lineTo(renderPts[renderPts.length - 1].x, renderPts[renderPts.length - 1].y);
    ctx.stroke();
    ctx.restore();

    // Main curve
    ctx.save();
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(renderPts[0].x, renderPts[0].y);
    for (let i = 1; i < renderPts.length - 1; i++) {
      const mxc = (renderPts[i].x + renderPts[i + 1].x) / 2;
      const myc = (renderPts[i].y + renderPts[i + 1].y) / 2;
      ctx.quadraticCurveTo(renderPts[i].x, renderPts[i].y, mxc, myc);
    }
    const last = renderPts[renderPts.length - 1];
    ctx.lineTo(last.x, last.y);
    ctx.stroke();
    ctx.restore();
  }

  // ── TX power dot ─────────────────────────────────────────────────────────────
  if (renderPts.length > 0) {
    const fp = renderPts[0];
    ctx.save();
    ctx.beginPath(); ctx.arc(fp.x, fp.y, 5, 0, Math.PI * 2);
    ctx.fillStyle = '#fff'; ctx.fill();
    ctx.restore();
  }

  // ── Max range vertical line ─────────────────────────────────────────────────
  const mr = calcMaxRange(p);
  if (mr >= 0 && mr <= p.maxDistance) {
    const xMR = toX(mr);
    ctx.save();
    ctx.strokeStyle = 'rgba(255,255,255,0.6)';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([4, 4]);
    ctx.beginPath(); ctx.moveTo(xMR, plotTop); ctx.lineTo(xMR, plotBot); ctx.stroke();
    ctx.setLineDash([]);
    ctx.font = 'bold 13px "Courier New", monospace';
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.textAlign = 'left';
    const mrLabel = `MAX RANGE: ${mr.toFixed(1)} km`;
    const tw = ctx.measureText(mrLabel).width;
    const lx = xMR + 6 + tw > PAD.left + pw ? xMR - tw - 10 : xMR + 6;
    ctx.fillText(mrLabel, lx, plotTop + 20);
    ctx.restore();
  }

  // ── Axis ticks + labels ─────────────────────────────────────────────────────
  ctx.save();
  ctx.font = '12px "Courier New", monospace';

  // X axis (distance)
  ctx.textAlign = 'center';
  for (let i = 0; i <= 10; i++) {
    const d = (i / 10) * p.maxDistance;
    const x = PAD.left + (i / 10) * pw;
    ctx.strokeStyle = 'rgba(255,255,255,0.4)';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(x, plotBot); ctx.lineTo(x, plotBot + 6); ctx.stroke();
    ctx.fillStyle = '#999';
    ctx.fillText(d >= 1000 ? `${(d / 1000).toFixed(1)}k` : `${Math.round(d)}`, x, plotBot + 20);
  }
  ctx.fillStyle = '#666';
  ctx.font = '12px "Courier New", monospace';
  ctx.fillText('DISTANCE (km)', PAD.left + pw / 2, plotBot + 48);

  // Y axis (dBm)
  ctx.textAlign = 'right';
  for (let i = 0; i <= 10; i++) {
    const dBm = yMax - i * (yRange / 10);
    const y = toY(dBm);
    ctx.strokeStyle = 'rgba(255,255,255,0.4)';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(PAD.left, y); ctx.lineTo(PAD.left - 6, y); ctx.stroke();
    ctx.fillStyle = '#999';
    ctx.font = '12px "Courier New", monospace';
    ctx.fillText(`${Math.round(dBm)}`, PAD.left - 10, y + 4);
  }

  // Y axis title
  ctx.save();
  ctx.fillStyle = '#666';
  ctx.font = '12px "Courier New", monospace';
  ctx.textAlign = 'center';
  ctx.translate(18, PAD.top + ph / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.fillText('SIGNAL (dBm)', 0, 0);
  ctx.restore();

  ctx.restore();

  // ── Crosshair + tooltip ─────────────────────────────────────────────────────
  if (mouse && mouse.x >= PAD.left && mouse.x <= PAD.left + pw) {
    const d = ((mouse.x - PAD.left) / pw) * p.maxDistance;
    const sig = p.initialPower - att * Math.max(0, d);
    const cy = toY(sig);

    ctx.save();
    ctx.strokeStyle = 'rgba(255,255,255,0.5)';
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 3]);
    ctx.beginPath(); ctx.moveTo(mouse.x, plotTop); ctx.lineTo(mouse.x, plotBot); ctx.stroke();
    if (cy >= plotTop && cy <= plotBot) {
      ctx.beginPath(); ctx.moveTo(PAD.left, cy); ctx.lineTo(PAD.left + pw, cy); ctx.stroke();
    }
    ctx.setLineDash([]);
    if (cy >= plotTop && cy <= plotBot) {
      ctx.fillStyle = '#fff';
      ctx.beginPath(); ctx.arc(mouse.x, cy, 4, 0, Math.PI * 2); ctx.fill();
    }

    const ttText = `d: ${d.toFixed(1)} km  /  P: ${sig.toFixed(1)} dBm`;
    ctx.font = 'bold 13px "Courier New", monospace';
    const tw = ctx.measureText(ttText).width + 18;
    const th = 28;
    let tx = mouse.x + 12;
    let ty = cy >= plotTop && cy <= plotBot ? cy - 36 : plotTop + 8;
    if (tx + tw > PAD.left + pw) tx = mouse.x - tw - 8;
    if (ty < plotTop) ty = plotTop + 8;
    if (ty + th > plotBot) ty = plotBot - th - 6;

    ctx.fillStyle = '#080808';
    ctx.strokeStyle = 'rgba(255,255,255,0.8)';
    ctx.lineWidth = 1;
    ctx.fillRect(tx, ty, tw, th);
    ctx.strokeRect(tx, ty, tw, th);
    ctx.fillStyle = '#fff';
    ctx.fillText(ttText, tx + 9, ty + 19);
    ctx.restore();
  }
}

// ─── Slider Control ───────────────────────────────────────────────────────────
function SliderControl({ id, label, note, min, max, step, value, unit, onChange }) {
  return (
    <div style={{ flex: 1, minWidth: 110, display: 'flex', flexDirection: 'column', gap: 4 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <span style={{ fontSize: 12, letterSpacing: '0.12em', color: '#bbb', textTransform: 'uppercase' }}>
          {label}
        </span>
        <span style={{ fontSize: 14, color: '#fff', letterSpacing: '0.04em', fontWeight: 'bold' }}>
          {typeof value === 'number' && !Number.isInteger(value)
            ? value.toFixed(value < 2 ? 2 : 1)
            : value}
          <span style={{ color: '#666', fontSize: 11, marginLeft: 3 }}>{unit}</span>
        </span>
      </div>
      <input
        id={id}
        type="range"
        min={min} max={max} step={step}
        value={value}
        onChange={onChange}
        style={{ width: '100%', accentColor: '#fff', cursor: 'pointer', height: 18, outline: 'none' }}
      />
      <span style={{ fontSize: 10, color: '#777', letterSpacing: '0.05em' }}>
        {note}
      </span>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────
export default function SignalVisualizer() {
  const [params, setParams] = useState({
    initialPower: 15,
    attenuation: 0.35,
    wavelength: 1550,
    maxDistance: 100,
    spliceLoss: 0.5,
    spliceInterval: 20,
    showSplice: true,
  });

  const canvasRef = useRef(null);
  const containerRef = useRef(null);
  const paramsRef = useRef(params);
  paramsRef.current = params;

  const mouseRef = useRef(null);
  const wavePhaseRef = useRef(0);
  const [cw, setCw] = useState(900);
  const [ch, setCh] = useState(500);

  useEffect(() => {
    if (!containerRef.current) return;
    const ro = new ResizeObserver(([entry]) => {
      const w = Math.floor(entry.contentRect.width);
      const h = Math.floor(entry.contentRect.height);
      if (w > 0) setCw(w);
      if (h > 0) setCh(h);
    });
    ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || cw === 0) return;

    let rafId;
    let prevPts = null;
    let prevParamSnap = null;
    let animStart = null;

    function loop(ts) {
      const p = paramsRef.current;
      const ctx = canvas.getContext('2d');
      const W = canvas.width;
      const H = canvas.height;

      if (p !== prevParamSnap) {
        if (prevParamSnap !== null) {
          prevPts = makePrimary(prevParamSnap, W, H);
          animStart = ts;
        }
        prevParamSnap = p;
      }

      let progress = 1;
      if (prevPts && animStart !== null) {
        const raw = Math.min(1, (ts - animStart) / ANIM_DUR);
        progress = 1 - (1 - raw) * (1 - raw);
        if (raw >= 1) { prevPts = null; animStart = null; }
      }

      wavePhaseRef.current = ((ts % 2000) / 2000) * Math.PI * 2;
      drawCanvas(ctx, p, W, H, prevPts, progress, wavePhaseRef.current, mouseRef.current);
      rafId = requestAnimationFrame(loop);
    }

    rafId = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafId);
  }, [cw, ch]);

  const handleMouseMove = useCallback((e) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (rect) mouseRef.current = { x: e.clientX - rect.left };
  }, []);

  const handleMouseLeave = useCallback(() => { mouseRef.current = null; }, []);

  const set = (key) => (e) => {
    const v = parseFloat(e.target.value);
    setParams(p => ({ ...p, [key]: v }));
  };

  const attEff = params.attenuation + wlOffset(params.wavelength);
  const mr = calcMaxRange(params);
  const band = getBand(params.wavelength);

  return (
    <div style={{
      background: '#000',
      color: '#fff',
      fontFamily: "'Courier New', Courier, monospace",
      userSelect: 'none',
      width: '100%',
      height: '100%',
      display: 'flex',
      flexDirection: 'column',
      overflow: 'hidden',
    }}>

      {/* ── Header ── */}
      <div style={{
        height: 60,
        flexShrink: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '0 24px',
        background: '#0a0a0a',
        borderBottom: '1px solid #2a2a2a',
      }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 16 }}>
          <span style={{ fontSize: 17, letterSpacing: '0.3em', color: '#fff', fontWeight: 'bold' }}>
            SIGNAL VISUALIZER
          </span>
          <span style={{ fontSize: 12, letterSpacing: '0.18em', color: '#777' }}>
            FIBER PROPAGATION MODEL
          </span>
        </div>

        {/* Live readout bar */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 0 }}>
          {[
            ['TX', `${params.initialPower.toFixed(1)} dBm`],
            ['ATTN', `${attEff.toFixed(3)} dB/km`],
            ['λ', `${params.wavelength} nm`],
            ['MAX RANGE', mr <= params.maxDistance ? `${mr.toFixed(1)} km` : `>${params.maxDistance} km`],
          ].map(([label, val], i) => (
            <div key={label} style={{ display: 'flex', alignItems: 'center' }}>
              {i > 0 && (
                <div style={{ width: 1, height: 28, background: '#333', margin: '0 16px' }} />
              )}
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontSize: 10, letterSpacing: '0.15em', color: '#888' }}>{label}</div>
                <div style={{ fontSize: 15, color: '#fff', letterSpacing: '0.05em', fontWeight: 'bold' }}>{val}</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* ── Canvas ── */}
      <div ref={containerRef} style={{ background: '#000', flex: 1, lineHeight: 0, overflow: 'hidden' }}>
        <canvas
          ref={canvasRef}
          width={cw}
          height={ch}
          style={{ display: 'block', width: '100%', height: '100%' }}
          onMouseMove={handleMouseMove}
          onMouseLeave={handleMouseLeave}
        />
      </div>

      {/* ── Controls ── */}
      <div style={{
        flexShrink: 0,
        minHeight: 90,
        background: '#0a0a0a',
        borderTop: '1px solid #2a2a2a',
        display: 'flex',
        alignItems: 'center',
        padding: '16px 24px',
        gap: 24,
        overflowX: 'auto',
      }}>

        <SliderControl id="sv-tx-power"
          label="TX POWER" note="Transmitter output"
          min={0} max={30} step={0.5}
          value={params.initialPower} unit="dBm"
          onChange={set('initialPower')}
        />
        <div style={{ width: 1, height: 60, background: '#222', flexShrink: 0 }} />

        <SliderControl id="sv-attenuation"
          label="ATTENUATION" note="Fiber loss per km"
          min={0.1} max={1.0} step={0.02}
          value={params.attenuation} unit="dB/km"
          onChange={set('attenuation')}
        />
        <div style={{ width: 1, height: 60, background: '#222', flexShrink: 0 }} />

        <SliderControl id="sv-wavelength"
          label="WAVELENGTH" note={band ?? 'Telecom window'}
          min={1260} max={1625} step={5}
          value={params.wavelength} unit="nm"
          onChange={set('wavelength')}
        />
        <div style={{ width: 1, height: 60, background: '#222', flexShrink: 0 }} />

        <SliderControl id="sv-distance"
          label="DISTANCE RANGE" note="X-axis scale"
          min={10} max={500} step={10}
          value={params.maxDistance} unit="km"
          onChange={set('maxDistance')}
        />
        <div style={{ width: 1, height: 60, background: '#222', flexShrink: 0 }} />

        <SliderControl id="sv-splice-loss"
          label="SPLICE LOSS" note="Per splice event"
          min={0} max={2} step={0.1}
          value={params.spliceLoss} unit="dB"
          onChange={set('spliceLoss')}
        />
        <div style={{ width: 1, height: 60, background: '#222', flexShrink: 0 }} />

        <SliderControl id="sv-splice-interval"
          label="SPLICE INTERVAL" note="Between splices"
          min={5} max={50} step={5}
          value={params.spliceInterval} unit="km"
          onChange={set('spliceInterval')}
        />
        <div style={{ width: 1, height: 60, background: '#222', flexShrink: 0 }} />

        {/* Splice curve toggle */}
        <div style={{ flexShrink: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 12, letterSpacing: '0.12em', color: '#bbb', textTransform: 'uppercase' }}>
            SPLICE CURVE
          </span>
          <button
            id="btn-toggle-splice"
            onClick={() => setParams(p => ({ ...p, showSplice: !p.showSplice }))}
            style={{
              background: params.showSplice ? 'rgba(255,200,0,0.08)' : 'transparent',
              border: `1px solid ${params.showSplice ? 'rgba(255,200,0,0.7)' : '#333'}`,
              color: params.showSplice ? 'rgba(255,200,0,0.95)' : '#777',
              fontFamily: "'Courier New', monospace",
              fontSize: 12,
              letterSpacing: '0.12em',
              padding: '8px 16px',
              cursor: 'pointer',
              transition: 'all 150ms',
              whiteSpace: 'nowrap',
              borderRadius: 4,
            }}
          >
            {params.showSplice ? '◉ ON' : '○ OFF'}
          </button>
          <span style={{ fontSize: 10, color: '#555', letterSpacing: '0.05em' }}>
            {params.showSplice ? 'splice model active' : 'hidden'}
          </span>
        </div>

      </div>
    </div>
  );
}
