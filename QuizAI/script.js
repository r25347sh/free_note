/**
 * QuizAI — Lightweight version
 * Screen Capture API + Tesseract.js OCR + small WebLLM text model
 * Avoids heavy VLM (no 4GB crash / forced reload)
 */

import * as webllm from "https://esm.run/@mlc-ai/web-llm";
import Tesseract from "https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.esm.min.js";

// ─── DOM ───────────────────────────────────────────────
const $ = (id) => document.getElementById(id);

const el = {
  modelSelect: $("modelSelect"),
  btnLoadModel: $("btnLoadModel"),
  btnStartShare: $("btnStartShare"),
  btnStopShare: $("btnStopShare"),
  btnSolve: $("btnSolve"),
  progressWrap: $("progressWrap"),
  progressFill: $("progressFill"),
  progressText: $("progressText"),
  previewVideo: $("previewVideo"),
  captureCanvas: $("captureCanvas"),
  videoPlaceholder: $("videoPlaceholder"),
  answerBox: $("answerBox"),
  metaInfo: $("metaInfo"),
  statusBadge: $("statusBadge"),
  statusText: $("statusText"),
  ocrPreview: $("ocrPreview"),
};

// ─── State ─────────────────────────────────────────────
let engine = null;
let mediaStream = null;
let isSolving = false;
let ocrWorker = null;

// ─── Status ────────────────────────────────────────────
function setStatus(state, text) {
  el.statusBadge.dataset.state = state;
  el.statusText.textContent = text;
}

function showProgress(pct, text) {
  el.progressWrap.hidden = false;
  el.progressFill.style.width = `${Math.min(100, Math.max(0, pct))}%`;
  el.progressText.textContent = text;
}

function hideProgress() {
  el.progressWrap.hidden = true;
}

function renderAnswer(text) {
  const clean = String(text || "")
    .replace(/<[^>]*>/g, "")
    .replace(/^["'\s]+|["'\s]+$/g, "")
    .trim();
  el.answerBox.innerHTML = "";
  const p = document.createElement("p");
  p.textContent = clean || "—";
  el.answerBox.appendChild(p);
}

function setMeta(msg) {
  el.metaInfo.textContent = msg || "";
}

// ─── Model load (tiny text models only) ────────────────
async function loadModel() {
  if (engine) {
    try {
      await engine.unload();
    } catch (_) {}
    engine = null;
  }

  const modelId = el.modelSelect.value;
  el.btnLoadModel.disabled = true;
  el.btnStartShare.disabled = true;
  el.btnSolve.disabled = true;
  setStatus("loading", "Loading model…");
  showProgress(0, "Download / cache check…");

  try {
    engine = await webllm.CreateMLCEngine(modelId, {
      initProgressCallback: (report) => {
        const pct = Math.round((report.progress || 0) * 100);
        showProgress(pct, report.text || `${pct}%`);
      },
      logLevel: "WARN",
    });

    hideProgress();
    setStatus("ready-model", "Model ready");
    el.btnStartShare.disabled = false;
    el.btnLoadModel.disabled = false;
    setMeta(`Loaded: ${modelId} (light text model)`);
  } catch (err) {
    console.error(err);
    hideProgress();
    setStatus("error", "Model load failed");
    el.btnLoadModel.disabled = false;
    setMeta(`Error: ${err.message || err}`);
    alert(
      "モデル読み込み失敗。\nChrome 124+ / 十分な空きメモリを確認してください。\n\n" +
        (err.message || err)
    );
  }
}

// ─── Screen Capture API ────────────────────────────────
async function startScreenShare() {
  try {
    mediaStream = await navigator.mediaDevices.getDisplayMedia({
      video: {
        cursor: "never",
        frameRate: { ideal: 5, max: 8 },
      },
      audio: false,
    });

    el.previewVideo.srcObject = mediaStream;
    el.previewVideo.classList.add("active");
    el.videoPlaceholder.classList.add("hidden");

    el.btnStartShare.disabled = true;
    el.btnStopShare.disabled = false;
    el.btnSolve.disabled = !engine;
    setStatus("sharing", "Sharing screen");

    mediaStream.getVideoTracks()[0].addEventListener("ended", () => {
      stopScreenShare();
    });
  } catch (err) {
    console.error(err);
    setMeta(`Screen share cancelled: ${err.message || err}`);
  }
}

function stopScreenShare() {
  if (mediaStream) {
    mediaStream.getTracks().forEach((t) => t.stop());
    mediaStream = null;
  }
  el.previewVideo.srcObject = null;
  el.previewVideo.classList.remove("active");
  el.videoPlaceholder.classList.remove("hidden");
  el.btnStartShare.disabled = !engine;
  el.btnStopShare.disabled = true;
  el.btnSolve.disabled = true;
  setStatus(engine ? "ready-model" : "ready", engine ? "Model ready" : "Ready");
}

// ─── Capture frame ─────────────────────────────────────
function captureFrameAsBlob() {
  const video = el.previewVideo;
  if (!video.videoWidth || !video.videoHeight) {
    throw new Error("Video not ready");
  }

  const canvas = el.captureCanvas;
  const maxSide = 960;
  let w = video.videoWidth;
  let h = video.videoHeight;
  if (Math.max(w, h) > maxSide) {
    const scale = maxSide / Math.max(w, h);
    w = Math.round(w * scale);
    h = Math.round(h * scale);
  }

  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d", { alpha: false });
  ctx.drawImage(video, 0, 0, w, h);

  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob), "image/png");
  });
}

