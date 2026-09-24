/**
 * QuizAI v4.2 — Groq Vision + rate-limit friendly
 * - EN↔JA bidirectional answers
 * - auto clipboard copy
 * - min 22s between solves
 * - 429 auto-retry
 * - dual Solve buttons
 */

const $ = (id) => document.getElementById(id);

const el = {
  provider: $("provider"),
  apiKey: $("apiKey"),
  btnSaveKey: $("btnSaveKey"),
  btnStartShare: $("btnStartShare"),
  btnStopShare: $("btnStopShare"),
  btnSolve: $("btnSolve"),
  btnSolve2: $("btnSolve2"),
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

let mediaStream = null;
let isSolving = false;
let lastSolveAt = 0;
const MIN_INTERVAL_MS = 22000;

const STORAGE_KEY = "quizai_v4_cfg";

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
    .replace(/^["'`\s]+|["'`\s]+$/g, "")
    .trim();
  el.answerBox.innerHTML = "";
  const p = document.createElement("p");
  p.textContent = clean || "—";
  el.answerBox.appendChild(p);
  return clean;
}

async function copyAnswer(text) {
  const t = String(text || "").trim();
  if (!t || t === "—" || t === "…" || t === "Error") return false;
  try {
    await navigator.clipboard.writeText(t);
    return true;
  } catch (e) {
    try {
      const ta = document.createElement("textarea");
      ta.value = t;
      ta.style.position = "fixed";
      ta.style.left = "-9999px";
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      ta.remove();
      return true;
    } catch {
      return false;
    }
  }
}

function setMeta(msg) {
  el.metaInfo.textContent = msg || "";
}

function setSolveEnabled(on) {
  const v = !on;
  if (el.btnSolve) el.btnSolve.disabled = v;
  if (el.btnSolve2) el.btnSolve2.disabled = v;
}

function loadCfg() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
  } catch {
    return {};
  }
}
function saveCfg(partial) {
  const cfg = { ...loadCfg(), ...partial };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(cfg));
  return cfg;
}

function getProvider() {
  return el.provider?.value || loadCfg().provider || "groq";
}
function getApiKey() {
  return (el.apiKey?.value || loadCfg().key || "").trim();
}

function saveKey() {
  const key = (el.apiKey?.value || "").trim();
  const provider = getProvider();
  if (!key) {
    alert("APIキーを入力してください");
    return;
  }
  saveCfg({ key, provider });
  setMeta(`${provider} key saved (localStorage only)`);
  setStatus("ready-model", "Key ready");
  el.btnStartShare.disabled = false;
}

(function init() {
  const cfg = loadCfg();
  if (cfg.provider && el.provider) el.provider.value = cfg.provider;
  if (cfg.key && el.apiKey) {
    el.apiKey.value = cfg.key;
    setStatus("ready-model", "Key ready");
    el.btnStartShare.disabled = false;
  }
})();

el.provider?.addEventListener("change", () => {
  saveCfg({ provider: getProvider() });
});

async function startScreenShare() {
  if (!getApiKey()) {
    alert("先に API キーを Save してください");
    return;
  }
  try {
    mediaStream = await navigator.mediaDevices.getDisplayMedia({
      video: { cursor: "never", frameRate: { ideal: 5, max: 8 } },
      audio: false,
    });
    el.previewVideo.srcObject = mediaStream;
    el.previewVideo.classList.add("active");
    el.videoPlaceholder.classList.add("hidden");
    el.btnStartShare.disabled = true;
    el.btnStopShare.disabled = false;
    setSolveEnabled(true);
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
  el.btnStartShare.disabled = !getApiKey();
  el.btnStopShare.disabled = true;
  setSolveEnabled(false);
  setStatus(getApiKey() ? "ready-model" : "ready", getApiKey() ? "Key ready" : "Ready");
}

function captureDataUrl() {
  const video = el.previewVideo;
  if (!video.videoWidth) throw new Error("Video not ready");
  const canvas = el.captureCanvas;
  const maxSide = 768;
  let w = video.videoWidth;
  let h = video.videoHeight;
  if (Math.max(w, h) > maxSide) {
    const s = maxSide / Math.max(w, h);
    w = Math.round(w * s);
    h = Math.round(h * s);
  }
  canvas.width = w;
  canvas.height = h;
  canvas.getContext("2d", { alpha: false }).drawImage(video, 0, 0, w, h);
  return canvas.toDataURL("image/jpeg", 0.7);
}

const SYSTEM = `You solve Japanese junior-high English quizzes from screenshots.

Directions (both exist):
A) Japanese → English (意味から英単語を選ぶ / 穴埋め)
B) English → Japanese (英単語・英文の日本語訳を選ぶ・入力)

Screen types:
- Fill-in-the-blank with [ ] + meaning + 4 options
- Vocabulary multiple choice (EN or JA options)
- Type-the-word input (EN or JA)

Rules:
1. Decide whether the expected answer is English or Japanese from the screen.
2. If options are shown, output EXACTLY one option as written (same language).
3. Trust Japanese gloss for EN answers; trust English stem for JA answers.
4. Output ONLY the correct answer text. No quotes, numbers, labels, or explanation.

Examples:
- ミーティングに出席する → attend
- The war [ ] four years. / 戦争は4年続いた → lasted
- 炎症 → inflammation
- English "attend" asked in Japanese → 出席する (or matching JA option)

Answer with only the correct choice.`;

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function parseRetryMs(errText) {
  const m = String(errText).match(/try again in\s*([\d.]+)\s*s/i);
  if (m) return Math.ceil(parseFloat(m[1]) * 1000) + 500;
  return 25000;
}

async function callOpenAICompatible({ baseUrl, key, model, dataUrl }, attempt = 1) {
  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({
      model,
      temperature: 0.1,
      max_tokens: 40,
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: SYSTEM },
            { type: "image_url", image_url: { url: dataUrl } },
          ],
        },
      ],
    }),
  });

  if (!res.ok) {
    const t = await res.text();
    if (res.status === 429 && attempt < 3) {
      const wait = parseRetryMs(t);
      setMeta(`Rate limit — ${Math.ceil(wait / 1000)}s 待って再試行…`);
      showProgress(30, `wait ${Math.ceil(wait / 1000)}s`);
      await sleep(wait);
      return callOpenAICompatible({ baseUrl, key, model, dataUrl }, attempt + 1);
    }
    if (res.status === 429) {
      throw new Error(
        "429 レート制限（入力トークン/分）。約20〜30秒待ってから再実行してください。\n" +
          t.slice(0, 160)
      );
    }
    throw new Error(`${res.status}: ${t.slice(0, 220)}`);
  }
  const data = await res.json();
  return data?.choices?.[0]?.message?.content?.trim() || "";
}

