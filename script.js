/* FlatColor Vectorizer - self-contained browser implementation.
   No server is needed. Works as a static GitHub Pages site. */

(() => {
  'use strict';

  const MAX_TRACE_DIM = 1800;
  const SAMPLE_PIXELS = 7000;
  const MIN_AREA_FACTOR = 0.0000025;

  const $ = (id) => document.getElementById(id);
  const fileInput = $('fileInput');
  const dropzone = $('dropzone');
  const browseBtn = $('browseBtn');
  const uploadCard = $('uploadCard');
  const workspace = $('workspace');
  const newImageBtn = $('newImageBtn');
  const colorCount = $('colorCount');
  const paletteList = $('paletteList');
  const autoPaletteBtn = $('autoPaletteBtn');
  const smoothing = $('smoothing');
  const smoothingValue = $('smoothingValue');
  const noise = $('noise');
  const noiseValue = $('noiseValue');
  const preserveWhite = $('preserveWhite');
  const fitCanvas = $('fitCanvas');
  const vectorizeBtn = $('vectorizeBtn');
  const vectorizeAllBtn = $('vectorizeAllBtn');
  const batchCard = $('batchCard');
  const batchResults = $('batchResults');
  const batchSummary = $('batchSummary');
  const batchProgress = $('batchProgress');
  const batchProgressText = $('batchProgressText');
  const batchProgressPercent = $('batchProgressPercent');
  const batchProgressFill = $('batchProgressFill');
  const downloadAllSvgBtn = $('downloadAllSvgBtn');
  const downloadAllEpsBtn = $('downloadAllEpsBtn');
  const downloadAllVectorsBtn = $('downloadAllVectorsBtn');
  const statusEl = $('status');
  const sourceCanvas = $('sourceCanvas');
  const sourceCtx = sourceCanvas.getContext('2d', { willReadFrequently: true });
  const sourceEmpty = $('sourceEmpty');
  const vectorPreview = $('vectorPreview');
  const vectorEmpty = $('vectorEmpty');
  const vectorStats = $('vectorStats');
  const exportCard = $('exportCard');
  const downloadSvgBtn = $('downloadSvgBtn');
  const downloadEpsBtn = $('downloadEpsBtn');
  const fileMeta = $('fileMeta');

  let sourceImage = null;
  let sourceFileName = 'vector';
  let originalWidth = 0;
  let originalHeight = 0;
  let renderImageWidth = 0;
  let renderImageHeight = 0;
  let currentSvg = '';
  let currentEps = '';
  let currentPalette = [];
  let pickModeIndex = -1;
  let paletteMode = 'manual';
  let batchItems = [];
  let activeBatchIndex = -1;
  let batchRunning = false;

  function clamp(n, min, max) { return Math.max(min, Math.min(max, n)); }
  function hexToRgb(hex) {
    const clean = String(hex || '').replace('#', '').trim();
    if (!/^[0-9a-fA-F]{6}$/.test(clean)) return null;
    return {
      r: parseInt(clean.slice(0, 2), 16),
      g: parseInt(clean.slice(2, 4), 16),
      b: parseInt(clean.slice(4, 6), 16),
      a: 255
    };
  }
  function rgbToHex(c) {
    return '#' + [c.r, c.g, c.b].map(v => clamp(Math.round(v), 0, 255).toString(16).padStart(2, '0')).join('').toUpperCase();
  }
  function colorDistanceSq(a, b) {
    const dr = a.r - b.r, dg = a.g - b.g, db = a.b - b.b;
    return dr * dr + dg * dg + db * db;
  }
  function colorDistance(a, b) {
    return Math.sqrt(colorDistanceSq(a, b));
  }
  function setStatus(message, type = '') {
    statusEl.textContent = message;
    statusEl.className = 'status' + (type ? ' ' + type : '');
  }
  function baseName(name) {
    return String(name || 'vector').replace(/\.[^.]+$/, '').replace(/[^a-z0-9_-]+/gi, '_').replace(/^_+|_+$/g, '') || 'vector';
  }

  function makeDefaultPalette(n) {
    const defaults = [
      {r: 0, g: 0, b: 0, a: 255},
      {r: 255, g: 255, b: 255, a: 255},
      {r: 230, g: 64, b: 64, a: 255},
      {r: 39, g: 110, b: 241, a: 255},
      {r: 245, g: 167, b: 35, a: 255},
      {r: 32, g: 170, b: 123, a: 255},
      {r: 120, g: 85, b: 210, a: 255},
      {r: 20, g: 20, b: 20, a: 255}
    ];
    return defaults.slice(0, n).map(c => ({...c}));
  }

  function renderPalette(palette) {
    paletteList.innerHTML = '';
    palette.forEach((c, i) => {
      const row = document.createElement('div');
      row.className = 'palette-row';
      const color = document.createElement('input');
      color.type = 'color'; color.value = rgbToHex(c); color.title = 'Choose color';
      const hex = document.createElement('input');
      hex.className = 'hex-input'; hex.value = rgbToHex(c); hex.maxLength = 7;
      hex.setAttribute('aria-label', `Color ${i + 1} hex`);
      const pick = document.createElement('button');
      pick.type = 'button'; pick.className = 'pick-btn'; pick.textContent = '⌖'; pick.title = 'Pick from image';
      color.addEventListener('input', () => {
        const parsed = hexToRgb(color.value);
        if (parsed) { currentPalette[i] = parsed; hex.value = color.value.toUpperCase(); }
      });
      hex.addEventListener('change', () => {
        const parsed = hexToRgb(hex.value);
        if (parsed) { currentPalette[i] = parsed; color.value = rgbToHex(parsed); hex.value = rgbToHex(parsed); }
        else hex.value = rgbToHex(currentPalette[i]);
      });
      pick.addEventListener('click', () => {
        pickModeIndex = pickModeIndex === i ? -1 : i;
        paletteList.querySelectorAll('.pick-btn').forEach((b, j) => b.classList.toggle('active', j === pickModeIndex));
        sourceCanvas.style.cursor = pickModeIndex >= 0 ? 'crosshair' : 'default';
        setStatus(pickModeIndex >= 0 ? `Click the original image to sample Color ${i + 1}.` : 'Color sampling cancelled.');
      });
      row.append(color, hex, pick);
      paletteList.append(row);
    });
  }

  function updatePaletteSize() {
    const n = Number(colorCount.value);
    const old = currentPalette.slice();
    currentPalette = makeDefaultPalette(n);
    old.forEach((c, i) => { if (i < n) currentPalette[i] = c; });
    renderPalette(currentPalette);
  }

  function getVisibleSourceImageData() {
    if (!sourceImage) throw new Error('No image loaded.');
    const scale = Math.min(1, MAX_TRACE_DIM / Math.max(originalWidth, originalHeight));
    renderImageWidth = Math.max(1, Math.round(originalWidth * scale));
    renderImageHeight = Math.max(1, Math.round(originalHeight * scale));

    const work = document.createElement('canvas');
    work.width = renderImageWidth; work.height = renderImageHeight;
    const ctx = work.getContext('2d', { willReadFrequently: true });
    ctx.clearRect(0, 0, work.width, work.height);
    ctx.drawImage(sourceImage, 0, 0, work.width, work.height);
    return { canvas: work, imageData: ctx.getImageData(0, 0, work.width, work.height) };
  }

  function nearestPaletteIndex(r, g, b, palette) {
    let best = 0, bestD = Infinity;
    const sample = {r, g, b};
    for (let i = 0; i < palette.length; i++) {
      const d = colorDistanceSq(sample, palette[i]);
      if (d < bestD) { bestD = d; best = i; }
    }
    return best;
  }

  function samplePoints(imageData, maxSamples = SAMPLE_PIXELS) {
    const data = imageData.data;
    const count = Math.floor(data.length / 4);
    const step = Math.max(1, Math.floor(count / maxSamples));
    const samples = [];
    for (let i = 0; i < count; i += step) {
      const p = i * 4;
      if (data[p + 3] < 20) continue;
      samples.push({r: data[p], g: data[p + 1], b: data[p + 2]});
      if (samples.length >= maxSamples) break;
    }
    return samples;
  }

  function kMeansPalette(imageData, k) {
    const samples = samplePoints(imageData);
    if (!samples.length) return makeDefaultPalette(k);

    // Deterministic farthest-point initialization is more stable for flat artwork than random starts.
    const centers = [];
    centers.push({...samples[0]});
    while (centers.length < k) {
      let bestSample = samples[0], bestScore = -1;
      for (const s of samples) {
        let minD = Infinity;
        for (const c of centers) minD = Math.min(minD, colorDistanceSq(s, c));
        if (minD > bestScore) { bestScore = minD; bestSample = s; }
      }
      centers.push({...bestSample});
    }

    for (let iteration = 0; iteration < 7; iteration++) {
      const sums = Array.from({length: k}, () => ({r: 0, g: 0, b: 0, n: 0}));
      for (const s of samples) {
        const idx = nearestPaletteIndex(s.r, s.g, s.b, centers);
        const bucket = sums[idx];
        bucket.r += s.r; bucket.g += s.g; bucket.b += s.b; bucket.n++;
      }
      let moved = 0;
      for (let i = 0; i < k; i++) {
        if (sums[i].n) {
          const next = {r: sums[i].r / sums[i].n, g: sums[i].g / sums[i].n, b: sums[i].b / sums[i].n, a: 255};
          moved = Math.max(moved, colorDistance(centers[i], next));
          centers[i] = next;
        }
      }
      if (moved < 0.5) break;
    }

    centers.sort((a, b) => luminance(b) - luminance(a));
    return centers.map(c => ({...c, a: 255}));
  }

  function luminance(c) { return 0.2126*c.r + 0.7152*c.g + 0.0722*c.b; }

  function buildIndexedRaster(imageData, palette) {
    const {width, height, data} = imageData;
    const labels = new Uint8Array(width * height);
    const alpha = new Uint8Array(width * height);
    for (let y = 0, idx = 0; y < height; y++) {
      for (let x = 0; x < width; x++, idx++) {
        const p = idx * 4;
        alpha[idx] = data[p + 3];
        if (alpha[idx] < 20) { labels[idx] = 255; continue; }
        labels[idx] = nearestPaletteIndex(data[p], data[p+1], data[p+2], palette);
      }
    }
    return {labels, alpha, width, height};
  }

  function edgeKey(x1, y1, x2, y2) { return `${x1},${y1}|${x2},${y2}`; }
  function pointKey(x, y) { return `${x},${y}`; }

  // Builds directed boundary edges for one color. Each pixel contributes only edges
  // where its immediate neighbor is another color (or the transparent outside).
  function buildBoundaryEdges(indexed, target) {
    const {labels, width, height} = indexed;
    const edges = [];
    const startMap = new Map();
    const add = (x1, y1, x2, y2) => {
      const edge = {x1, y1, x2, y2, used: false};
      edges.push(edge);
      const key = pointKey(x1, y1);
      let list = startMap.get(key);
      if (!list) { list = []; startMap.set(key, list); }
      list.push(edge);
    };
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const idx = y * width + x;
        if (labels[idx] !== target) continue;
        if (y === 0 || labels[idx - width] !== target) add(x, y, x + 1, y);
        if (x === width - 1 || labels[idx + 1] !== target) add(x + 1, y, x + 1, y + 1);
        if (y === height - 1 || labels[idx + width] !== target) add(x + 1, y + 1, x, y + 1);
        if (x === 0 || labels[idx - 1] !== target) add(x, y + 1, x, y);
      }
    }
    return {edges, startMap};
  }

  function chooseNextEdge(candidates, prevEdge) {
    const available = candidates.filter(e => !e.used);
    if (!available.length) return null;
    if (!prevEdge || available.length === 1) return available[0];
    const pdx = prevEdge.x2 - prevEdge.x1, pdy = prevEdge.y2 - prevEdge.y1;
    const px = Math.atan2(pdy, pdx);
    let best = available[0], bestTurn = Infinity;
    for (const e of available) {
      const a = Math.atan2(e.y2 - e.y1, e.x2 - e.x1);
      let turn = a - px;
      while (turn < 0) turn += Math.PI * 2;
      while (turn >= Math.PI * 2) turn -= Math.PI * 2;
      // Favor straight/right-hand continuation around a pixel boundary.
      const score = Math.abs(turn);
      if (score < bestTurn) { bestTurn = score; best = e; }
    }
    return best;
  }

  function traceLoops(indexed, target) {
    const {edges, startMap} = buildBoundaryEdges(indexed, target);
    const loops = [];
    const safety = edges.length + 10;
    for (const first of edges) {
      if (first.used) continue;
      const points = [];
      let edge = first;
      let guard = 0;
      const startX = first.x1, startY = first.y1;
      while (edge && !edge.used && guard++ < safety) {
        edge.used = true;
        if (!points.length) points.push({x: edge.x1, y: edge.y1});
        points.push({x: edge.x2, y: edge.y2});
        if (edge.x2 === startX && edge.y2 === startY) break;
        edge = chooseNextEdge(startMap.get(pointKey(edge.x2, edge.y2)) || [], edge);
      }
      if (points.length >= 4 && points[0].x === points.at(-1).x && points[0].y === points.at(-1).y) {
        points.pop();
        loops.push(points);
      }
    }
    return loops;
  }

  function perpendicularDistance(p, a, b) {
    const dx = b.x - a.x, dy = b.y - a.y;
    if (dx === 0 && dy === 0) return Math.hypot(p.x - a.x, p.y - a.y);
    const t = clamp(((p.x - a.x)*dx + (p.y - a.y)*dy) / (dx*dx + dy*dy), 0, 1);
    const x = a.x + t*dx, y = a.y + t*dy;
    return Math.hypot(p.x - x, p.y - y);
  }

  function rdp(points, epsilon) {
    if (points.length < 3 || epsilon <= 0) return points.slice();
    let index = -1, max = epsilon;
    const first = points[0], last = points[points.length - 1];
    for (let i = 1; i < points.length - 1; i++) {
      const d = perpendicularDistance(points[i], first, last);
      if (d > max) { index = i; max = d; }
    }
    if (index < 0) return [first, last];
    const left = rdp(points.slice(0, index + 1), epsilon);
    const right = rdp(points.slice(index), epsilon);
    return left.slice(0, -1).concat(right);
  }

  function simplifyClosedLoop(points, epsilon) {
    if (points.length < 4 || epsilon <= 0) return points.slice();
    // Remove duplicate/collinear points first.
    const cleaned = [];
    for (const p of points) {
      const prev = cleaned.at(-1);
      if (!prev || prev.x !== p.x || prev.y !== p.y) cleaned.push(p);
    }
    if (cleaned.length < 3) return cleaned;
    const collinear = [];
    for (let i = 0; i < cleaned.length; i++) {
      const a = cleaned[(i - 1 + cleaned.length) % cleaned.length];
      const b = cleaned[i];
      const c = cleaned[(i + 1) % cleaned.length];
      const cross = (b.x-a.x)*(c.y-b.y) - (b.y-a.y)*(c.x-b.x);
      if (Math.abs(cross) > 1e-9) collinear.push(b);
    }
    if (collinear.length < 3) return collinear;
    const work = collinear.concat([collinear[0]]);
    const simplified = rdp(work, epsilon);
    simplified.pop();
    return simplified.length >= 3 ? simplified : collinear;
  }

  function loopArea(points) {
    let a = 0;
    for (let i = 0; i < points.length; i++) {
      const p = points[i], q = points[(i+1) % points.length];
      a += p.x*q.y - q.x*p.y;
    }
    return Math.abs(a) / 2;
  }

  function tracePalette(indexed, palette, smoothAmount, minAreaPx) {
    const paths = [];
    const minArea = Math.max(0.5, minAreaPx);
    for (let colorIndex = 0; colorIndex < palette.length; colorIndex++) {
      const loops = traceLoops(indexed, colorIndex);
      const usable = loops
        .map(loop => simplifyClosedLoop(loop, smoothAmount))
        .filter(loop => loop.length >= 3 && loopArea(loop) >= minArea);
      if (!usable.length) continue;
      paths.push({colorIndex, color: palette[colorIndex], loops: usable});
    }
    return paths;
  }

  function rgbString(c) { return rgbToHex(c).toLowerCase(); }
  function svgPathFromLoops(loops, width, height) {
    const parts = [];
    for (const loop of loops) {
      if (loop.length < 3) continue;
      parts.push(`M ${fmt(loop[0].x)} ${fmt(loop[0].y)}`);
      for (let i = 1; i < loop.length; i++) parts.push(`L ${fmt(loop[i].x)} ${fmt(loop[i].y)}`);
      parts.push('Z');
    }
    return parts.join(' ');
  }
  function fmt(n) { return Math.round(n * 100) / 100; }

  function createSvg(paths, width, height, outputWidth, outputHeight) {
    const scaleX = outputWidth / width, scaleY = outputHeight / height;
    const pathEls = [];
    for (const p of paths) {
      const d = svgPathFromLoops(p.loops, width, height)
        .replace(/([ML]) ([^ ]+) ([^ ]+)/g, (_, cmd, x, y) => `${cmd} ${fmt(Number(x)*scaleX)} ${fmt(Number(y)*scaleY)}`);
      pathEls.push(`<path fill="${rgbString(p.color)}" fill-rule="evenodd" d="${d}"/>`);
    }
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${fmt(outputWidth)}" height="${fmt(outputHeight)}" viewBox="0 0 ${fmt(outputWidth)} ${fmt(outputHeight)}">${pathEls.join('')}</svg>`;
  }

  function createEps(paths, width, height, outputWidth, outputHeight) {
    const scaleX = outputWidth / width, scaleY = outputHeight / height;
    const lines = [
      '%!PS-Adobe-3.0 EPSF-3.0',
      `%%BoundingBox: 0 0 ${Math.ceil(outputWidth)} ${Math.ceil(outputHeight)}`,
      '%%Creator: FlatColor Vectorizer',
      '%%Pages: 1',
      '%%EndComments',
      '1 setlinejoin 1 setlinecap'
    ];
    for (const p of paths) {
      lines.push(`${(p.color.r/255).toFixed(6)} ${(p.color.g/255).toFixed(6)} ${(p.color.b/255).toFixed(6)} setrgbcolor`);
      for (const loop of p.loops) {
        if (loop.length < 3) continue;
        const firstX = loop[0].x * scaleX;
        const firstY = outputHeight - (loop[0].y * scaleY);
        lines.push(`${fmt(firstX)} ${fmt(firstY)} moveto`);
        for (let i = 1; i < loop.length; i++) {
          const x = loop[i].x * scaleX, y = outputHeight - (loop[i].y * scaleY);
          lines.push(`${fmt(x)} ${fmt(y)} lineto`);
        }
        lines.push('closepath');
      }
      lines.push('eofill');
    }
    lines.push('showpage', '%%EOF');
    return lines.join('\n');
  }


  // High-quality tracing engine: ImageTracerJS. It produces 8-direction contours
  // and fits line/quadratic spline segments instead of following raw pixel stairs.
  function normalizeTraceImageData(imageData) {
    const data = new Uint8ClampedArray(imageData.data);
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3] < 20) {
        // The vectorizer works with opaque flat-color art. Treat transparent
        // pixels as white so transparent/white backgrounds behave consistently.
        data[i] = 255; data[i + 1] = 255; data[i + 2] = 255; data[i + 3] = 255;
      } else {
        data[i + 3] = 255;
      }
    }
    return { width: imageData.width, height: imageData.height, data };
  }

  function imageTracerOptions(palette, smoothAmount, noisePx) {
    // Lower thresholds follow the source more closely; slightly higher values
    // give smoother curves while preserving intentional corners.
    const s = clamp(Number(smoothAmount) || 0, 0, 5);
    const n = clamp(Number(noisePx) || 0, 0, 30);
    return {
      ltres: 0.25 + s * 0.28,
      qtres: 0.20 + s * 0.22,
      pathomit: Math.round(n * 0.7),
      rightangleenhance: true,
      colorsampling: 0,
      colorquantcycles: 1,
      mincolorratio: 0,
      layering: 0,
      strokewidth: 0,
      linefilter: false,
      scale: 1,
      roundcoords: 2,
      viewbox: true,
      desc: false,
      blurradius: s >= 4 ? 1 : 0,
      blurdelta: 18,
      pal: palette.map(c => ({ r: Math.round(c.r), g: Math.round(c.g), b: Math.round(c.b), a: 255 }))
    };
  }

  function resizeSvgRoot(svg, width, height) {
    return svg.replace(/^<svg\s+/, `<svg width="${fmt(width)}" height="${fmt(height)}" `);
  }

  function epsEscapeNumber(n) { return fmt(n); }

  function appendEpsSegments(lines, segments, scaleX, scaleY, outputHeight, reverse = false) {
    if (!segments || !segments.length) return;
    const segs = reverse ? segments.slice().reverse() : segments;

    if (!reverse) {
      const first = segs[0];
      lines.push(`${epsEscapeNumber(first.x1 * scaleX)} ${epsEscapeNumber(outputHeight - first.y1 * scaleY)} moveto`);
      for (const seg of segs) {
        if (seg.type === 'Q' && Object.prototype.hasOwnProperty.call(seg, 'x3')) {
          const x0 = seg.x1 * scaleX, y0 = outputHeight - seg.y1 * scaleY;
          const cx = seg.x2 * scaleX, cy = outputHeight - seg.y2 * scaleY;
          const x3 = seg.x3 * scaleX, y3 = outputHeight - seg.y3 * scaleY;
          const c1x = x0 + (2 / 3) * (cx - x0), c1y = y0 + (2 / 3) * (cy - y0);
          const c2x = x3 + (2 / 3) * (cx - x3), c2y = y3 + (2 / 3) * (cy - y3);
          lines.push(`${epsEscapeNumber(c1x)} ${epsEscapeNumber(c1y)} ${epsEscapeNumber(c2x)} ${epsEscapeNumber(c2y)} ${epsEscapeNumber(x3)} ${epsEscapeNumber(y3)} curveto`);
        } else {
          lines.push(`${epsEscapeNumber(seg.x2 * scaleX)} ${epsEscapeNumber(outputHeight - seg.y2 * scaleY)} lineto`);
        }
      }
    } else {
      const last = segments[segments.length - 1];
      const start = Object.prototype.hasOwnProperty.call(last, 'x3')
        ? {x: last.x3, y: last.y3}
        : {x: last.x2, y: last.y2};
      lines.push(`${epsEscapeNumber(start.x * scaleX)} ${epsEscapeNumber(outputHeight - start.y * scaleY)} moveto`);
      for (const seg of segs) {
        const end = {x: seg.x1, y: seg.y1};
        if (seg.type === 'Q' && Object.prototype.hasOwnProperty.call(seg, 'x3')) {
          // Reversing a quadratic keeps the same control point.
          const x0 = (Object.prototype.hasOwnProperty.call(seg, 'x3') ? seg.x3 : seg.x2) * scaleX;
          const y0 = outputHeight - (Object.prototype.hasOwnProperty.call(seg, 'x3') ? seg.y3 : seg.y2) * scaleY;
          const cx = seg.x2 * scaleX, cy = outputHeight - seg.y2 * scaleY;
          const x3 = end.x * scaleX, y3 = outputHeight - end.y * scaleY;
          const c1x = x0 + (2 / 3) * (cx - x0), c1y = y0 + (2 / 3) * (cy - y0);
          const c2x = x3 + (2 / 3) * (cx - x3), c2y = y3 + (2 / 3) * (cy - y3);
          lines.push(`${epsEscapeNumber(c1x)} ${epsEscapeNumber(c1y)} ${epsEscapeNumber(c2x)} ${epsEscapeNumber(c2y)} ${epsEscapeNumber(x3)} ${epsEscapeNumber(y3)} curveto`);
        } else {
          lines.push(`${epsEscapeNumber(end.x * scaleX)} ${epsEscapeNumber(outputHeight - end.y * scaleY)} lineto`);
        }
      }
    }
    lines.push('closepath');
  }

  function createEpsFromTraceData(tracedata, outputWidth, outputHeight) {
    const scaleX = outputWidth / tracedata.width;
    const scaleY = outputHeight / tracedata.height;
    const lines = [
      '%!PS-Adobe-3.0 EPSF-3.0',
      `%%BoundingBox: 0 0 ${Math.ceil(outputWidth)} ${Math.ceil(outputHeight)}`,
      '%%Creator: FlatColor Vectorizer + ImageTracerJS',
      '%%Pages: 1',
      '%%EndComments',
      '1 setlinejoin 1 setlinecap'
    ];
    let shapeCount = 0;
    for (let layerIndex = 0; layerIndex < tracedata.layers.length; layerIndex++) {
      const color = tracedata.palette[layerIndex] || {r:0,g:0,b:0};
      const layer = tracedata.layers[layerIndex] || [];
      lines.push(`${(color.r / 255).toFixed(6)} ${(color.g / 255).toFixed(6)} ${(color.b / 255).toFixed(6)} setrgbcolor`);
      for (let pathIndex = 0; pathIndex < layer.length; pathIndex++) {
        const path = layer[pathIndex];
        if (!path || path.isholepath || !path.segments || !path.segments.length) continue;
        appendEpsSegments(lines, path.segments, scaleX, scaleY, outputHeight, false);
        for (const holeIndex of (path.holechildren || [])) {
          const hole = layer[holeIndex];
          if (hole && hole.segments && hole.segments.length) appendEpsSegments(lines, hole.segments, scaleX, scaleY, outputHeight, true);
        }
        lines.push('eofill');
        shapeCount++;
      }
    }
    lines.push('showpage', '%%EOF');
    return { eps: lines.join('\n'), shapes: shapeCount };
  }

  function highQualityTrace(imageData, palette, smoothAmount, noisePx, outW, outH) {
    if (typeof window.ImageTracer === 'undefined' || !window.ImageTracer.imagedataToTracedata) {
      return null;
    }
    const normalized = normalizeTraceImageData(imageData);
    const options = imageTracerOptions(palette, smoothAmount, noisePx);
    const tracedata = window.ImageTracer.imagedataToTracedata(normalized, options);
    let svg = window.ImageTracer.getsvgstring(tracedata, options);
    svg = resizeSvgRoot(svg, outW, outH);
    const epsResult = createEpsFromTraceData(tracedata, outW, outH);
    let colors = 0;
    let shapes = 0;
    for (let i = 0; i < tracedata.layers.length; i++) {
      const layer = tracedata.layers[i] || [];
      const count = layer.filter(p => p && !p.isholepath && p.segments && p.segments.length).length;
      if (count) colors++;
      shapes += count;
    }
    return { svg, eps: epsResult.eps, palette: tracedata.palette.map(c => ({...c})), colors, shapes };
  }

  function parseSvgForPreview(svg) {
    vectorPreview.innerHTML = svg;
    const el = vectorPreview.querySelector('svg');
    if (el) { el.removeAttribute('width'); el.removeAttribute('height'); el.style.maxWidth = '100%'; el.style.maxHeight = '620px'; }
  }

  function getPaletteForVector(imageData, n) {
    if (paletteMode === 'auto') {
      let auto = kMeansPalette(imageData, n);
      if (preserveWhite.checked) {
        const white = {r:255,g:255,b:255,a:255};
        if (!auto.some(c => colorDistance(c, white) < 24)) auto[auto.length - 1] = white;
      }
      return auto;
    }
    return currentPalette.slice(0, n);
  }

  async function vectorize(options = {}) {
    if (!sourceImage) { setStatus('Please choose an image first.', 'error'); return null; }
    const updateUi = options.updateUi !== false;
    vectorizeBtn.disabled = true;
    if (updateUi) exportCard.classList.add('hidden');
    if (updateUi) setStatus('Preparing image…');
    await nextFrame();
    try {
      const {imageData} = getVisibleSourceImageData();
      const n = Number(colorCount.value);
      const palette = getPaletteForVector(imageData, n);
      currentPalette = palette.map(c => ({...c}));
      if (paletteMode === 'auto') renderPalette(currentPalette);
      if (updateUi) setStatus('Reducing colors and tracing edges…');
      await nextFrame();

      const noisePx = Number(noise.value);
      const smoothAmount = Number(smoothing.value);
      const outW = fitCanvas.checked ? originalWidth : renderImageWidth;
      const outH = fitCanvas.checked ? originalHeight : renderImageHeight;

      // Primary engine: ImageTracerJS spline-based tracing. The previous pixel
      // boundary tracer remains as a safety fallback for environments where the
      // CDN library cannot be loaded.
      const traced = highQualityTrace(imageData, palette, smoothAmount, noisePx, outW, outH);
      if (traced) {
        currentSvg = traced.svg;
        currentEps = traced.eps;
        currentPalette = traced.palette.map(c => ({...c}));
        parseSvgForPreview(currentSvg);
        vectorEmpty.classList.add('hidden');
        if (updateUi) exportCard.classList.remove('hidden');
        vectorStats.textContent = `${traced.colors} colors · ${traced.shapes} shapes · spline trace`;
        if (updateUi) setStatus(`Done. ${traced.colors} color layer${traced.colors === 1 ? '' : 's'} traced with smooth paths.`, 'success');
        return {
          svg: currentSvg,
          eps: currentEps,
          palette: currentPalette.map(c => ({...c})),
          colors: traced.colors,
          shapes: traced.shapes
        };
      }

      // Fallback engine.
      const indexed = buildIndexedRaster(imageData, palette);
      const pixelArea = indexed.width * indexed.height;
      const smoothPx = smoothAmount * 0.65;
      const minArea = Math.max(noisePx * noisePx, pixelArea * MIN_AREA_FACTOR);
      const paths = tracePalette(indexed, palette, smoothPx, minArea);
      currentSvg = createSvg(paths, indexed.width, indexed.height, outW, outH);
      currentEps = createEps(paths, indexed.width, indexed.height, outW, outH);

      parseSvgForPreview(currentSvg);
      vectorEmpty.classList.add('hidden');
      if (updateUi) exportCard.classList.remove('hidden');
      const pathCount = paths.reduce((sum, p) => sum + p.loops.length, 0);
      vectorStats.textContent = `${paths.length} colors · ${pathCount} shapes · fallback trace`;
      if (updateUi) setStatus(`Done. ${paths.length} color layer${paths.length === 1 ? '' : 's'} traced.`, 'success');
      return {
        svg: currentSvg,
        eps: currentEps,
        palette: currentPalette.map(c => ({...c})),
        colors: paths.length,
        shapes: pathCount
      };
    } catch (err) {
      console.error(err);
      currentSvg = currentEps = '';
      if (updateUi) setStatus(err.message || 'Vectorization failed.', 'error');
      throw err;
    } finally {
      vectorizeBtn.disabled = false;
    }
  }

  function nextFrame() { return new Promise(resolve => requestAnimationFrame(() => resolve())); }

  function loadFile(file, options = {}) {
    if (!file || !file.type.startsWith('image/')) {
      setStatus('Please choose a PNG, JPG or WebP image.', 'error');
      return Promise.reject(new Error('Unsupported image file.'));
    }
    const autoPalette = options.autoPalette !== false;
    const keepPalette = options.palette || null;
    const scroll = options.scroll !== false;

    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        URL.revokeObjectURL(url);
        sourceImage = img;
        sourceFileName = file.name || 'vector';
        originalWidth = img.naturalWidth; originalHeight = img.naturalHeight;
        const maxPreview = 820;
        const scale = Math.min(1, maxPreview / Math.max(originalWidth, originalHeight));
        renderImageWidth = Math.max(1, Math.round(originalWidth * scale));
        renderImageHeight = Math.max(1, Math.round(originalHeight * scale));
        sourceCanvas.width = renderImageWidth;
        sourceCanvas.height = renderImageHeight;
        sourceCtx.clearRect(0, 0, sourceCanvas.width, sourceCanvas.height);
        sourceCtx.drawImage(img, 0, 0, sourceCanvas.width, sourceCanvas.height);
        sourceCanvas.style.cursor = 'default';
        sourceEmpty.classList.add('hidden');
        vectorEmpty.classList.remove('hidden');
        vectorPreview.innerHTML = '';
        exportCard.classList.add('hidden');
        vectorStats.textContent = 'Not traced yet';
        fileMeta.textContent = `${file.name} · ${originalWidth} × ${originalHeight}`;
        workspace.classList.remove('hidden');
        uploadCard.classList.add('hidden');
        currentSvg = currentEps = '';
        updatePaletteSize();

        if (keepPalette && keepPalette.length) {
          currentPalette = keepPalette.slice(0, Number(colorCount.value)).map(c => ({...c}));
          renderPalette(currentPalette);
        } else if (autoPalette || !currentPalette.length) {
          autoDetectPalette();
        }
        if (scroll) window.scrollTo({top: 0, behavior: 'smooth'});
        resolve(img);
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        const err = new Error('The image could not be loaded.');
        setStatus(err.message, 'error');
        reject(err);
      };
      img.src = url;
    });
  }

  function autoDetectPalette() {
    if (!sourceImage) return;
    try {
      const {imageData} = getVisibleSourceImageData();
      const n = Number(colorCount.value);
      const auto = kMeansPalette(imageData, n);
      if (preserveWhite.checked) {
        const white = {r:255,g:255,b:255,a:255};
        if (!auto.some(c => colorDistance(c, white) < 24) && n >= 2) auto[n-1] = white;
      }
      currentPalette = auto;
      renderPalette(currentPalette);
      setStatus('Palette updated from the image.');
    } catch (err) { setStatus('Could not detect palette.', 'error'); }
  }

  function renderBatchQueue() {
    const fileQueue = $('fileQueue');
    if (!batchItems.length) {
      fileQueue.classList.add('hidden');
      fileQueue.innerHTML = '';
      $('selectionNote').textContent = 'No images selected yet';
      batchCard.classList.add('hidden');
      batchSummary.textContent = '0 files';
      updateBatchButton();
      updateBatchDownloadButtons();
      return;
    }

    fileQueue.classList.remove('hidden');
    fileQueue.innerHTML = batchItems.map((item, index) => {
      const active = index === activeBatchIndex ? ' active' : '';
      const statusLabel = item.status === 'done' ? 'Done' : item.status === 'processing' ? 'Processing…' : item.status === 'error' ? 'Error' : 'Queued';
      return `<button type="button" class="queue-item${active}" data-index="${index}" title="${escapeHtml(item.file.name)}">
        <span class="queue-index">${index + 1}</span><span class="queue-name">${escapeHtml(item.file.name)}</span><span class="queue-status ${item.status}">${statusLabel}</span>
      </button>`;
    }).join('');
    fileQueue.querySelectorAll('.queue-item').forEach(btn => {
      btn.addEventListener('click', async () => {
        const index = Number(btn.dataset.index);
        if (batchRunning) return;
        await activateBatchItem(index);
      });
    });
    $('selectionNote').textContent = `${batchItems.length} image${batchItems.length === 1 ? '' : 's'} selected`;
    batchSummary.textContent = `${batchItems.length} file${batchItems.length === 1 ? '' : 's'}`;
    batchCard.classList.toggle('hidden', batchItems.length < 1);
    renderBatchResults();
    updateBatchButton();
    updateBatchDownloadButtons();
  }

  function updateBatchDownloadButtons() {
    const done = batchItems.filter(item => item.status === 'done');
    const svgReady = done.filter(item => item.svg);
    const epsReady = done.filter(item => item.eps);
    const allReady = done.filter(item => item.svg || item.eps);
    downloadAllSvgBtn.disabled = batchRunning || svgReady.length === 0;
    downloadAllEpsBtn.disabled = batchRunning || epsReady.length === 0;
    downloadAllVectorsBtn.disabled = batchRunning || allReady.length === 0;
    downloadAllSvgBtn.textContent = svgReady.length ? `Download All SVG (${svgReady.length})` : 'Download All SVG';
    downloadAllEpsBtn.textContent = epsReady.length ? `Download All EPS (${epsReady.length})` : 'Download All EPS';
    downloadAllVectorsBtn.textContent = allReady.length ? `Download All (${allReady.length})` : 'Download All';
  }

  function renderBatchResults() {
    if (!batchItems.length) {
      batchResults.innerHTML = '';
      batchCard.classList.add('hidden');
      return;
    }
    batchCard.classList.remove('hidden');
    batchResults.innerHTML = batchItems.map((item, index) => {
      const active = index === activeBatchIndex ? ' active' : '';
      const statusLabel = item.status === 'done' ? 'Completed' : item.status === 'processing' ? 'Processing…' : item.status === 'error' ? 'Failed' : 'Waiting';
      const actions = item.status === 'done' ? `<div class="batch-actions">
        <button type="button" class="secondary mini-download" data-index="${index}" data-format="svg">SVG</button>
        <button type="button" class="primary mini-download" data-index="${index}" data-format="eps">EPS</button>
      </div>` : '';
      return `<div class="batch-result${active}">
        <div class="batch-result-main" data-index="${index}">
          <span class="queue-index">${index + 1}</span>
          <div class="batch-file-copy"><strong>${escapeHtml(item.file.name)}</strong><span>${statusLabel}${item.shapes ? ` · ${item.colors} colors · ${item.shapes} shapes` : ''}${item.error ? ` · ${escapeHtml(item.error)}` : ''}</span></div>
        </div>${actions}
      </div>`;
    }).join('');
    batchResults.querySelectorAll('.batch-result-main').forEach(el => {
      el.addEventListener('click', async () => {
        if (batchRunning) return;
        await activateBatchItem(Number(el.dataset.index));
      });
    });
    batchResults.querySelectorAll('.mini-download').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const item = batchItems[Number(btn.dataset.index)];
        if (!item) return;
        const format = btn.dataset.format;
        if (format === 'svg' && item.svg) downloadBlob(item.svg, 'image/svg+xml;charset=utf-8', `${baseName(item.file.name)}_vector.svg`);
        if (format === 'eps' && item.eps) downloadBlob(item.eps, 'application/postscript', `${baseName(item.file.name)}_vector.eps`);
      });
    });
  }

  function escapeHtml(value) {
    return String(value || '').replace(/[&<>'"]/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[ch]));
  }

  function updateBatchButton() {
    const total = batchItems.length;
    if (batchRunning) {
      vectorizeAllBtn.textContent = 'Vectorizing…';
      vectorizeAllBtn.disabled = true;
      return;
    }
    vectorizeAllBtn.textContent = total > 1 ? `Vectorize All (${total})` : 'Vectorize All';
    vectorizeAllBtn.disabled = total === 0;
  }

  function updateBatchProgress(completed, total) {
    if (!total) {
      batchProgress.classList.add('hidden');
      return;
    }
    batchProgress.classList.remove('hidden');
    const percent = Math.round((completed / total) * 100);
    batchProgressText.textContent = `${completed} / ${total}`;
    batchProgressPercent.textContent = `${percent}%`;
    batchProgressFill.style.width = `${percent}%`;
  }

  async function activateBatchItem(index) {
    if (!batchItems[index]) return;
    activeBatchIndex = index;
    renderBatchQueue();
    const item = batchItems[index];
    try {
      await loadFile(item.file, {
        autoPalette: paletteMode === 'auto',
        palette: paletteMode === 'manual' ? currentPalette : (item.palette || null),
        scroll: false
      });
      if (item.svg && item.eps) {
        currentSvg = item.svg;
        currentEps = item.eps;
        parseSvgForPreview(currentSvg);
        vectorEmpty.classList.add('hidden');
        exportCard.classList.remove('hidden');
        vectorStats.textContent = `${item.colors || ''}${item.colors ? ' colors · ' : ''}${item.shapes || 0} shapes`;
        setStatus('Completed vector loaded.');
      } else if (item.status === 'error') {
        setStatus(item.error || 'This file failed during vectorization.', 'error');
      } else {
        setStatus('Image loaded. Ready to vectorize.');
      }
    } catch (err) {
      setStatus(err.message || 'Could not load this image.', 'error');
    }
  }

  async function processBatch() {
    if (!batchItems.length || batchRunning) return;
    batchRunning = true;
    vectorizeBtn.disabled = true;
    exportCard.classList.add('hidden');
    updateBatchProgress(0, batchItems.length);
    setStatus(`Starting batch of ${batchItems.length} images…`);
    updateBatchButton();

    let completed = 0;
    for (let i = 0; i < batchItems.length; i++) {
      const item = batchItems[i];
      activeBatchIndex = i;
      item.status = 'processing';
      item.error = '';
      renderBatchQueue();
      setStatus(`Vectorizing ${i + 1} of ${batchItems.length}: ${item.file.name}`);
      try {
        await loadFile(item.file, {
          autoPalette: paletteMode === 'auto',
          palette: paletteMode === 'manual' ? currentPalette : null,
          scroll: false
        });
        const result = await vectorize({ updateUi: false });
        item.svg = result.svg;
        item.eps = result.eps;
        item.palette = result.palette;
        item.colors = result.colors;
        item.shapes = result.shapes;
        item.status = 'done';
        completed++;
        if (i < batchItems.length - 1) await nextFrame();
      } catch (err) {
        item.status = 'error';
        item.error = err.message || 'Vectorization failed.';
      }
      updateBatchProgress(completed, batchItems.length);
      renderBatchQueue();
    }

    batchRunning = false;
    vectorizeBtn.disabled = false;
    updateBatchButton();
    updateBatchDownloadButtons();
    await activateBatchItem(activeBatchIndex);
    const failed = batchItems.filter(item => item.status === 'error').length;
    if (failed) {
      setStatus(`Batch finished: ${completed} completed, ${failed} failed.`, failed === batchItems.length ? 'error' : '');
    } else {
      setStatus(`Batch finished: all ${completed} images were vectorized.`, 'success');
    }
  }

  function downloadBlob(content, mime, filename) {
    const blob = new Blob([content], {type: mime});
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  // Dependency-free ZIP writer for batch downloads. It uses ZIP "store"
  // (no compression), so this remains fully client-side and GitHub Pages-ready.
  const zipEncoder = new TextEncoder();
  function zipU16(n) { return new Uint8Array([n & 255, (n >>> 8) & 255]); }
  function zipU32(n) { return new Uint8Array([n & 255, (n >>> 8) & 255, (n >>> 16) & 255, (n >>> 24) & 255]); }
  function zipConcat(parts) {
    const total = parts.reduce((sum, part) => sum + part.length, 0);
    const out = new Uint8Array(total);
    let offset = 0;
    for (const part of parts) { out.set(part, offset); offset += part.length; }
    return out;
  }
  function zipCrc32(bytes) {
    let crc = 0xffffffff;
    for (let i = 0; i < bytes.length; i++) {
      crc ^= bytes[i];
      for (let j = 0; j < 8; j++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
    return (crc ^ 0xffffffff) >>> 0;
  }
  function zipDosStamp(date = new Date()) {
    const year = Math.max(1980, date.getFullYear());
    return {
      time: ((date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2)) & 0xffff,
      date: (date.getDate() | ((date.getMonth() + 1) << 5) | ((year - 1980) << 9)) & 0xffff
    };
  }
  function makeZip(entries) {
    const stamp = zipDosStamp();
    const localChunks = [];
    const centralChunks = [];
    let offset = 0;
    for (const entry of entries) {
      const name = zipEncoder.encode(entry.name.replace(/\\/g, '/'));
      const data = typeof entry.data === 'string' ? zipEncoder.encode(entry.data) : entry.data;
      const crc = zipCrc32(data);
      const local = zipConcat([
        zipU32(0x04034b50), zipU16(20), zipU16(0x0800), zipU16(0), zipU16(stamp.time), zipU16(stamp.date),
        zipU32(crc), zipU32(data.length), zipU32(data.length), zipU16(name.length), zipU16(0), name
      ]);
      localChunks.push(local, data);
      centralChunks.push(zipConcat([
        zipU32(0x02014b50), zipU16(20), zipU16(20), zipU16(0x0800), zipU16(0), zipU16(stamp.time), zipU16(stamp.date),
        zipU32(crc), zipU32(data.length), zipU32(data.length), zipU16(name.length), zipU16(0), zipU16(0), zipU16(0), zipU16(0),
        zipU32(0), zipU32(offset), name
      ]));
      offset += local.length + data.length;
    }
    const central = zipConcat(centralChunks);
    const end = zipConcat([
      zipU32(0x06054b50), zipU16(0), zipU16(0), zipU16(entries.length), zipU16(entries.length),
      zipU32(central.length), zipU32(offset), zipU16(0)
    ]);
    return zipConcat([...localChunks, central, end]);
  }
  function downloadZip(entries, filename) {
    if (!entries.length) return;
    downloadBlob(makeZip(entries), 'application/zip', filename);
  }
  function completedItems() { return batchItems.filter(item => item.status === 'done'); }
  function downloadAllSvg() {
    const items = completedItems().filter(item => item.svg);
    if (!items.length) return;
    downloadZip(items.map((item, index) => ({
      name: `${String(index + 1).padStart(3, '0')}_${baseName(item.file.name)}_vector.svg`, data: item.svg
    })), 'FlatColor_Vectorizer_All_SVG.zip');
    setStatus(`Downloaded ${items.length} SVG files as a ZIP.`, 'success');
  }
  function downloadAllEps() {
    const items = completedItems().filter(item => item.eps);
    if (!items.length) return;
    downloadZip(items.map((item, index) => ({
      name: `${String(index + 1).padStart(3, '0')}_${baseName(item.file.name)}_vector.eps`, data: item.eps
    })), 'FlatColor_Vectorizer_All_EPS.zip');
    setStatus(`Downloaded ${items.length} EPS files as a ZIP.`, 'success');
  }
  function downloadAllVectors() {
    const items = completedItems();
    const entries = [];
    items.forEach((item, index) => {
      const prefix = `${String(index + 1).padStart(3, '0')}_${baseName(item.file.name)}_vector`;
      if (item.svg) entries.push({name: `${prefix}.svg`, data: item.svg});
      if (item.eps) entries.push({name: `${prefix}.eps`, data: item.eps});
    });
    if (!entries.length) return;
    downloadZip(entries, 'FlatColor_Vectorizer_All_Vectors.zip');
    setStatus(`Downloaded ${items.length} vector results as a ZIP.`, 'success');
  }

  function resetApp() {
    fileInput.value = '';
    batchItems = [];
    activeBatchIndex = -1;
    batchRunning = false;
    sourceImage = null;
    currentSvg = currentEps = '';
    workspace.classList.add('hidden');
    uploadCard.classList.remove('hidden');
    exportCard.classList.add('hidden');
    vectorPreview.innerHTML = '';
    sourceEmpty.classList.remove('hidden');
    vectorEmpty.classList.remove('hidden');
    pickModeIndex = -1;
    sourceCanvas.style.cursor = 'default';
    updateBatchProgress(0, 0);
    renderBatchQueue();
    setStatus('Ready.');
    window.scrollTo({top: 0, behavior: 'smooth'});
  }

  function handleSelectedFiles(fileList) {
    const files = Array.from(fileList || []).filter(file => file && file.type.startsWith('image/'));
    if (!files.length) {
      setStatus('Please choose PNG, JPG or WebP images.', 'error');
      return;
    }
    const existing = new Set(batchItems.map(item => `${item.file.name}__${item.file.size}__${item.file.lastModified}`));
    for (const file of files) {
      const key = `${file.name}__${file.size}__${file.lastModified}`;
      if (existing.has(key)) continue;
      existing.add(key);
      batchItems.push({file, status: 'queued', svg: '', eps: '', palette: null, colors: 0, shapes: 0, error: ''});
    }
    if (activeBatchIndex < 0) activeBatchIndex = 0;
    renderBatchQueue();
    activateBatchItem(activeBatchIndex);
  }

  // Events
  browseBtn.addEventListener('click', (e) => { e.stopPropagation(); fileInput.click(); });
  dropzone.addEventListener('click', (e) => {
    if (e.target.closest('button') || e.target.closest('.queue-item')) return;
    if (e.target === dropzone || e.target.closest('.dropzone') === dropzone) fileInput.click();
  });
  dropzone.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileInput.click(); } });
  fileInput.addEventListener('change', () => handleSelectedFiles(fileInput.files));
  ['dragenter', 'dragover'].forEach(ev => dropzone.addEventListener(ev, (e) => { e.preventDefault(); dropzone.classList.add('dragover'); }));
  ['dragleave', 'drop'].forEach(ev => dropzone.addEventListener(ev, (e) => { e.preventDefault(); dropzone.classList.remove('dragover'); }));
  dropzone.addEventListener('drop', (e) => handleSelectedFiles(e.dataTransfer.files));
  newImageBtn.addEventListener('click', resetApp);
  colorCount.addEventListener('change', () => { updatePaletteSize(); if (sourceImage) autoDetectPalette(); });
  autoPaletteBtn.addEventListener('click', autoDetectPalette);
  smoothing.addEventListener('input', () => smoothingValue.textContent = smoothing.value);
  noise.addEventListener('input', () => noiseValue.textContent = `${noise.value} px`);
  vectorizeBtn.addEventListener('click', () => vectorize().catch(() => {}));
  vectorizeAllBtn.addEventListener('click', processBatch);

  document.querySelectorAll('.mode').forEach(btn => btn.addEventListener('click', () => {
    document.querySelectorAll('.mode').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    paletteMode = btn.dataset.mode;
    setStatus(paletteMode === 'auto' ? 'Auto palette enabled. Each image will get its own detected palette.' : 'Selected colors will be used for every image in the batch.');
  }));

  sourceCanvas.addEventListener('click', (e) => {
    if (pickModeIndex < 0 || !sourceImage) return;
    const rect = sourceCanvas.getBoundingClientRect();
    const x = clamp(Math.floor((e.clientX - rect.left) * sourceCanvas.width / rect.width), 0, sourceCanvas.width - 1);
    const y = clamp(Math.floor((e.clientY - rect.top) * sourceCanvas.height / rect.height), 0, sourceCanvas.height - 1);
    const p = sourceCtx.getImageData(x, y, 1, 1).data;
    currentPalette[pickModeIndex] = {r:p[0], g:p[1], b:p[2], a:255};
    renderPalette(currentPalette);
    const picked = pickModeIndex + 1;
    pickModeIndex = -1;
    sourceCanvas.style.cursor = 'default';
    setStatus(`Sampled ${rgbToHex(currentPalette[picked - 1])} into Color ${picked}.`);
  });

  preserveWhite.addEventListener('change', () => {
    if (sourceImage && preserveWhite.checked) autoDetectPalette();
  });

  downloadSvgBtn.addEventListener('click', () => {
    if (!currentSvg) return;
    downloadBlob(currentSvg, 'image/svg+xml;charset=utf-8', `${baseName(sourceFileName)}_vector.svg`);
  });
  downloadEpsBtn.addEventListener('click', () => {
    if (!currentEps) return;
    downloadBlob(currentEps, 'application/postscript', `${baseName(sourceFileName)}_vector.eps`);
  });
  downloadAllSvgBtn.addEventListener('click', downloadAllSvg);
  downloadAllEpsBtn.addEventListener('click', downloadAllEps);
  downloadAllVectorsBtn.addEventListener('click', downloadAllVectors);

  updatePaletteSize();
  updateBatchDownloadButtons();
  smoothingValue.textContent = smoothing.value;
  noiseValue.textContent = `${noise.value} px`;
})();
