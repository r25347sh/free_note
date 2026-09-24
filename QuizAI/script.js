/**
 * QuizAI v3 — Gemini Flash (free) primary
 * Screen Capture API → image → Gemini 2.0 Flash → answer only
 * Fast + accurate. Local LLM removed as primary.
 */

const $ = (id) => document.getElementById(id);

const el = {
  apiKey: $("apiKey"),
  btnSaveKey: $("btnSaveKey"),
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

let mediaStream = null;
let isSolving = false;

const STORAGE_KEY = "quizai_gemini_key";

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
}
function setMeta(msg) {
  el.metaInfo.textContent = msg || "";
}

function getApiKey() {
  return (el.apiKey?.value || localStorage.getItem(STORAGE_KEY) || "").trim();
}

function saveKey() {
  const k = (el.apiKey?.value || "").trim();
  if (!k) {
    alert("APIキーを入力してください");
    return;
  }
  localStorage.setItem(STORAGE_KEY, k);
  setMeta("API key saved (localStorage only)");
  setStatus("ready-model", "Key ready");
  el.btnStartShare.disabled = false;
}

(function initKey() {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved && el.apiKey) {
    el.apiKey.value = saved;
    setStatus("ready-model", "Key ready");
    el.btnStartShare.disabled = false;
  }
})();

async function startScreenShare() {
  if (!getApiKey()) {
    alert("先に Gemini API キーを保存してください");
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
    el.btnSolve.disabled = false;
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
  el.btnSolve.disabled = true;
  setStatus(getApiKey() ? "ready-model" : "ready", getApiKey() ? "Key ready" : "Ready");
}

function captureFrameAsBase64() {
  const video = el.previewVideo;
  if (!video.videoWidth) throw new Error("Video not ready");
  const canvas = el.captureCanvas;
  const maxSide = 1024;
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
  ctx.drawImage(video, 0, 0, w, h);
  const dataUrl = canvas.toDataURL("image/jpeg", 0.82);
  const base64 = dataUrl.split(",")[1];
  return { base64, mime: "image/jpeg", w, h };
}

const SYSTEM = `You are solving a Japanese junior-high / high-school English quiz from a screenshot.

The screen shows either:
- Fill-in-the-blank: English sentence with [ ] blank + Japanese meaning + 4 English options
- Multiple choice vocabulary
- Input type (type the English word)

Rules:
1. Read the Japanese meaning carefully — it tells you the correct English.
2. If there are options (1/4, 2/4…), pick EXACTLY one option word.
3. Output ONLY that single English word or short phrase.
4. No quotes, no numbers, no explanation, no Japanese.

Examples:
- 「ミーティングに出席する」 + options apply/attach/attend/attain → attend
- 「戦争は4年続いた」 + caused/lasted/stood/moved → lasted
- 「炎症」 + flatter/inflammation/inflict/plantation → inflammation

Answer with only the correct word.`;

async function callGemini(base64, mime) {
  const key = getApiKey();
  if (!key) throw new Error("No API key");

  const url =
    "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=" +
    encodeURIComponent(key);

  const body = {
    contents: [
      {
        role: "user",
        parts: [
          { text: SYSTEM },
          {
            inline_data: {
              mime_type: mime,
              data: base64,
            },
          },
        ],
      },
    ],
    generationConfig: {
      temperature: 0.1,
      maxOutputTokens: 16,
    },
  };

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Gemini ${res.status}: ${errText.slice(0, 200)}`);
  }

  const data = await res.json();
  const text =
    data?.candidates?.[0]?.content?.parts?.map((p) => p.text).join("") || "";
  return String(text).trim();
}

function cleanAnswer(raw) {
  let s = String(raw || "")
    .split("\n")[0]
    .replace(/^answer\s*[:=]\s*/i, "")
    .replace(/^正解\s*[:=]\s*/i, "")
    .replace(/^["'`]+|["'`]+$/g, "")
    .replace(/^\d+[\.\)]\s*/, "")
    .trim();
  if (s.includes(" ")) {
    const parts = s.split(/\s+/);
    if (parts.length <= 3) return s.toLowerCase();
    return parts[0].toLowerCase();
  }
  return s.toLowerCase();
}

async function solve() {
  if (!mediaStream || isSolving) return;
  if (!getApiKey()) {
    alert("APIキーを保存してください");
    return;
  }

  isSolving = true;
  el.btnSolve.disabled = true;
  setStatus("loading", "Gemini…");
  renderAnswer("…");
  showProgress(20, "Capture");
  const t0 = performance.now();

  try {
    const { base64, mime } = captureFrameAsBase64();
    showProgress(50, "Gemini Flash");
    const raw = await callGemini(base64, mime);
    const answer = cleanAnswer(raw);
    hideProgress();
    renderAnswer(answer);
    const ms = Math.round(performance.now() - t0);
    setMeta(`${ms} ms · raw: "${raw.slice(0, 40)}"`);
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

el.btnSaveKey?.addEventListener("click", saveKey);
el.btnStartShare.addEventListener("click", startScreenShare);
el.btnStopShare.addEventListener("click", stopScreenShare);
el.btnSolve.addEventListener("click", solve);

document.addEventListener("keydown", (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
    e.preventDefault();
    if (!el.btnSolve.disabled) solve();
  }
});

setStatus("ready", "Ready");
setMeta("Gemini APIキーを入力 → Save → Share → Solve");
