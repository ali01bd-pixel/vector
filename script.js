/* FlatColor Vectorizer - self-contained browser implementation.
   No server is needed. Works as a static GitHub Pages site. */

(() => {
  'use strict';

  const MAX_TRACE_DIM = 1100;
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

  async function vectorize() {
    if (!sourceImage) { setStatus('Please choose an image first.', 'error'); return; }
    vectorizeBtn.disabled = true;
    exportCard.classList.add('hidden');
    setStatus('Preparing image…');
    await nextFrame();
    try {
      const {imageData} = getVisibleSourceImageData();
      const n = Number(colorCount.value);
      const palette = getPaletteForVector(imageData, n);
      currentPalette = palette.map(c => ({...c}));
      if (paletteMode === 'auto') renderPalette(currentPalette);
      setStatus('Reducing colors and tracing edges…');
      await nextFrame();

      const indexed = buildIndexedRaster(imageData, palette);
      const pixelArea = indexed.width * indexed.height;
      const noisePx = Number(noise.value);
      const smoothPx = Number(smoothing.value) * 0.65;
      const minArea = Math.max(noisePx * noisePx, pixelArea * MIN_AREA_FACTOR);
      const paths = tracePalette(indexed, palette, smoothPx, minArea);
      const outW = fitCanvas.checked ? originalWidth : renderImageWidth;
      const outH = fitCanvas.checked ? originalHeight : renderImageHeight;
      currentSvg = createSvg(paths, indexed.width, indexed.height, outW, outH);
      currentEps = createEps(paths, indexed.width, indexed.height, outW, outH);

      parseSvgForPreview(currentSvg);
      vectorEmpty.classList.add('hidden');
      exportCard.classList.remove('hidden');
      const pathCount = paths.reduce((sum, p) => sum + p.loops.length, 0);
      vectorStats.textContent = `${paths.length} colors · ${pathCount} shapes`;
      setStatus(`Done. ${paths.length} color layer${paths.length === 1 ? '' : 's'} traced.`, 'success');
    } catch (err) {
      console.error(err);
      currentSvg = currentEps = '';
      setStatus(err.message || 'Vectorization failed.', 'error');
    } finally {
      vectorizeBtn.disabled = false;
    }
  }

  function nextFrame() { return new Promise(resolve => requestAnimationFrame(() => resolve())); }

  function loadFile(file) {
    if (!file || !file.type.startsWith('image/')) { setStatus('Please choose a PNG, JPG or WebP image.', 'error'); return; }
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      sourceImage = img;
      sourceFileName = file.name || 'vector';
      originalWidth = img.naturalWidth; originalHeight = img.naturalHeight;
      const maxPreview = 820;
      const scale = Math.min(1, maxPreview / Math.max(originalWidth, originalHeight));
      sourceCanvas.width = Math.max(1, Math.round(originalWidth * scale));
      sourceCanvas.height = Math.max(1, Math.round(originalHeight * scale));
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
      autoDetectPalette();
      setStatus('Image loaded. Pick exact colors or use the auto palette.');
      window.scrollTo({top: 0, behavior: 'smooth'});
    };
    img.onerror = () => { URL.revokeObjectURL(url); setStatus('The image could not be loaded.', 'error'); };
    img.src = url;
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

  function downloadBlob(content, mime, filename) {
    const blob = new Blob([content], {type: mime});
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = filename; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function resetApp() {
    fileInput.value = '';
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
    setStatus('Ready.');
    window.scrollTo({top: 0, behavior: 'smooth'});
  }

  // Events
  browseBtn.addEventListener('click', () => fileInput.click());
  dropzone.addEventListener('click', (e) => {
    if (e.target.closest('button')) return;
    if (e.target === dropzone || e.target.closest('.dropzone') === dropzone) fileInput.click();
  });
  dropzone.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileInput.click(); } });
  fileInput.addEventListener('change', () => loadFile(fileInput.files[0]));
  ['dragenter', 'dragover'].forEach(ev => dropzone.addEventListener(ev, (e) => { e.preventDefault(); dropzone.classList.add('dragover'); }));
  ['dragleave', 'drop'].forEach(ev => dropzone.addEventListener(ev, (e) => { e.preventDefault(); dropzone.classList.remove('dragover'); }));
  dropzone.addEventListener('drop', (e) => loadFile(e.dataTransfer.files[0]));
  newImageBtn.addEventListener('click', resetApp);
  colorCount.addEventListener('change', () => { updatePaletteSize(); if (sourceImage) autoDetectPalette(); });
  autoPaletteBtn.addEventListener('click', autoDetectPalette);
  smoothing.addEventListener('input', () => smoothingValue.textContent = smoothing.value);
  noise.addEventListener('input', () => noiseValue.textContent = `${noise.value} px`);
  vectorizeBtn.addEventListener('click', vectorize);

  document.querySelectorAll('.mode').forEach(btn => btn.addEventListener('click', () => {
    document.querySelectorAll('.mode').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    paletteMode = btn.dataset.mode;
    setStatus(paletteMode === 'auto' ? 'Auto palette enabled.' : 'Selected colors will be used.');
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

  updatePaletteSize();
  smoothingValue.textContent = smoothing.value;
  noiseValue.textContent = `${noise.value} px`;
})();