// ─── OCR (Tesseract.js) ────────────────────────────────
async function runOCR(blob) {
  if (!ocrWorker) {
    setMeta("Initializing OCR worker…");
    ocrWorker = await Tesseract.createWorker("jpn+eng", 1, {
      logger: (m) => {
        if (m.status === "recognizing text" && m.progress != null) {
          showProgress(Math.round(m.progress * 100), `OCR ${Math.round(m.progress * 100)}%`);
        }
      },
    });
  }

  const { data } = await ocrWorker.recognize(blob);
  return (data.text || "").trim();
}

// ─── Prompt for text model ─────────────────────────────
function buildPrompt(ocrText) {
  return `You are a precise quiz solver for Japanese-English vocabulary tests.

Below is OCR text extracted from a quiz screen.
Typical patterns:
- Japanese word at top (e.g. 炎症, 重大な)
- English options listed below, OR an input field

Task:
1. Identify the Japanese question.
2. Choose the correct English answer (matching word or fill-in).
3. Output ONLY the English answer word/phrase. Nothing else.
No quotes, no labels, no explanation.

OCR text:
"""
${ocrText}
"""

Answer:`;
}

// ─── Solve ─────────────────────────────────────────────
async function solve() {
  if (!engine || !mediaStream || isSolving) return;

  isSolving = true;
  el.btnSolve.disabled = true;
  setStatus("loading", "OCR + LLM…");
  setMeta("Capturing frame…");
  renderAnswer("…");
  showProgress(5, "Capture");

  const t0 = performance.now();

  try {
    const blob = await captureFrameAsBlob();
    showProgress(15, "OCR running…");

    const ocrText = await runOCR(blob);
    if (el.ocrPreview) {
      el.ocrPreview.textContent = ocrText.slice(0, 400) || "(empty)";
    }

    if (!ocrText || ocrText.length < 3) {
      throw new Error("OCR returned almost no text. Check screen content / language.");
    }

    showProgress(55, "LLM generating…");
    setMeta("OCR done → generating answer…");

    const prompt = buildPrompt(ocrText);
    const reply = await engine.chat.completions.create({
      messages: [{ role: "user", content: prompt }],
      stream: false,
      temperature: 0.1,
      max_tokens: 24,
    });

    let raw =
      reply.choices?.[0]?.message?.content ??
      (await engine.getMessage()) ??
      "";

    let answer = String(raw)
      .split("\n")[0]
      .replace(/^answer\s*[:=]\s*/i, "")
      .replace(/^正解\s*[:=]\s*/i, "")
      .replace(/^["'\`]+|["'\`]+$/g, "")
      .trim();

    if (answer.length > 40) {
      answer = answer.split(/[\s,，、]/)[0] || answer.slice(0, 30);
    }

    hideProgress();
    renderAnswer(answer);

    const ms = Math.round(performance.now() - t0);
    const usage = reply.usage;
    setMeta(
      `Done ${ms} ms · OCR chars ${ocrText.length}` +
        (usage ? ` · tokens ${usage.prompt_tokens}+${usage.completion_tokens}` : "")
    );
    setStatus("sharing", "Sharing screen");
  } catch (err) {
    console.error(err);
    hideProgress();
    renderAnswer("Error");
    setMeta(`Error: ${err.message || err}`);
    setStatus("error", "Solve failed");
  } finally {
    isSolving = false;
    el.btnSolve.disabled = !mediaStream;
  }
}

// ─── Events ────────────────────────────────────────────
el.btnLoadModel.addEventListener("click", loadModel);
el.btnStartShare.addEventListener("click", startScreenShare);
el.btnStopShare.addEventListener("click", stopScreenShare);
el.btnSolve.addEventListener("click", solve);

document.addEventListener("keydown", (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
    e.preventDefault();
    if (!el.btnSolve.disabled) solve();
  }
});

window.addEventListener("beforeunload", () => {
  if (ocrWorker) {
    ocrWorker.terminate().catch(() => {});
  }
});

setStatus("ready", "Ready");
setMeta("Load a light text model first (~200–700 MB).");
