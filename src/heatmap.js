// Predicted attention heatmap.
//
// THIS IS A MODEL, NOT VISITOR DATA. It estimates where attention is likely to go from
// the page layout, using well-established eye-tracking tendencies:
//   - the first screen gets far more attention than lower screens,
//   - people scan top-left first (F-pattern) on text-heavy layouts,
//   - large headings, faces/images, video and high-contrast buttons attract the eye,
//   - body text gets scanned along its left edge.
// Validate with a real heatmap tool (Microsoft Clarity is free; Hotjar) before treating
// any hotspot as fact. The report labels every output as "predicted".
//
// computeAttention() is pure (no DOM) so it can be unit-tested; renderHeatmap() draws it.

const CELL = 8; // CSS px per grid cell

function weightFor(el) {
  const area = el.rect.w * el.rect.h;
  switch (el.kind) {
    case 'heading': return Math.min(2.2, 0.55 * ((el.fontSize || 20) / 16) ** 1.2);
    case 'cta': return (el.inNav ? 0.55 : 1.15) * (el.filled ? 1.25 : 0.85) * (1 + Math.min(el.contrast || 1.5, 8) / 10);
    case 'video': return 1.4;
    case 'image': return Math.min(1.5, 0.35 + Math.sqrt(area) / 520);
    case 'logo': return 0.75;
    case 'input': return 0.6;
    case 'text': return 0.28;
    default: return 0.3;
  }
}

/**
 * @param {Array<{kind:string, rect:{x,y,w,h}, fontSize?:number, contrast?:number, filled?:boolean, inNav?:boolean}>} salient
 * @param {{pageW:number, pageH:number, viewportH:number}} page
 */
export function computeAttention(salient, { pageW, pageH, viewportH }) {
  const cols = Math.max(1, Math.ceil(pageW / CELL));
  const rows = Math.max(1, Math.ceil(pageH / CELL));
  const grid = new Float32Array(cols * rows);

  const addBlob = (cx, cy, sx, sy, w) => {
    const x0 = Math.max(0, Math.floor((cx - 2.5 * sx) / CELL)), x1 = Math.min(cols - 1, Math.ceil((cx + 2.5 * sx) / CELL));
    const y0 = Math.max(0, Math.floor((cy - 2.5 * sy) / CELL)), y1 = Math.min(rows - 1, Math.ceil((cy + 2.5 * sy) / CELL));
    const ix = 1 / (2 * sx * sx), iy = 1 / (2 * sy * sy);
    for (let gy = y0; gy <= y1; gy++) {
      const dy = gy * CELL + CELL / 2 - cy;
      const ey = Math.exp(-dy * dy * iy);
      if (ey < 0.01) continue;
      const row = gy * cols;
      for (let gx = x0; gx <= x1; gx++) {
        const dx = gx * CELL + CELL / 2 - cx;
        grid[row + gx] += w * ey * Math.exp(-dx * dx * ix);
      }
    }
  };

  for (const el of salient) {
    const r = el.rect;
    if (!r || r.w <= 0 || r.h <= 0 || r.y > pageH || r.x > pageW) continue;
    const w = weightFor(el);
    if (el.kind === 'text') {
      // Scanning: attention concentrates on the start of lines (left edge), fading right.
      const sx = Math.max(18, Math.min(r.w * 0.22, 120));
      const sy = Math.max(10, Math.min(r.h / 2, 80));
      addBlob(r.x + Math.min(r.w * 0.18, 110), r.y + r.h / 2, sx, sy, w);
    } else {
      const sx = Math.max(14, Math.min(r.w / 2, 260));
      const sy = Math.max(10, Math.min(r.h / 2, 220));
      addBlob(r.x + r.w / 2, r.y + r.h / 2, sx, sy, w);
    }
  }

  // Position prior: top of page and left side get more attention.
  let max = 0;
  for (let gy = 0; gy < rows; gy++) {
    const y = gy * CELL;
    const py = 0.18 + 0.82 * Math.exp(-y / (1.15 * viewportH));
    const row = gy * cols;
    for (let gx = 0; gx < cols; gx++) {
      const px = 1 - 0.28 * ((gx * CELL) / pageW);
      const v = grid[row + gx] * py * px;
      grid[row + gx] = v;
      if (v > max) max = v;
    }
  }

  // Shares.
  let total = 0;
  for (let i = 0; i < grid.length; i++) total += grid[i];
  const screens = Math.max(1, Math.ceil(pageH / viewportH));
  const perScreen = new Array(Math.min(screens, 20)).fill(0);
  for (let gy = 0; gy < rows; gy++) {
    const s = Math.floor((gy * CELL) / viewportH);
    if (s >= perScreen.length) continue;
    let sum = 0;
    const row = gy * cols;
    for (let gx = 0; gx < cols; gx++) sum += grid[row + gx];
    perScreen[s] += sum;
  }

  const sumIn = (r) => {
    const x0 = Math.max(0, Math.floor(r.x / CELL)), x1 = Math.min(cols - 1, Math.floor((r.x + r.w) / CELL));
    const y0 = Math.max(0, Math.floor(r.y / CELL)), y1 = Math.min(rows - 1, Math.floor((r.y + r.h) / CELL));
    let s = 0;
    for (let gy = y0; gy <= y1; gy++) for (let gx = x0; gx <= x1; gx++) s += grid[gy * cols + gx];
    return s;
  };

  // Rank first-screen elements by attention density (attention per cell inside the element).
  const foldEls = salient
    .filter((el) => el.rect && el.rect.y < viewportH && el.kind !== 'text')
    .map((el) => {
      const cells = Math.max(1, Math.ceil(el.rect.w / CELL) * Math.ceil(el.rect.h / CELL));
      return { ...el, attention: sumIn(el.rect) / cells };
    })
    .sort((a, b) => b.attention - a.attention);

  return {
    cols, rows, cell: CELL, grid, max, total,
    screenShare: perScreen.map((v) => (total ? Math.round((v / total) * 1000) / 10 : 0)),
    foldRanking: foldEls.slice(0, 12).map((e, i) => ({ rank: i + 1, kind: e.kind, label: e.label || '', rect: e.rect, inNav: !!e.inNav, filled: !!e.filled })),
    sumIn: (r) => (total ? sumIn(r) / total : 0),
  };
}

