(() => {
  "use strict";

  // ========== Constants ==========
  const MAX_SIZE = 128;
  const MIN_SIZE = 1;
  const DEFAULT_W = 16;
  const DEFAULT_H = 16;
  const DEFAULT_PIXEL_SIZE = 20;
  const MAX_HISTORY = 60;
  const TRANSPARENT = null;

  const PALETTE = [
    null,          // transparent
    "#000000",
    "#ffffff",
    "#7f7f7f",
    "#c3c3c3",
    "#880015",
    "#b97a57",
    "#ed1c24",
    "#ffaec9",
    "#ff7f27",
    "#ffc90e",
    "#fff200",
    "#22b14c",
    "#b5e61d",
    "#00a2e8",
    "#99d9ea",
    "#3f48cc",
    "#7092be",
    "#a349a4",
    "#c8bfe7",
    // extra common pixel-art tones
    "#1a1c2c",
    "#5d275d",
    "#b13e53",
    "#ef7d57",
    "#ffcd75",
    "#a7f070",
    "#38b764",
    "#257179",
    "#29366f",
    "#3b5dc9",
    "#41a6f6",
    "#73eff7",
    "#f4f4f4",
    "#94b0c2",
    "#566c86",
    "#333c57",
  ];

  // ========== State ==========
  let width = DEFAULT_W;
  let height = DEFAULT_H;
  let pixels = createEmptyGrid(width, height); // 2D array: null | "#rrggbb"
  let currentColor = "#000000";
  let tool = "pencil"; // pencil | eraser | fill | eyedropper
  let pixelSize = DEFAULT_PIXEL_SIZE;
  let showGrid = true;
  let isDrawing = false;
  let lastPos = null;
  let history = [];
  let historyIndex = -1;
  let recentColors = ["#000000", "#ffffff", "#ed1c24", "#22b14c", "#00a2e8"];

  // ========== DOM ==========
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
  const elStatus = document.getElementById("statusText");
  const elCoord = document.getElementById("coordText");
  const elPalette = document.getElementById("palette");
  const elRecent = document.getElementById("recentColors");
  const elExportFormat = document.getElementById("exportFormat");
  const elSvgOptions = document.getElementById("svgOptions");
  const elSvgRootId = document.getElementById("svgRootId");
  const elSvgIdPrefix = document.getElementById("svgIdPrefix");
  const elSvgScale = document.getElementById("svgScale");
  const elFilename = document.getElementById("filename");
  const elBgColor = document.getElementById("bgColor");
  const elUseBg = document.getElementById("useBg");

  // ========== Helpers ==========
  function createEmptyGrid(w, h) {
    const g = new Array(h);
    for (let y = 0; y < h; y++) {
      g[y] = new Array(w).fill(TRANSPARENT);
    }
    return g;
  }

  function cloneGrid(src) {
    return src.map((row) => row.slice());
  }

  function setStatus(msg) {
    elStatus.textContent = msg;
  }

  function clamp(v, min, max) {
    return Math.max(min, Math.min(max, v));
  }

  function hexNormalize(c) {
    if (!c || c === "transparent") return TRANSPARENT;
    if (c.startsWith("#") && c.length === 4) {
      // #rgb -> #rrggbb
      return "#" + c[1] + c[1] + c[2] + c[2] + c[3] + c[3];
    }
    return c.toLowerCase();
  }

  function colorEqual(a, b) {
    return a === b;
  }

  // ========== History ==========
  function pushHistory() {
    // discard redo branch
    if (historyIndex < history.length - 1) {
      history = history.slice(0, historyIndex + 1);
    }
    history.push(cloneGrid(pixels));
    if (history.length > MAX_HISTORY) {
      history.shift();
    } else {
      historyIndex++;
    }
    // keep index in sync when shifted
    historyIndex = history.length - 1;
    updateUndoRedoButtons();
  }

  function undo() {
    if (historyIndex <= 0) return;
    historyIndex--;
    pixels = cloneGrid(history[historyIndex]);
    render();
    updateUndoRedoButtons();
    setStatus("元に戻しました");
  }

  function redo() {
    if (historyIndex >= history.length - 1) return;
    historyIndex++;
    pixels = cloneGrid(history[historyIndex]);
    render();
    updateUndoRedoButtons();
    setStatus("やり直しました");
  }

  function updateUndoRedoButtons() {
    document.getElementById("btnUndo").disabled = historyIndex <= 0;
    document.getElementById("btnRedo").disabled = historyIndex >= history.length - 1;
  }

  // ========== Resize ==========
  function resizeGrid(newW, newH) {
    newW = clamp(Math.floor(newW), MIN_SIZE, MAX_SIZE);
    newH = clamp(Math.floor(newH), MIN_SIZE, MAX_SIZE);
    if (newW === width && newH === height) return;

    const next = createEmptyGrid(newW, newH);
    const copyW = Math.min(width, newW);
    const copyH = Math.min(height, newH);
    for (let y = 0; y < copyH; y++) {
      for (let x = 0; x < copyW; x++) {
        next[y][x] = pixels[y][x];
      }
    }
    width = newW;
    height = newH;
    pixels = next;
    elW.value = width;
    elH.value = height;
    pushHistory();
    resizeCanvases();
    render();
    setStatus(`サイズを ${width}×${height} に変更しました`);
    saveLocal();
  }

  function resizeCanvases() {
    const w = width * pixelSize;
    const h = height * pixelSize;
    canvas.width = w;
    canvas.height = h;
    gridCanvas.width = w;
    gridCanvas.height = h;
    canvasContainer.style.width = w + "px";
    canvasContainer.style.height = h + "px";
    // disable smoothing
    ctx.imageSmoothingEnabled = false;
    gridCtx.imageSmoothingEnabled = false;
  }

  // ========== Rendering ==========
  function render() {
    const w = canvas.width;
    const h = canvas.height;
    ctx.clearRect(0, 0, w, h);

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const c = pixels[y][x];
        if (c) {
          ctx.fillStyle = c;
          ctx.fillRect(x * pixelSize, y * pixelSize, pixelSize, pixelSize);
        }
      }
    }

    // grid overlay
    gridCtx.clearRect(0, 0, w, h);
    if (showGrid && pixelSize >= 4) {
      gridCtx.strokeStyle = "rgba(255,255,255,0.12)";
      gridCtx.lineWidth = 1;
      for (let x = 0; x <= width; x++) {
        const px = x * pixelSize + 0.5;
        gridCtx.beginPath();
        gridCtx.moveTo(px, 0);
        gridCtx.lineTo(px, h);
        gridCtx.stroke();
      }
      for (let y = 0; y <= height; y++) {
        const py = y * pixelSize + 0.5;
        gridCtx.beginPath();
        gridCtx.moveTo(0, py);
        gridCtx.lineTo(w, py);
        gridCtx.stroke();
      }
    }
  }

  // ========== Drawing ==========
  function canvasToGrid(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const x = Math.floor(((clientX - rect.left) * scaleX) / pixelSize);
    const y = Math.floor(((clientY - rect.top) * scaleY) / pixelSize);
    if (x < 0 || y < 0 || x >= width || y >= height) return null;
    return { x, y };
  }

  function setPixel(x, y, color) {
    if (x < 0 || y < 0 || x >= width || y >= height) return false;
    if (colorEqual(pixels[y][x], color)) return false;
    pixels[y][x] = color;
    return true;
  }

  function drawLine(x0, y0, x1, y1, color) {
    // Bresenham
    let changed = false;
    let dx = Math.abs(x1 - x0);
    let dy = Math.abs(y1 - y0);
    let sx = x0 < x1 ? 1 : -1;
    let sy = y0 < y1 ? 1 : -1;
    let err = dx - dy;
    let x = x0;
    let y = y0;
    while (true) {
      if (setPixel(x, y, color)) changed = true;
      if (x === x1 && y === y1) break;
      const e2 = 2 * err;
      if (e2 > -dy) {
        err -= dy;
        x += sx;
      }
      if (e2 < dx) {
        err += dx;
        y += sy;
      }
    }
    return changed;
  }

  function floodFill(sx, sy, targetColor, fillColor) {
    if (colorEqual(targetColor, fillColor)) return false;
    if (!colorEqual(pixels[sy][sx], targetColor)) return false;

    const stack = [[sx, sy]];
    let changed = false;
    const visited = new Set();

    while (stack.length) {
      const [x, y] = stack.pop();
      const key = x + "," + y;
      if (visited.has(key)) continue;
      if (x < 0 || y < 0 || x >= width || y >= height) continue;
      if (!colorEqual(pixels[y][x], targetColor)) continue;

      visited.add(key);
      pixels[y][x] = fillColor;
      changed = true;

      stack.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]);
    }
    return changed;
  }

  function applyTool(pos, isStart) {
    if (!pos) return;
    const { x, y } = pos;
    let changed = false;

    if (tool === "pencil") {
      if (lastPos && !isStart) {
        changed = drawLine(lastPos.x, lastPos.y, x, y, currentColor);
      } else {
        changed = setPixel(x, y, currentColor);
      }
      addRecent(currentColor);
    } else if (tool === "eraser") {
      if (lastPos && !isStart) {
        changed = drawLine(lastPos.x, lastPos.y, x, y, TRANSPARENT);
      } else {
        changed = setPixel(x, y, TRANSPARENT);
      }
    } else if (tool === "fill" && isStart) {
      changed = floodFill(x, y, pixels[y][x], currentColor);
      if (changed) addRecent(currentColor);
    } else if (tool === "eyedropper" && isStart) {
      const c = pixels[y][x];
      if (c) {
        currentColor = c;
        elColor.value = c;
        updatePaletteActive();
        setStatus(`色を取得: ${c}`);
      } else {
        currentColor = TRANSPARENT;
        updatePaletteActive();
        setStatus("透明を取得");
      }
      // switch back to pencil after pick
      setTool("pencil");
      return;
    }

    if (changed) {
      render();
    }
    lastPos = pos;
  }

  // ========== Events ==========
  function onPointerDown(e) {
    e.preventDefault();
    canvas.setPointerCapture(e.pointerId);
    isDrawing = true;
    lastPos = null;
    const pos = canvasToGrid(e.clientX, e.clientY);
    if (tool === "fill" || tool === "eyedropper") {
      applyTool(pos, true);
      if (tool === "fill") {
        pushHistory();
        saveLocal();
      }
      isDrawing = false;
    } else {
      applyTool(pos, true);
    }
  }

  function onPointerMove(e) {
    const pos = canvasToGrid(e.clientX, e.clientY);
    if (pos) {
      elCoord.textContent = `(${pos.x}, ${pos.y})`;
    } else {
      elCoord.textContent = "—";
    }
    if (!isDrawing) return;
    e.preventDefault();
    applyTool(pos, false);
  }

  function onPointerUp(e) {
    if (!isDrawing) return;
    isDrawing = false;
    lastPos = null;
    // only push history for continuous tools
    if (tool === "pencil" || tool === "eraser") {
      pushHistory();
      saveLocal();
    }
  }

  canvas.addEventListener("pointerdown", onPointerDown);
  canvas.addEventListener("pointermove", onPointerMove);
  canvas.addEventListener("pointerup", onPointerUp);
  canvas.addEventListener("pointercancel", onPointerUp);
  canvas.addEventListener("pointerleave", () => {
    elCoord.textContent = "—";
  });

  // prevent context menu on long press
  canvas.addEventListener("contextmenu", (e) => e.preventDefault());

  // ========== Tools UI ==========
  function setTool(name) {
    tool = name;
    document.querySelectorAll(".tool-btn").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.tool === name);
    });
    const cursors = {
      pencil: "crosshair",
      eraser: "cell",
      fill: "cell",
      eyedropper: "copy",
    };
    canvas.style.cursor = cursors[name] || "crosshair";
  }

  document.querySelectorAll(".tool-btn").forEach((btn) => {
    btn.addEventListener("click", () => setTool(btn.dataset.tool));
  });

  // ========== Color ==========
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
      if ((c === null && currentColor === null) || (c && c === currentColor)) {
        sw.classList.add("active");
      }
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
      sw.type = "button";
      sw.className = "swatch";
      sw.style.background = c;
      sw.title = c;
      sw.addEventListener("click", () => {
        currentColor = c;
        elColor.value = c;
        updatePaletteActive();
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
    currentColor = hexNormalize(elColor.value);
    updatePaletteActive();
  });

  // ========== Size / View ==========
  document.getElementById("btnApplySize").addEventListener("click", () => {
    resizeGrid(parseInt(elW.value, 10) || DEFAULT_W, parseInt(elH.value, 10) || DEFAULT_H);
  });

  elPixelSize.addEventListener("input", () => {
    pixelSize = clamp(parseInt(elPixelSize.value, 10) || DEFAULT_PIXEL_SIZE, 2, 64);
    elPixelSize.value = pixelSize;
    resizeCanvases();
    render();
  });

  elShowGrid.addEventListener("change", () => {
    showGrid = elShowGrid.checked;
    render();
  });

  document.getElementById("btnClear").addEventListener("click", () => {
    if (!confirm("キャンバスをすべてクリアしますか？")) return;
    pixels = createEmptyGrid(width, height);
    pushHistory();
    render();
    saveLocal();
    setStatus("クリアしました");
  });

  document.getElementById("btnUndo").addEventListener("click", undo);
  document.getElementById("btnRedo").addEventListener("click", redo);

  // ========== Export ==========
  elExportFormat.addEventListener("change", () => {
    const isSvg = elExportFormat.value === "svg";
    elSvgOptions.classList.toggle("visible", isSvg);
  });

  function getBgColor() {
    return elUseBg.checked ? hexNormalize(elBgColor.value) : null;
  }

  function exportSVG() {
    const scale = clamp(parseInt(elSvgScale.value, 10) || 1, 1, 64);
    const rootId = (elSvgRootId.value || "").trim();
    const idPrefix = (elSvgIdPrefix.value || "").trim();
    const bg = getBgColor();

    let svg = `<?xml version="1.0" encoding="UTF-8"?>\n`;
    svg += `<svg xmlns="http://www.w3.org/2000/svg" width="${width * scale}" height="${height * scale}" viewBox="0 0 ${width} ${height}"`;
    if (rootId) svg += ` id="${escapeXml(rootId)}"`;
    svg += ` shape-rendering="crispEdges">\n`;

    if (bg) {
      svg += `  <rect x="0" y="0" width="${width}" height="${height}" fill="${bg}"/>\n`;
    }

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const c = pixels[y][x];
        if (!c) continue;
        let idAttr = "";
        if (idPrefix) {
          idAttr = ` id="${escapeXml(idPrefix + x + "-" + y)}"`;
        }
        svg += `  <rect x="${x}" y="${y}" width="1" height="1" fill="${c}"${idAttr}/>\n`;
      }
    }
    svg += `</svg>\n`;
    return new Blob([svg], { type: "image/svg+xml;charset=utf-8" });
  }

  function escapeXml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&apos;");
  }

  function exportRaster(format) {
    const scale = clamp(parseInt(elSvgScale.value, 10) || 10, 1, 64);
    const off = document.createElement("canvas");
    off.width = width * scale;
    off.height = height * scale;
    const octx = off.getContext("2d");
    octx.imageSmoothingEnabled = false;

    const bg = getBgColor();
    if (bg || format === "jpeg") {
      octx.fillStyle = bg || "#ffffff";
      octx.fillRect(0, 0, off.width, off.height);
    }

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const c = pixels[y][x];
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
    // sanitize
    baseName = baseName.replace(/[\\/:*?"<>|]/g, "_");

    let blob;
    let ext;
    if (format === "svg") {
      blob = exportSVG();
      ext = "svg";
    } else if (format === "png") {
      blob = await exportRaster("png");
      ext = "png";
    } else {
      blob = await exportRaster("jpeg");
      ext = "jpg";
    }

    if (!blob) {
      setStatus("エクスポートに失敗しました");
      return;
    }

    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${baseName}.${ext}`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    setStatus(`${ext.toUpperCase()} をダウンロードしました`);
  }

  document.getElementById("btnExport").addEventListener("click", () => {
    doExport().catch((err) => {
      console.error(err);
      setStatus("エクスポートエラー: " + err.message);
    });
  });

  // ========== Local Storage ==========
  const LS_KEY = "free_note_dot_v1";

  function saveLocal() {
    try {
      const data = {
        width,
        height,
        pixels,
        currentColor,
        pixelSize,
        showGrid,
        recentColors,
      };
      localStorage.setItem(LS_KEY, JSON.stringify(data));
    } catch (e) {
      // quota etc.
    }
  }

  function loadLocal() {
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (!raw) return false;
      const data = JSON.parse(raw);
      if (!data || !data.pixels) return false;
      width = clamp(data.width || DEFAULT_W, MIN_SIZE, MAX_SIZE);
      height = clamp(data.height || DEFAULT_H, MIN_SIZE, MAX_SIZE);
      pixels = data.pixels;
      // safety: ensure dimensions match
      if (pixels.length !== height || (pixels[0] && pixels[0].length !== width)) {
        const next = createEmptyGrid(width, height);
        for (let y = 0; y < Math.min(height, pixels.length); y++) {
          for (let x = 0; x < Math.min(width, (pixels[y] || []).length); x++) {
            next[y][x] = pixels[y][x];
          }
        }
        pixels = next;
      }
      currentColor = data.currentColor || "#000000";
      pixelSize = clamp(data.pixelSize || DEFAULT_PIXEL_SIZE, 2, 64);
      showGrid = data.showGrid !== false;
      recentColors = data.recentColors || recentColors;
      return true;
    } catch (e) {
      return false;
    }
  }

  // ========== Keyboard ==========
  document.addEventListener("keydown", (e) => {
    if (e.target.matches("input, textarea, select")) return;
    const key = e.key.toLowerCase();
    if (e.ctrlKey || e.metaKey) {
      if (key === "z") {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
      } else if (key === "y") {
        e.preventDefault();
        redo();
      } else if (key === "s") {
        e.preventDefault();
        doExport();
      }
      return;
    }
    if (key === "b" || key === "p") setTool("pencil");
    else if (key === "e") setTool("eraser");
    else if (key === "g" || key === "f") setTool("fill");
    else if (key === "i") setTool("eyedropper");
    else if (key === "delete" || key === "backspace") {
      // no-op or clear selected – skip
    }
  });

  // ========== Init ==========
  function init() {
    const loaded = loadLocal();
    elW.value = width;
    elH.value = height;
    elPixelSize.value = pixelSize;
    elShowGrid.checked = showGrid;
    if (currentColor) elColor.value = currentColor;
    elExportFormat.value = "svg";
    elSvgOptions.classList.add("visible");
    elSvgScale.value = 10;
    elFilename.value = "dotart";

    renderPalette();
    renderRecent();
    resizeCanvases();
    // initial history
    history = [cloneGrid(pixels)];
    historyIndex = 0;
    updateUndoRedoButtons();
    render();
    setTool("pencil");
    setStatus(loaded ? "前回の作業を復元しました" : "準備完了。キャンバスに描いてください");
  }

  init();
})();