async function callProvider(dataUrl) {
  const provider = getProvider();
  const key = getApiKey();

  if (provider === "groq") {
    return callOpenAICompatible({
      baseUrl: "https://api.groq.com/openai/v1",
      key,
      model: "qwen/qwen3.8-27b",
      dataUrl,
    });
  }

  if (provider === "openrouter") {
    try {
      return await callOpenAICompatible({
        baseUrl: "https://openrouter.ai/api/v1",
        key,
        model: "openrouter/free",
        dataUrl,
      });
    } catch (e1) {
      return callOpenAICompatible({
        baseUrl: "https://openrouter.ai/api/v1",
        key,
        model: "qwen/qwen2.5-vl-72b-instruct:free",
        dataUrl,
      });
    }
  }

  throw new Error("Unknown provider");
}

function cleanAnswer(raw) {
  let s = String(raw || "")
    .split("\n")[0]
    .replace(/^answer\s*[:=]\s*/i, "")
    .replace(/^正解\s*[:=]\s*/i, "")
    .replace(/^["'`]+|["'`]+$/g, "")
    .replace(/^\d+[\.\)]\s*/, "")
    .trim();
  s = s.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();

  // Japanese answers: keep as-is (do not lower-case)
  const hasJa = /[\u3040-\u30ff\u3400-\u9fff]/.test(s);
  if (hasJa) {
    s = s.replace(/^[0-9A-Da-dア-エａ-ｄ][\.\)．、]\s*/, "").trim();
    return s;
  }

  if (s.includes(" ")) {
    const parts = s.split(/\s+/).filter(Boolean);
    if (parts.length <= 4) return parts.join(" ").toLowerCase();
    return parts[0].toLowerCase();
  }
  return s.toLowerCase();
}

async function solve() {
  if (!mediaStream || isSolving) return;
  if (!getApiKey()) {
    alert("APIキーを Save してください");
    return;
  }

  const now = Date.now();
  const waitLeft = MIN_INTERVAL_MS - (now - lastSolveAt);
  if (waitLeft > 0) {
    setMeta(`クールダウン中… ${Math.ceil(waitLeft / 1000)}s（トークン制限対策）`);
    setSolveEnabled(false);
    await sleep(waitLeft);
  }

  isSolving = true;
  setSolveEnabled(false);
  setStatus("loading", "Solving…");
  renderAnswer("…");
  showProgress(15, "Capture");
  const t0 = performance.now();
  lastSolveAt = Date.now();

  try {
    const dataUrl = captureDataUrl();
    showProgress(45, getProvider());
    const raw = await callProvider(dataUrl);
    const answer = cleanAnswer(raw);
    hideProgress();
    renderAnswer(answer);
    const copied = await copyAnswer(answer);
    const ms = Math.round(performance.now() - t0);
    setMeta(
      `${ms} ms · ${getProvider()}` +
        (copied ? " · copied" : "") +
        ` · raw: "${String(raw).slice(0, 36)}"`
    );
    setStatus("sharing", "Sharing");
  } catch (err) {
    console.error(err);
    hideProgress();
    renderAnswer("Error");
    setMeta(String(err.message || err));
    setStatus("error", "Failed");
  } finally {
    isSolving = false;
    setSolveEnabled(!!mediaStream);
  }
}

el.btnSaveKey?.addEventListener("click", saveKey);
el.btnStartShare.addEventListener("click", startScreenShare);
el.btnStopShare.addEventListener("click", stopScreenShare);
el.btnSolve?.addEventListener("click", solve);
el.btnSolve2?.addEventListener("click", solve);

document.addEventListener("keydown", (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
    e.preventDefault();
    if (el.btnSolve && !el.btnSolve.disabled) solve();
  }
});

setStatus("ready", "Ready");
setMeta("Groq: 約22秒間隔推奨（無料枠 ITPM 対策）");
