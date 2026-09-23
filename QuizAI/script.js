/**
 * QuizAI — Screen-share + WebLLM Vision quiz solver
 * Screen Capture API (getDisplayMedia) + local VLM
 * Separate files, performance-first, clean UI.
 */

import * as webllm from "https://esm.run/@mlc-ai/web-llm";

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
};

// ─── State ─────────────────────────────────────────────
let engine = null;
let mediaStream = null;
let isSolving = false;

// ─── Status helper ─────────────────────────────────────
function setStatus(state, text) {
  el.statusBadge.dataset.state = state;
  el.statusText.textContent = text;
}

// ─── Progress ──────────────────────────────────────────
function showProgress(pct, text) {
  el.progressWrap.hidden = false;
  el.progressFill.style.width = `${Math.min(100, Math.max(0, pct))}%`;
  el.progressText.textContent = text;
}

function hideProgress() {
  el.progressWrap.hidden = true;
}

// ─── Answer output (strict: only <p> with answer) ──────
function renderAnswer(text) {
  // Clean any accidental markup / extra whitespace
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

// ─── Model load ────────────────────────────────────────
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
  showProgress(0, "Starting download / cache check…");

  try {
    engine = await webllm.CreateMLCEngine(modelId, {
      initProgressCallback: (report) => {
        // report.progress is 0–1
        const pct = Math.round((report.progress || 0) * 100);
        showProgress(pct, report.text || `${pct}%`);
      },
      logLevel: "WARN",
    });

    hideProgress();
    setStatus("ready-model", "Model ready");
    el.btnStartShare.disabled = false;
    el.btnLoadModel.disabled = false;
    setMeta(`Loaded: ${modelId}`);
  } catch (err) {
    console.error(err);
    hideProgress();
    setStatus("error", "Model load failed");
    el.btnLoadModel.disabled = false;
    setMeta(`Error: ${err.message || err}`);
    alert(
      "モデルの読み込みに失敗しました。\nWebGPU 対応ブラウザ (Chrome 124+) と十分な VRAM / ディスク空きを確認してください。\n\n" +
        (err.message || err)
    );
  }
}

// ─── Screen Capture API (getDisplayMedia) ──────────────
async function startScreenShare() {
  try {
    // Screen Capture API
    mediaStream = await navigator.mediaDevices.getDisplayMedia({
      video: {
        cursor: "never",
        displaySurface: "monitor",
        frameRate: { ideal: 5, max: 10 },
      },
      audio: false,
      preferCurrentTab: false,
    });

    el.previewVideo.srcObject = mediaStream;
    el.previewVideo.classList.add("active");
    el.videoPlaceholder.classList.add("hidden");

    el.btnStartShare.disabled = true;
    el.btnStopShare.disabled = false;
    el.btnSolve.disabled = !engine;
    setStatus("sharing", "Sharing screen");

    // Auto-stop when user ends share from browser UI
    mediaStream.getVideoTracks()[0].addEventListener("ended", () => {
      stopScreenShare();
    });
  } catch (err) {
    console.error(err);
    setMeta(`Screen share cancelled or failed: ${err.message || err}`);
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

// ─── Capture frame → base64 ────────────────────────────
function captureFrameAsDataURL() {
  const video = el.previewVideo;
  if (!video.videoWidth || !video.videoHeight) {
    throw new Error("Video not ready");
  }

  const canvas = el.captureCanvas;
  // Cap long side to keep token / memory reasonable for VLM
  const maxSide = 1280;
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

  // JPEG keeps size down for faster transfer into the model
  return canvas.toDataURL("image/jpeg", 0.85);
}

// ─── Prompt (strict output) ────────────────────────────
const SYSTEM_PROMPT = `You are a precise quiz solver for Japanese-English vocabulary / grammar tests.

The screenshot shows a test screen. Typical layouts:
1. Multiple choice: Japanese word at the top (e.g. 炎症, 重大な). Below are English options in white boxes.
2. Input / fill-in-the-blank: Japanese prompt + empty text box (or sentence with blank).

Your ONLY job:
- Identify the question (Japanese).
- Identify the correct English answer (the matching word or the word that fills the blank).
- Output EXACTLY that English answer and nothing else.
- No quotes, no labels, no explanation, no punctuation around the word.
- If multiple choice, output the exact option text that is correct.
- If input type, output the single correct English word/phrase.

Examples of correct output format:
inflammation
serious
inflict

Never output Japanese. Never output more than the answer itself.`;

// ─── Solve ─────────────────────────────────────────────
async function solve() {
  if (!engine || !mediaStream || isSolving) return;

  isSolving = true;
  el.btnSolve.disabled = true;
  setStatus("loading", "Analyzing…");
  setMeta("Capturing frame & running VLM…");
  renderAnswer("…");

  const t0 = performance.now();

  try {
    const dataUrl = captureFrameAsDataURL();

    const messages = [
      {
        role: "user",
        content: [
          { type: "text", text: SYSTEM_PROMPT },
          {
            type: "image_url",
            image_url: { url: dataUrl },
          },
        ],
      },
    ];

    const reply = await engine.chat.completions.create({
      messages,
      stream: false,
      temperature: 0.1,
      max_tokens: 32,
    });

    const raw =
      reply.choices?.[0]?.message?.content ??
      (await engine.getMessage()) ??
      "";

    // Extra safety: take only first line / first token-ish
    let answer = String(raw)
      .split("\n")[0]
      .replace(/^answer\s*[:=]\s*/i, "")
      .replace(/^正解\s*[:=]\s*/i, "")
      .trim();

    // Prefer single word if model added noise
    if (answer.includes(" ")) {
      // keep short phrases that look like the option
      const candidates = answer.split(/[,，、]/).map((s) => s.trim()).filter(Boolean);
      if (candidates.length === 1) answer = candidates[0];
    }

    renderAnswer(answer);

    const ms = Math.round(performance.now() - t0);
    const usage = reply.usage;
    setMeta(
      `Done in ${ms} ms` +
        (usage
          ? ` · prompt ${usage.prompt_tokens} / completion ${usage.completion_tokens}`
          : "")
    );
    setStatus("sharing", "Sharing screen");
  } catch (err) {
    console.error(err);
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

// Keyboard shortcut: Ctrl/Cmd + Enter to solve
document.addEventListener("keydown", (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
    e.preventDefault();
    if (!el.btnSolve.disabled) solve();
  }
});

// Initial
setStatus("ready", "Ready");
setMeta("Load a vision model first (one-time download ~2–4 GB).");
