/**
 * QuizAI Light v2 — Speed + Accuracy focused
 * Screen Capture API + Tesseract OCR + structured option matching
 * LLM only as fallback; prefer option list constraint
 */

import * as webllm from "https://esm.run/@mlc-ai/web-llm";
import Tesseract from "https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.esm.min.js";

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

let engine = null;
let mediaStream = null;
let isSolving = false;
let ocrWorker = null;

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
  const clean = String(text || "").replace(/<[^>]*>/g, "").trim();
  el.answerBox.innerHTML = "";
  const p = document.createElement("p");
  p.textContent = clean || "—";
  el.answerBox.appendChild(p);
}
function setMeta(msg) {
  el.metaInfo.textContent = msg || "";
}

async function loadModel() {
  if (engine) {
    try { await engine.unload(); } catch (_) {}
    engine = null;
  }
  const modelId = el.modelSelect.value;
  el.btnLoadModel.disabled = true;
  el.btnStartShare.disabled = true;
  el.btnSolve.disabled = true;
  setStatus("loading", "Loading…");
  showProgress(0, "cache / download…");

  try {
    engine = await webllm.CreateMLCEngine(modelId, {
      initProgressCallback: (r) => {
        const pct = Math.round((r.progress || 0) * 100);
        showProgress(pct, r.text || `${pct}%`);
      },
      logLevel: "WARN",
    });
    hideProgress();
    setStatus("ready-model", "Model ready");
    el.btnStartShare.disabled = false;
    el.btnLoadModel.disabled = false;
    setMeta(`OK: ${modelId}`);
  } catch (err) {
    console.error(err);
    hideProgress();
    setStatus("error", "Load failed");
    el.btnLoadModel.disabled = false;
    setMeta(String(err.message || err));
    alert("モデル読み込み失敗:\n" + (err.message || err));
  }
}