/** Attention insights used for findings and the report. */
export function attentionInsights(att, snapshot) {
  const vh = snapshot.viewport.h;
  const ctas = (snapshot.ctas || []).filter((c) => c.filled && !c.inNav && c.rect.y < vh);
  const primary = ctas[0];
  let ctaRank = null;
  if (primary) {
    const hit = att.foldRanking.find((e) => e.kind === 'cta' && Math.abs(e.rect.x - primary.rect.x) < 4 && Math.abs(e.rect.y - primary.rect.y) < 4);
    ctaRank = hit ? hit.rank : null;
  }
  const top = att.foldRanking[0];
  return {
    firstScreenShare: att.screenShare[0] || 0,
    primaryCta: primary ? primary.text : '',
    primaryCtaRank: ctaRank,
    primaryCtaShare: primary ? Math.round(att.sumIn(primary.rect) * 1000) / 10 : 0,
    topElementKind: top ? top.kind : '',
  };
}

// ---- Rendering --------------------------------------------------------------

const STOPS = [
  [0.0, [40, 70, 255]],
  [0.3, [0, 200, 255]],
  [0.5, [0, 220, 120]],
  [0.7, [255, 225, 0]],
  [1.0, [255, 40, 20]],
];

function colorAt(t) {
  for (let i = 1; i < STOPS.length; i++) {
    if (t <= STOPS[i][0]) {
      const [t0, c0] = STOPS[i - 1], [t1, c1] = STOPS[i];
      const f = (t - t0) / (t1 - t0);
      return c0.map((v, j) => Math.round(v + (c1[j] - v) * f));
    }
  }
  return STOPS[STOPS.length - 1][1];
}

/**
 * Draws screenshot + heat overlay + fold lines into a new canvas.
 * @param {ImageBitmap} bitmap  stitched screenshot
 * @param {object} att          computeAttention result
 * @param {{k:number, viewportHeight:number}} meta  screenshot px per CSS px
 */
export function renderHeatmap(bitmap, att, meta, { opacity = 0.62, showFolds = true } = {}) {
  const canvas = document.createElement('canvas');
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(bitmap, 0, 0);
  ctx.fillStyle = 'rgba(10, 14, 30, 0.38)';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // Heat layer at grid resolution, then scaled up smoothly.
  const heat = document.createElement('canvas');
  heat.width = att.cols;
  heat.height = att.rows;
  const hctx = heat.getContext('2d');
  const img = hctx.createImageData(att.cols, att.rows);
  const inv = att.max ? 1 / att.max : 0;
  for (let i = 0; i < att.grid.length; i++) {
    const t = Math.pow(att.grid[i] * inv, 0.6);
    if (t < 0.07) continue;
    const [r, g, b] = colorAt(t);
    img.data[i * 4] = r;
    img.data[i * 4 + 1] = g;
    img.data[i * 4 + 2] = b;
    img.data[i * 4 + 3] = Math.round(255 * opacity * Math.min(1, t * 1.5));
  }
  hctx.putImageData(img, 0, 0);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(heat, 0, 0, att.cols * att.cell * meta.k, att.rows * att.cell * meta.k);

  if (showFolds && meta.viewportHeight) {
    const step = meta.viewportHeight * meta.k;
    ctx.setLineDash([10, 8]);
    ctx.lineWidth = Math.max(1.5, 2 * (canvas.width / 1280));
    ctx.font = `600 ${Math.round(13 * (canvas.width / 1000 + 0.3))}px system-ui, sans-serif`;
    for (let i = 1, y = step; y < canvas.height; i++, y += step) {
      ctx.strokeStyle = 'rgba(255,255,255,0.85)';
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(canvas.width, y); ctx.stroke();
      const label = i === 1 ? 'End of first screen' : `Screen ${i + 1}`;
      const share = att.screenShare[i - 1];
      const text = `${label}${share !== undefined ? ` · screen ${i}: ${share}% of predicted attention` : ''}`;
      const tw = ctx.measureText(text).width;
      ctx.fillStyle = 'rgba(10,14,30,0.75)';
      ctx.fillRect(8, y - 26, tw + 16, 22);
      ctx.fillStyle = '#fff';
      ctx.fillText(text, 16, y - 10);
    }
    ctx.setLineDash([]);
  }
  return canvas;
}
