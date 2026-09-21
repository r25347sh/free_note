(() => {
  "use strict";

  // ========== Constants ==========
  const MAX_SIZE = 1024;
  const MIN_SIZE = 1;
  const DEFAULT_W = 16;
  const DEFAULT_H = 16;
  const DEFAULT_PIXEL_SIZE = 20;
  const MAX_HISTORY = 40;
  const TRANSPARENT = null;

  // Overlay colors for parts (cycled)
  const PART_COLORS = [
    "#ff6b6b", "#4ecdc4", "#ffe66d", "#95e1d3",
    "#f38181", "#aa96da", "#fcbad3", "#a8d8ea",
    "#ff9a3c", "#6bcb77", "#4d96ff", "#ff6bcb",
  ];

  const PALETTE = [
    null,
    "#000000", "#ffffff", "#7f7f7f", "#c3c3c3",
    "#880015", "#b97a57", "#ed1c24", "#ffaec9",
    "#ff7f27", "#ffc90e", "#fff200", "#22b14c",
    "#b5e61d", "#00a2e8", "#99d9ea", "#3f48cc",
    "#7092be", "#a349a4", "#c8bfe7",
    "#1a1c2c", "#5d275d", "#b13e53", "#ef7d57",
    "#ffcd75", "#a7f070", "#38b764", "#257179",
    "#29366f", "#3b5dc9", "#41a6f6", "#73eff7",
    "#f4f4f4", "#94b0c2", "#566c86", "#333c57",
  ];

  // ========== State ==========
  // pixels[y][x] = { c: color|null, p: partId|null }
  let width = DEFAULT_W;
  let height = DEFAULT_H;
  let pixels = createEmptyGrid(width, height);
  let currentColor = "#000000";
  let tool = "pencil";
  let pixelSize = DEFAULT_PIXEL_SIZE;
  let showGrid = true;
  let showPartOverlay = false;
  let isDrawing = false;
  let lastPos = null;
  let history = [];
  let historyIndex = -1;
  let recentColors = ["#000000", "#ffffff", "#ed1c24", "#22b14c", "#00a2e8"];
  let parts = [];
  let activePartId = "";
  let partIdCounter = 0;

  let importImage = null;
  let importNaturalW = 0;
  let importNaturalH = 0;
  let importAspect = 1;
  let importLockUpdating = false;

  const canvas = document.getElementById("pixelCanvas");
  const ctx = canvas.getContext("2d");
  const gridCanvas = document.getElementById("gridOverlay");
  const gridCtx = gridCanvas.getContext("2d");
  const canvasContainer = document.getElementById("canvasContainer");

  const elW = document.getElementById("gridW");
  const elH = document.getElementById("gridH");
  const elPixelSize = document.getElementById("pixelSize");
  const elColor = document.getElementById("colorPicker");
  const elShowGrid = document.getElementById("showGrid");
  const elShowPartOverlay = document.getElementById("showPartOverlay");
  const elStatus = document.getElementById("statusText");
  const elCoord = document.getElementById("coordText");
  const elPalette = document.getElementById("palette");
  const elRecent = document.getElementById("recentColors");
  const elExportFormat = document.getElementById("exportFormat");
  const elSvgOptions = document.getElementById("svgOptions");
  const elSvgRootId = document.getElementById("svgRootId");
  const elSvgIdPrefix = document.getElementById("svgIdPrefix");
  const elSvgGroupByPart = document.getElementById("svgGroupByPart");
  const elSvgScale = document.getElementById("svgScale");
  const elFilename = document.getElementById("filename");
  const elBgColor = document.getElementById("bgColor");
  const elUseBg = document.getElementById("useBg");
  const elColorCountHint = document.getElementById("colorCountHint");
  const elPartNameInput = document.getElementById("partNameInput");
  const elPartList = document.getElementById("partList");
  const elActivePart = document.getElementById("activePart");
  const elImportFile = document.getElementById("importFile");
  const elImportW = document.getElementById("importW");
  const elImportH = document.getElementById("importH");
  const elImportLock = document.getElementById("importLockRatio");
  const elImportHint = document.getElementById("importHint");
  const elBtnImport = document.getElementById("btnImport");
  const elQuantizeN = document.getElementById("quantizeN");
  const elCustomPaletteText = document.getElementById("customPaletteText");

  function cell(c, p) {
    return { c: c === undefined ? TRANSPARENT : c, p: p === undefined ? null : p };
  }

  function createEmptyGrid(w, h) {
    const g = new Array(h);
    for (let y = 0; y < h; y++) {
      g[y] = new Array(w);
      for (let x = 0; x < w; x++) g[y][x] = cell(TRANSPARENT, null);
    }
    return g;
  }

  function cloneGrid(src) {
    return src.map((row) => row.map((px) => ({ c: px.c, p: px.p })));
  }

  function setStatus(msg) {
    elStatus.textContent = msg;
  }

  function clamp(v, min, max) {
    return Math.max(min, Math.min(max, v));
  }

  function hexNormalize(c) {
    if (!c || c === "transparent") return TRANSPARENT;
    c = String(c).toLowerCase().trim();
    if (c.startsWith("#") && c.length === 4) {
      return "#" + c[1] + c[1] + c[2] + c[2] + c[3] + c[3];
    }
    if (/^#[0-9a-f]{6}$/.test(c)) return c;
    return c;
  }

  function colorEqual(a, b) {
    return a === b;
  }

  function rgbDist(c1, c2) {
    const r1 = parseInt(c1.slice(1, 3), 16);
    const g1 = parseInt(c1.slice(3, 5), 16);
    const b1 = parseInt(c1.slice(5, 7), 16);
    const r2 = parseInt(c2.slice(1, 3), 16);
    const g2 = parseInt(c2.slice(3, 5), 16);
    const b2 = parseInt(c2.slice(5, 7), 16);
    const dr = r1 - r2, dg = g1 - g2, db = b1 - b2;
    return dr * dr + dg * dg + db * db;
  }

  function nearestColor(hex, palette) {
    let best = palette[0];
    let bestD = Infinity;
    for (let i = 0; i < palette.length; i++) {
      const d = rgbDist(hex, palette[i]);
      if (d < bestD) { bestD = d; best = palette[i]; }
    }
    return best;
  }

  function countUniqueColors() {
    const set = new Set();
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (pixels[y][x].c) set.add(pixels[y][x].c);
      }
    }
    return set.size;
  }

  function updateColorCount() {
    elColorCountHint.textContent = "使用色数: " + countUniqueColors();
  }

  function sanitizeId(name) {
    return String(name)
      .trim()
      .replace(/\s+/g, "-")
      .replace(/[^a-zA-Z0-9_\-\u3040-\u30ff\u3400-\u9fff]/g, "")
      .replace(/^-+/, "") || "part";
  }

  function pushHistory() {
    if (historyIndex < history.length - 1) {
      history = history.slice(0, historyIndex + 1);
    }
    history.push(cloneGrid(pixels));
    if (history.length > MAX_HISTORY) history.shift();
    historyIndex = history.length - 1;
    updateUndoRedoButtons();
  }

  function undo() {
    if (historyIndex <= 0) return;
    historyIndex--;
    pixels = cloneGrid(history[historyIndex]);
    render();
    updateUndoRedoButtons();
    updateColorCount();
    setStatus("元に戻しました");
  }

  function redo() {
    if (historyIndex >= history.length - 1) return;
    historyIndex++;
    pixels = cloneGrid(history[historyIndex]);
    render();
    updateUndoRedoButtons();
    updateColorCount();
    setStatus("やり直しました");
  }

  function updateUndoRedoButtons() {
    document.getElementById("btnUndo").disabled = historyIndex <= 0;
    document.getElementById("btnRedo").disabled = historyIndex >= history.length - 1;
  }

  function resizeGrid(newW, newH) {
    newW = clamp(Math.floor(newW), MIN_SIZE, MAX_SIZE);
    newH = clamp(Math.floor(newH), MIN_SIZE, MAX_SIZE);
    if (newW === width && newH === height) return;
    const next = createEmptyGrid(newW, newH);
    const copyW = Math.min(width, newW);
    const copyH = Math.min(height, newH);
    for (let y = 0; y < copyH; y++) {
      for (let x = 0; x < copyW; x++) {
        next[y][x] = { c: pixels[y][x].c, p: pixels[y][x].p };
      }
    }
    width = newW; height = newH; pixels = next;
    elW.value = width; elH.value = height;
    pushHistory(); resizeCanvases(); render(); updateColorCount();
    setStatus(`サイズを ${width}×${height} に変更しました`);
    saveLocal();
  }

  function resizeCanvases() {
    const w = width * pixelSize;
    const h = height * pixelSize;
    canvas.width = w; canvas.height = h;
    gridCanvas.width = w; gridCanvas.height = h;
    canvasContainer.style.width = w + "px";
    canvasContainer.style.height = h + "px";
    ctx.imageSmoothingEnabled = false;
    gridCtx.imageSmoothingEnabled = false;
  }

  function render() {
    const w = canvas.width, h = canvas.height;
    ctx.clearRect(0, 0, w, h);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const px = pixels[y][x];
        if (px.c) {
          ctx.fillStyle = px.c;
          ctx.fillRect(x * pixelSize, y * pixelSize, pixelSize, pixelSize);
        }
      }
    }
    if (showPartOverlay && parts.length) {
      const partColorMap = {};
      parts.forEach((pt, i) => { partColorMap[pt.id] = PART_COLORS[i % PART_COLORS.length]; });
      ctx.globalAlpha = 0.35;
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const pid = pixels[y][x].p;
          if (pid && partColorMap[pid]) {
            ctx.fillStyle = partColorMap[pid];
            ctx.fillRect(x * pixelSize, y * pixelSize, pixelSize, pixelSize);
          }
        }
      }
      ctx.globalAlpha = 1;
    }
    gridCtx.clearRect(0, 0, w, h);
    if (showGrid && pixelSize >= 3) {
      gridCtx.strokeStyle = "rgba(255,255,255,0.12)";
      gridCtx.lineWidth = 1;
      for (let x = 0; x <= width; x++) {
        const px = x * pixelSize + 0.5;
        gridCtx.beginPath(); gridCtx.moveTo(px, 0); gridCtx.lineTo(px, h); gridCtx.stroke();
      }
      for (let y = 0; y <= height; y++) {
        const py = y * pixelSize + 0.5;
        gridCtx.beginPath(); gridCtx.moveTo(0, py); gridCtx.lineTo(w, py); gridCtx.stroke();
      }
    }
  }

  function canvasToGrid(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const x = Math.floor(((clientX - rect.left) * scaleX) / pixelSize);
    const y = Math.floor(((clientY - rect.top) * scaleY) / pixelSize);
    if (x < 0 || y < 0 || x >= width || y >= height) return null;
    return { x, y };
  }

  function setPixel(x, y, color, partId) {
    if (x < 0 || y < 0 || x >= width || y >= height) return false;
    const cur = pixels[y][x];
    const newP = partId !== undefined ? partId : cur.p;
    if (colorEqual(cur.c, color) && cur.p === newP) return false;
    pixels[y][x] = cell(color, newP);
    return true;
  }

  function drawLine(x0, y0, x1, y1, fn) {
    let changed = false;
    let dx = Math.abs(x1 - x0), dy = Math.abs(y1 - y0);
    let sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
    let err = dx - dy, x = x0, y = y0;
    while (true) {
      if (fn(x, y)) changed = true;
      if (x === x1 && y === y1) break;
      const e2 = 2 * err;
      if (e2 > -dy) { err -= dy; x += sx; }
      if (e2 < dx) { err += dx; y += sy; }
    }
    return changed;
  }

  function floodFill(sx, sy, targetColor, fillColor, partId) {
    if (colorEqual(targetColor, fillColor) && partId === undefined) return false;
    if (!colorEqual(pixels[sy][sx].c, targetColor)) return false;
    const stack = [[sx, sy]];
    let changed = false;
    const visited = new Set();
    while (stack.length) {
      const [x, y] = stack.pop();
      const key = x + "," + y;
      if (visited.has(key)) continue;
      if (x < 0 || y < 0 || x >= width || y >= height) continue;
      if (!colorEqual(pixels[y][x].c, targetColor)) continue;
      visited.add(key);
      const newP = partId !== undefined ? partId : pixels[y][x].p;
      pixels[y][x] = cell(fillColor, newP);
      changed = true;
      stack.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]);
    }
    return changed;
  }

  function floodAssignPart(sx, sy, partId) {
    const targetColor = pixels[sy][sx].c;
    const stack = [[sx, sy]];
    let changed = false;
    const visited = new Set();
    while (stack.length) {
      const [x, y] = stack.pop();
      const key = x + "," + y;
      if (visited.has(key)) continue;
      if (x < 0 || y < 0 || x >= width || y >= height) continue;
      if (!colorEqual(pixels[y][x].c, targetColor)) continue;
      if (pixels[y][x].p === partId) {
        visited.add(key);
        stack.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]);
        continue;
      }
      visited.add(key);
      pixels[y][x] = cell(pixels[y][x].c, partId);
      changed = true;
      stack.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]);
    }
    return changed;
  }

  function applyTool(pos, isStart) {
    if (!pos) return;
    const { x, y } = pos;
    let changed = false;
    const partForDraw = activePartId || null;

    if (tool === "pencil") {
      const paint = (px, py) => setPixel(px, py, currentColor, partForDraw);
      if (lastPos && !isStart) changed = drawLine(lastPos.x, lastPos.y, x, y, paint);
      else changed = paint(x, y);
      addRecent(currentColor);
    } else if (tool === "eraser") {
      const erase = (px, py) => setPixel(px, py, TRANSPARENT, null);
      if (lastPos && !isStart) changed = drawLine(lastPos.x, lastPos.y, x, y, erase);
      else changed = erase(x, y);
    } else if (tool === "fill" && isStart) {
      changed = floodFill(x, y, pixels[y][x].c, currentColor, partForDraw);
      if (changed) addRecent(currentColor);
    } else if (tool === "eyedropper" && isStart) {
      const c = pixels[y][x].c;
      if (c) {
        currentColor = c; elColor.value = c; updatePaletteActive();
        setStatus("色を取得: " + c);
      } else {
        currentColor = TRANSPARENT; updatePaletteActive(); setStatus("透明を取得");
      }
      if (pixels[y][x].p) {
        activePartId = pixels[y][x].p;
        elActivePart.value = activePartId;
        renderPartList();
      }
      setTool("pencil");
      return;
    } else if (tool === "part" && isStart) {
      if (!activePartId) {
        setStatus("先に部位を選択または追加してください");
        return;
      }
      changed = floodAssignPart(x, y, activePartId);
      if (changed) setStatus("部位「" + getPartName(activePartId) + "」を割り当てました");
    }

    if (changed) { render(); updateColorCount(); }
    lastPos = pos;
  }

  function onPointerDown(e) {
    e.preventDefault();
    canvas.setPointerCapture(e.pointerId);
    isDrawing = true; lastPos = null;
    const pos = canvasToGrid(e.clientX, e.clientY);
    if (tool === "fill" || tool === "eyedropper" || tool === "part") {
      applyTool(pos, true);
      if (tool === "fill" || tool === "part") { pushHistory(); saveLocal(); }
      isDrawing = false;
    } else {
      applyTool(pos, true);
    }
  }

  function onPointerMove(e) {
    const pos = canvasToGrid(e.clientX, e.clientY);
    if (pos) {
      const px = pixels[pos.y][pos.x];
      const partLabel = px.p ? " [" + getPartName(px.p) + "]" : "";
      elCoord.textContent = `(${pos.x}, ${pos.y})${partLabel}`;
    } else elCoord.textContent = "—";
    if (!isDrawing) return;
    e.preventDefault();
    applyTool(pos, false);
  }

  function onPointerUp() {
    if (!isDrawing) return;
    isDrawing = false; lastPos = null;
    if (tool === "pencil" || tool === "eraser") { pushHistory(); saveLocal(); }
  }

  canvas.addEventListener("pointerdown", onPointerDown);
  canvas.addEventListener("pointermove", onPointerMove);
  canvas.addEventListener("pointerup", onPointerUp);
  canvas.addEventListener("pointercancel", onPointerUp);
  canvas.addEventListener("pointerleave", () => { elCoord.textContent = "—"; });
  canvas.addEventListener("contextmenu", (e) => e.preventDefault());

  function setTool(name) {
    tool = name;
    document.querySelectorAll(".tool-btn").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.tool === name);
    });
    const cursors = { pencil: "crosshair", eraser: "cell", fill: "cell", eyedropper: "copy", part: "pointer" };
    canvas.style.cursor = cursors[name] || "crosshair";
  }

  document.querySelectorAll(".tool-btn").forEach((btn) => {
    btn.addEventListener("click", () => setTool(btn.dataset.tool));
  });

  function getPartName(id) {
    const pt = parts.find((p) => p.id === id);
    return pt ? pt.name : id;
  }

  function renderPartList() {
    elPartList.innerHTML = "";
    parts.forEach((pt, i) => {
      const li = document.createElement("li");
      if (pt.id === activePartId) li.classList.add("active");
      const sw = document.createElement("span");
      sw.className = "part-swatch";
      sw.style.background = PART_COLORS[i % PART_COLORS.length];
      const name = document.createElement("span");
      name.className = "part-name";
      name.textContent = pt.name;
      const del = document.createElement("button");
      del.type = "button"; del.className = "part-del"; del.textContent = "×"; del.title = "削除";
      del.addEventListener("click", (e) => { e.stopPropagation(); removePart(pt.id); });
      li.appendChild(sw); li.appendChild(name); li.appendChild(del);
      li.addEventListener("click", () => {
        activePartId = pt.id; elActivePart.value = pt.id; renderPartList();
        setStatus("部位「" + pt.name + "」を選択");
      });
      elPartList.appendChild(li);
    });
    const prev = elActivePart.value;
    elActivePart.innerHTML = '<option value="">（なし・未分類）</option>';
    parts.forEach((pt) => {
      const opt = document.createElement("option");
      opt.value = pt.id; opt.textContent = pt.name;
      elActivePart.appendChild(opt);
    });
    if (parts.some((p) => p.id === prev)) {
      elActivePart.value = prev; activePartId = prev;
    } else {
      elActivePart.value = activePartId || "";
    }
  }

  function addPart(name) {
    name = sanitizeId(name);
    if (!name) return;
    if (parts.some((p) => p.name === name || p.id === name)) {
      setStatus("同じ名前の部位が既にあります"); return;
    }
    partIdCounter++;
    const id = "part-" + partIdCounter + "-" + name;
    parts.push({ id, name });
    activePartId = id;
    renderPartList();
    elPartNameInput.value = "";
    setStatus("部位「" + name + "」を追加しました");
    saveLocal();
  }

  function removePart(id) {
    parts = parts.filter((p) => p.id !== id);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (pixels[y][x].p === id) pixels[y][x] = cell(pixels[y][x].c, null);
      }
    }
    if (activePartId === id) activePartId = "";
    renderPartList(); render(); pushHistory(); saveLocal();
    setStatus("部位を削除しました");
  }

  document.getElementById("btnAddPart").addEventListener("click", () => addPart(elPartNameInput.value));
  elPartNameInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); addPart(elPartNameInput.value); }
  });
  elActivePart.addEventListener("change", () => {
    activePartId = elActivePart.value; renderPartList();
  });
  elShowPartOverlay.addEventListener("change", () => {
    showPartOverlay = elShowPartOverlay.checked; render();
  });

  function addRecent(c) {
    if (!c) return;
    c = hexNormalize(c);
    recentColors = [c, ...recentColors.filter((x) => x !== c)].slice(0, 12);
    renderRecent();
  }

  function renderPalette() {
    elPalette.innerHTML = "";
    PALETTE.forEach((c) => {
      const sw = document.createElement("button");
      sw.type = "button";
      sw.className = "swatch" + (c === null ? " transparent" : "");
      if (c) sw.style.background = c;
      sw.title = c || "透明";
      sw.dataset.color = c === null ? "transparent" : c;
      if ((c === null && currentColor === null) || (c && c === currentColor)) sw.classList.add("active");
      sw.addEventListener("click", () => {
        currentColor = c;
        if (c) elColor.value = c;
        updatePaletteActive();
        if (tool === "eraser") setTool("pencil");
      });
      elPalette.appendChild(sw);
    });
  }

  function renderRecent() {
    elRecent.innerHTML = "";
    recentColors.forEach((c) => {
      const sw = document.createElement("button");
      sw.type = "button"; sw.className = "swatch"; sw.style.background = c; sw.title = c;
      sw.addEventListener("click", () => {
        currentColor = c; elColor.value = c; updatePaletteActive();
      });
      elRecent.appendChild(sw);
    });
  }

  function updatePaletteActive() {
    elPalette.querySelectorAll(".swatch").forEach((sw) => {
      const c = sw.dataset.color === "transparent" ? null : sw.dataset.color;
      sw.classList.toggle("active", colorEqual(c, currentColor));
    });
  }

  elColor.addEventListener("input", () => {
    currentColor = hexNormalize(elColor.value); updatePaletteActive();
  });

  function collectColorCounts() {
    const map = new Map();
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const c = pixels[y][x].c;
        if (!c) continue;
        map.set(c, (map.get(c) || 0) + 1);
      }
    }
    return map;
  }

  function quantizeToN(n) {
    n = clamp(Math.floor(n), 2, 64);
    const counts = collectColorCounts();
    if (counts.size <= n) {
      setStatus("既に " + counts.size + " 色以下です"); return false;
    }
    let colors = [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([c]) => c);
    if (colors.length > 256) colors = colors.slice(0, 256);
    let palette = colors.slice(0, n);
    for (let pass = 0; pass < 6; pass++) {
      const buckets = palette.map(() => ({ r: 0, g: 0, b: 0, n: 0 }));
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const c = pixels[y][x].c;
          if (!c) continue;
          let bi = 0, bd = Infinity;
          for (let i = 0; i < palette.length; i++) {
            const d = rgbDist(c, palette[i]);
            if (d < bd) { bd = d; bi = i; }
          }
          buckets[bi].r += parseInt(c.slice(1, 3), 16);
          buckets[bi].g += parseInt(c.slice(3, 5), 16);
          buckets[bi].b += parseInt(c.slice(5, 7), 16);
          buckets[bi].n++;
        }
      }
      for (let i = 0; i < palette.length; i++) {
        if (buckets[i].n === 0) continue;
        const r = Math.round(buckets[i].r / buckets[i].n);
        const g = Math.round(buckets[i].g / buckets[i].n);
        const b = Math.round(buckets[i].b / buckets[i].n);
        palette[i] = "#" + r.toString(16).padStart(2, "0") + g.toString(16).padStart(2, "0") + b.toString(16).padStart(2, "0");
      }
    }
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const c = pixels[y][x].c;
        if (!c) continue;
        pixels[y][x] = cell(nearestColor(c, palette), pixels[y][x].p);
      }
    }
    return true;
  }

  function mapToPalette(paletteColors) {
    const pal = paletteColors.map(hexNormalize).filter((c) => c && /^#[0-9a-f]{6}$/.test(c));
    if (pal.length === 0) { setStatus("有効な色がありません"); return false; }
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const c = pixels[y][x].c;
        if (!c) continue;
        pixels[y][x] = cell(nearestColor(c, pal), pixels[y][x].p);
      }
    }
    return true;
  }

  document.getElementById("btnQuantize").addEventListener("click", () => {
    const n = parseInt(elQuantizeN.value, 10) || 16;
    if (quantizeToN(n)) {
      pushHistory(); render(); updateColorCount(); saveLocal();
      setStatus("色数を約 " + n + " 色に削減しました（現在 " + countUniqueColors() + " 色）");
    }
  });

  document.getElementById("btnMapToPalette").addEventListener("click", () => {
    if (mapToPalette(PALETTE.filter((c) => c))) {
      pushHistory(); render(); updateColorCount(); saveLocal();
      setStatus("パレット色に揃えました（" + countUniqueColors() + " 色）");
    }
  });

  document.getElementById("btnMapToCustom").addEventListener("click", () => {
    const list = (elCustomPaletteText.value || "").split(/[,\s]+/).filter(Boolean);
    if (mapToPalette(list)) {
      pushHistory(); render(); updateColorCount(); saveLocal();
      setStatus("指定色に揃えました（" + countUniqueColors() + " 色）");
    }
  });

  elImportFile.addEventListener("change", () => {
    const file = elImportFile.files && elImportFile.files[0];
    if (!file) {
      importImage = null; elBtnImport.disabled = true;
      elImportHint.textContent = "画像を選ぶと元サイズが表示されます";
      return;
    }
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      importImage = img;
      importNaturalW = img.naturalWidth || img.width;
      importNaturalH = img.naturalHeight || img.height;
      importAspect = importNaturalW / Math.max(1, importNaturalH);
      elImportHint.textContent = `元画像: ${importNaturalW}×${importNaturalH}`;
      let sugW = Math.min(importNaturalW, 128);
      let sugH = Math.min(importNaturalH, 128);
      if (elImportLock.checked) sugH = Math.max(1, Math.round(sugW / importAspect));
      elImportW.value = sugW; elImportH.value = sugH;
      elBtnImport.disabled = false;
      URL.revokeObjectURL(url);
    };
    img.onerror = () => {
      setStatus("画像の読み込みに失敗しました");
      importImage = null; elBtnImport.disabled = true;
      URL.revokeObjectURL(url);
    };
    img.src = url;
  });

  function syncImportSize(changed) {
    if (!elImportLock.checked || !importAspect) return;
    if (importLockUpdating) return;
    importLockUpdating = true;
    if (changed === "w") {
      const w = clamp(parseInt(elImportW.value, 10) || 1, 1, MAX_SIZE);
      elImportW.value = w;
      elImportH.value = clamp(Math.round(w / importAspect), 1, MAX_SIZE);
    } else {
      const h = clamp(parseInt(elImportH.value, 10) || 1, 1, MAX_SIZE);
      elImportH.value = h;
      elImportW.value = clamp(Math.round(h * importAspect), 1, MAX_SIZE);
    }
    importLockUpdating = false;
  }

  elImportW.addEventListener("input", () => syncImportSize("w"));
  elImportH.addEventListener("input", () => syncImportSize("h"));

  function importToGrid() {
    if (!importImage) return;
    const tw = clamp(parseInt(elImportW.value, 10) || 32, 1, MAX_SIZE);
    const th = clamp(parseInt(elImportH.value, 10) || 32, 1, MAX_SIZE);
    const off = document.createElement("canvas");
    off.width = tw; off.height = th;
    const octx = off.getContext("2d");
    octx.imageSmoothingEnabled = false;
    octx.clearRect(0, 0, tw, th);
    octx.drawImage(importImage, 0, 0, tw, th);
    const data = octx.getImageData(0, 0, tw, th).data;
    width = tw; height = th;
    pixels = createEmptyGrid(tw, th);
    elW.value = tw; elH.value = th;
    for (let y = 0; y < th; y++) {
      for (let x = 0; x < tw; x++) {
        const i = (y * tw + x) * 4;
        const a = data[i + 3];
        if (a < 16) {
          pixels[y][x] = cell(TRANSPARENT, null);
        } else {
          const hex = "#" +
            data[i].toString(16).padStart(2, "0") +
            data[i + 1].toString(16).padStart(2, "0") +
            data[i + 2].toString(16).padStart(2, "0");
          pixels[y][x] = cell(hex, null);
        }
      }
    }
    if (tw > 64 || th > 64) {
      pixelSize = clamp(Math.floor(400 / Math.max(tw, th)), 1, 20);
      elPixelSize.value = pixelSize;
    }
    pushHistory(); resizeCanvases(); render(); updateColorCount(); saveLocal();
    setStatus(`インポート完了: ${tw}×${th}（${countUniqueColors()} 色）`);
  }

  elBtnImport.addEventListener("click", importToGrid);

  document.getElementById("btnApplySize").addEventListener("click", () => {
    resizeGrid(parseInt(elW.value, 10) || DEFAULT_W, parseInt(elH.value, 10) || DEFAULT_H);
  });

  elPixelSize.addEventListener("input", () => {
    pixelSize = clamp(parseInt(elPixelSize.value, 10) || DEFAULT_PIXEL_SIZE, 1, 64);
    elPixelSize.value = pixelSize;
    resizeCanvases(); render();
  });

  elShowGrid.addEventListener("change", () => {
    showGrid = elShowGrid.checked; render();
  });

  document.getElementById("btnClear").addEventListener("click", () => {
    if (!confirm("キャンバスをすべてクリアしますか？（部位割り当ても含む）")) return;
    pixels = createEmptyGrid(width, height);
    pushHistory(); render(); updateColorCount(); saveLocal();
    setStatus("クリアしました");
  });

  document.getElementById("btnUndo").addEventListener("click", undo);
  document.getElementById("btnRedo").addEventListener("click", redo);

  elExportFormat.addEventListener("change", () => {
    elSvgOptions.classList.toggle("visible", elExportFormat.value === "svg");
  });

  function getBgColor() {
    return elUseBg.checked ? hexNormalize(elBgColor.value) : null;
  }

  function escapeXml(s) {
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
  }

  function exportSVG() {
    const scale = clamp(parseInt(elSvgScale.value, 10) || 1, 1, 64);
    const rootId = (elSvgRootId.value || "").trim();
    const idPrefix = (elSvgIdPrefix.value || "").trim();
    const groupByPart = elSvgGroupByPart.checked;
    const bg = getBgColor();
    let svg = `<?xml version="1.0" encoding="UTF-8"?>\n`;
    svg += `<svg xmlns="http://www.w3.org/2000/svg" width="${width * scale}" height="${height * scale}" viewBox="0 0 ${width} ${height}"`;
    if (rootId) svg += ` id="${escapeXml(rootId)}"`;
    svg += ` shape-rendering="crispEdges">\n`;
    if (bg) svg += `  <rect x="0" y="0" width="${width}" height="${height}" fill="${bg}"/>\n`;

    if (groupByPart && parts.length) {
      const groups = {};
      const ungrouped = [];
      parts.forEach((pt) => { groups[pt.id] = []; });
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const px = pixels[y][x];
          if (!px.c) continue;
          let idAttr = "";
          if (idPrefix) idAttr = ` id="${escapeXml(idPrefix + x + "-" + y)}"`;
          const rect = `    <rect x="${x}" y="${y}" width="1" height="1" fill="${px.c}"${idAttr}/>`;
          if (px.p && groups[px.p]) groups[px.p].push(rect);
          else ungrouped.push(rect);
        }
      }
      parts.forEach((pt) => {
        const rects = groups[pt.id];
        if (!rects || !rects.length) return;
        const gid = sanitizeId(pt.name);
        svg += `  <g id="${escapeXml(gid)}">\n`;
        rects.forEach((r) => { svg += r + "\n"; });
        svg += `  </g>\n`;
      });
      if (ungrouped.length) {
        svg += `  <g id="ungrouped">\n`;
        ungrouped.forEach((r) => { svg += r + "\n"; });
        svg += `  </g>\n`;
      }
    } else {
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const px = pixels[y][x];
          if (!px.c) continue;
          let idAttr = "";
          if (idPrefix) idAttr = ` id="${escapeXml(idPrefix + x + "-" + y)}"`;
          svg += `  <rect x="${x}" y="${y}" width="1" height="1" fill="${px.c}"${idAttr}/>\n`;
        }
      }
    }
    svg += `</svg>\n`;
    return new Blob([svg], { type: "image/svg+xml;charset=utf-8" });
  }

  function exportRaster(format) {
    const scale = clamp(parseInt(elSvgScale.value, 10) || 10, 1, 64);
    const off = document.createElement("canvas");
    off.width = width * scale; off.height = height * scale;
    const octx = off.getContext("2d");
    octx.imageSmoothingEnabled = false;
    const bg = getBgColor();
    if (bg || format === "jpeg") {
      octx.fillStyle = bg || "#ffffff";
      octx.fillRect(0, 0, off.width, off.height);
    }
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const c = pixels[y][x].c;
        if (!c) continue;
        octx.fillStyle = c;
        octx.fillRect(x * scale, y * scale, scale, scale);
      }
    }
    return new Promise((resolve) => {
      const mime = format === "jpeg" ? "image/jpeg" : "image/png";
      const quality = format === "jpeg" ? 0.92 : undefined;
      off.toBlob((blob) => resolve(blob), mime, quality);
    });
  }

  async function doExport() {
    const format = elExportFormat.value;
    let baseName = (elFilename.value || "dotart").trim() || "dotart";
    baseName = baseName.replace(/[\\/:*?"<>|]/g, "_");
    let blob, ext;
    if (format === "svg") { blob = exportSVG(); ext = "svg"; }
    else if (format === "png") { blob = await exportRaster("png"); ext = "png"; }
    else { blob = await exportRaster("jpeg"); ext = "jpg"; }
    if (!blob) { setStatus("エクスポートに失敗しました"); return; }
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${baseName}.${ext}`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    setStatus(`${ext.toUpperCase()} をダウンロードしました`);
  }

  document.getElementById("btnExport").addEventListener("click", () => {
    doExport().catch((err) => {
      console.error(err);
      setStatus("エクスポートエラー: " + err.message);
    });
  });

  const LS_KEY = "free_note_dot_v2";

  function saveLocal() {
    try {
      localStorage.setItem(LS_KEY, JSON.stringify({
        width, height, pixels, currentColor, pixelSize, showGrid,
        recentColors, parts, activePartId, partIdCounter, showPartOverlay,
      }));
    } catch (e) {}
  }

  function loadLocal() {
    try {
      let raw = localStorage.getItem(LS_KEY);
      let data = raw ? JSON.parse(raw) : null;
      if (!data) {
        raw = localStorage.getItem("free_note_dot_v1");
        if (!raw) return false;
        data = JSON.parse(raw);
        if (data.pixels && data.pixels[0] && (typeof data.pixels[0][0] === "string" || data.pixels[0][0] === null)) {
          data.pixels = data.pixels.map((row) => row.map((c) => cell(c, null)));
        }
      }
      if (!data || !data.pixels) return false;
      width = clamp(data.width || DEFAULT_W, MIN_SIZE, MAX_SIZE);
      height = clamp(data.height || DEFAULT_H, MIN_SIZE, MAX_SIZE);
      pixels = data.pixels;
      if (!pixels.length || !pixels[0] || pixels[0][0].c === undefined) {
        const next = createEmptyGrid(width, height);
        for (let y = 0; y < Math.min(height, pixels.length); y++) {
          for (let x = 0; x < Math.min(width, (pixels[y] || []).length); x++) {
            const v = pixels[y][x];
            if (v && typeof v === "object" && "c" in v) next[y][x] = cell(v.c, v.p);
            else next[y][x] = cell(v, null);
          }
        }
        pixels = next;
      }
      currentColor = data.currentColor || "#000000";
      pixelSize = clamp(data.pixelSize || DEFAULT_PIXEL_SIZE, 1, 64);
      showGrid = data.showGrid !== false;
      showPartOverlay = !!data.showPartOverlay;
      recentColors = data.recentColors || recentColors;
      parts = data.parts || [];
      activePartId = data.activePartId || "";
      partIdCounter = data.partIdCounter || parts.length;
      return true;
    } catch (e) { return false; }
  }

  document.addEventListener("keydown", (e) => {
    if (e.target.matches("input, textarea, select")) return;
    const key = e.key.toLowerCase();
    if (e.ctrlKey || e.metaKey) {
      if (key === "z") { e.preventDefault(); if (e.shiftKey) redo(); else undo(); }
      else if (key === "y") { e.preventDefault(); redo(); }
      else if (key === "s") { e.preventDefault(); doExport(); }
      return;
    }
    if (key === "b" || key === "p") setTool("pencil");
    else if (key === "e") setTool("eraser");
    else if (key === "g" || key === "f") setTool("fill");
    else if (key === "i") setTool("eyedropper");
    else if (key === "a") setTool("part");
  });

  function init() {
    const loaded = loadLocal();
    elW.value = width; elH.value = height;
    elPixelSize.value = pixelSize;
    elShowGrid.checked = showGrid;
    elShowPartOverlay.checked = showPartOverlay;
    if (currentColor) elColor.value = currentColor;
    elExportFormat.value = "svg";
    elSvgOptions.classList.add("visible");
    elSvgScale.value = 10;
    elFilename.value = "dotart";
    renderPalette(); renderRecent(); renderPartList();
    resizeCanvases();
    history = [cloneGrid(pixels)]; historyIndex = 0;
    updateUndoRedoButtons(); render(); updateColorCount();
    setTool("pencil");
    setStatus(loaded ? "前回の作業を復元しました" : "準備完了。キャンバスに描いてください");
  }

  init();
})();