async function startScreenShare() {
  try {
    mediaStream = await navigator.mediaDevices.getDisplayMedia({
      video: { cursor: "never", frameRate: { ideal: 4, max: 6 } },
      audio: false,
    });
    el.previewVideo.srcObject = mediaStream;
    el.previewVideo.classList.add("active");
    el.videoPlaceholder.classList.add("hidden");
    el.btnStartShare.disabled = true;
    el.btnStopShare.disabled = false;
    el.btnSolve.disabled = !engine;
    setStatus("sharing", "Sharing");
    mediaStream.getVideoTracks()[0].addEventListener("ended", stopScreenShare);
  } catch (err) {
    setMeta("Share cancelled: " + (err.message || err));
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

function captureFrameAsBlob() {
  const video = el.previewVideo;
  if (!video.videoWidth) throw new Error("Video not ready");
  const canvas = el.captureCanvas;
  const maxSide = 1200;
  let w = video.videoWidth;
  let h = video.videoHeight;
  if (Math.max(w, h) > maxSide) {
    const s = maxSide / Math.max(w, h);
    w = Math.round(w * s);
    h = Math.round(h * s);
  }
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d", { alpha: false });
  ctx.filter = "contrast(1.15) brightness(1.05)";
  ctx.drawImage(video, 0, 0, w, h);
  ctx.filter = "none";
  return new Promise((res) => canvas.toBlob((b) => res(b), "image/png"));
}

async function ensureOCR() {
  if (ocrWorker) return ocrWorker;
  setMeta("OCR worker init…");
  ocrWorker = await Tesseract.createWorker("eng+jpn", 1, {
    logger: () => {},
  });
  await ocrWorker.setParameters({
    tessedit_pageseg_mode: "6",
  });
  return ocrWorker;
}

async function runOCR(blob) {
  const worker = await ensureOCR();
  const { data } = await worker.recognize(blob);
  return (data.text || "").replace(/\r/g, "").trim();
}

function parseQuiz(ocrText) {
  const lines = ocrText
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  const options = [];
  const optionRe = /^[a-zA-Z][a-zA-Z\-']{1,24}$/;
  for (const line of lines) {
    const cleaned = line.replace(/\s*\d+\s*\/\s*\d+\s*$/, "").trim();
    if (optionRe.test(cleaned)) {
      options.push(cleaned.toLowerCase());
    }
  }
  const uniqOptions = [...new Set(options)];

  const jaRe = /[\u3040-\u30ff\u4e00-\u9fff]{2,}/;
  let glossJa = "";
  for (const line of lines) {
    if (jaRe.test(line) && line.length < 80) {
      glossJa = line;
      break;
    }
  }

  let stem = "";
  for (const line of lines) {
    if (
      /[a-zA-Z]/.test(line) &&
      (line.includes("[") || line.includes("]") || line.includes("＿") || line.includes("_") || line.includes("…"))
    ) {
      stem = line;
      break;
    }
  }
  if (!stem) {
    let best = "";
    for (const line of lines) {
      if (/[a-zA-Z]{3,}/.test(line) && line.length > best.length && line.length < 120) {
        best = line;
      }
    }
    stem = best;
  }

  return { stem, glossJa, options: uniqOptions, raw: ocrText };
}

function heuristicAnswer(parsed) {
  const { glossJa, options, stem } = parsed;
  if (!options.length) return null;

  const ja = glossJa || "";
  const rules = [
    { ja: /続い|続いた|続く/, en: ["lasted", "continued", "last"] },
    { ja: /起こ|引き起こ|原因/, en: ["caused", "cause"] },
    { ja: /立っ|立った|耐えた/, en: ["stood", "stand"] },
    { ja: /動い|動いた|引っ越/, en: ["moved", "move"] },
    { ja: /重大|重大な|深刻/, en: ["serious", "significant", "important", "critical"] },
    { ja: /炎症/, en: ["inflammation"] },
    { ja: /賞賛|お世辞|おべっか/, en: ["flatter", "flattery", "praise"] },
    { ja: /与え|加える|負わせ/, en: ["inflict", "inflicted"] },
    { ja: /農園|プランテーション/, en: ["plantation"] },
  ];

  for (const rule of rules) {
    if (rule.ja.test(ja)) {
      for (const cand of rule.en) {
        const hit = options.find((o) => o === cand || o.startsWith(cand) || cand.startsWith(o));
        if (hit) return hit;
      }
    }
  }

  if (/war/i.test(stem) && /year/i.test(stem) && /続/.test(ja)) {
    const hit = options.find((o) => o === "lasted" || o === "last");
    if (hit) return hit;
  }

  return null;
}

function buildStrictPrompt(parsed) {
  const opts = parsed.options.length
    ? parsed.options.map((o, i) => `${i + 1}. ${o}`).join("\n")
    : "(no options detected)";

  return `English fill-in-the-blank quiz. Pick the ONE correct option.

Sentence: ${parsed.stem || "(unknown)"}
Japanese meaning: ${parsed.glossJa || "(unknown)"}

Options (you MUST output exactly one of these words, lowercase):
${opts}

Rules:
- Output ONLY the correct option word.
- No punctuation, no number, no explanation.
- If Japanese says 続いた / continued for years → lasted
- If Japanese says 引き起こした → caused

Answer:`;
}

function constrainToOptions(raw, options) {
  if (!options.length) return raw.trim().split(/\s+/)[0] || raw;
  const lower = raw.toLowerCase().replace(/[^a-z\-']/g, " ");
  for (const o of options) {
    if (lower.includes(o)) return o;
  }
  const token = lower.trim().split(/\s+/)[0];
  const hit = options.find((o) => o === token || o.startsWith(token) || token.startsWith(o));
  if (hit) return hit;
  let best = options[0];
  let bestScore = -1;
  for (const o of options) {
    let s = 0;
    for (let i = 0; i < Math.min(o.length, token.length); i++) {
      if (o[i] === token[i]) s++;
      else break;
    }
    if (s > bestScore) {
      bestScore = s;
      best = o;
    }
  }
  return best;
}

async function solve() {
  if (!engine || !mediaStream || isSolving) return;
  isSolving = true;
  el.btnSolve.disabled = true;
  setStatus("loading", "Solving…");
  renderAnswer("…");
  showProgress(10, "Capture");
  const t0 = performance.now();

  try {
    const blob = await captureFrameAsBlob();
    showProgress(25, "OCR");
    const ocrText = await runOCR(blob);
    if (el.ocrPreview) el.ocrPreview.textContent = ocrText.slice(0, 500) || "(empty)";

    const parsed = parseQuiz(ocrText);
    setMeta(
      `opts:[${parsed.options.join(", ")}] ja:${parsed.glossJa.slice(0, 30)}`
    );

    const heur = heuristicAnswer(parsed);
    if (heur) {
      hideProgress();
      renderAnswer(heur);
      const ms = Math.round(performance.now() - t0);
      setMeta(`Heuristic ${ms} ms · options: ${parsed.options.join(", ")}`);
      setStatus("sharing", "Sharing");
      return;
    }

    showProgress(60, "LLM");
    const prompt = buildStrictPrompt(parsed);
    const reply = await engine.chat.completions.create({
      messages: [{ role: "user", content: prompt }],
      stream: false,
      temperature: 0,
      max_tokens: 12,
    });

    let raw =
      reply.choices?.[0]?.message?.content ??
      (await engine.getMessage()) ??
      "";
    raw = String(raw).split("\n")[0].trim();
    const answer = constrainToOptions(raw, parsed.options);

    hideProgress();
    renderAnswer(answer);
    const ms = Math.round(performance.now() - t0);
    setMeta(`LLM ${ms} ms · raw:"${raw}" → ${answer}`);
    setStatus("sharing", "Sharing");
  } catch (err) {
    console.error(err);
    hideProgress();
    renderAnswer("Error");
    setMeta(String(err.message || err));
    setStatus("error", "Failed");
  } finally {
    isSolving = false;
    el.btnSolve.disabled = !mediaStream;
  }
}

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
  if (ocrWorker) ocrWorker.terminate().catch(() => {});
});

setStatus("ready", "Ready");
setMeta("Qwen2.5-0.5B 推奨。Load Model → Share → Solve");
