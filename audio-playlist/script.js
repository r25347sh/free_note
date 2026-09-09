/**
 * Audio Playlist Player
 * Pure client-side. Files stay in browser memory / object URLs.
 * Performance-focused: minimal DOM thrashing, efficient event handling.
 */

(() => {
  "use strict";

  // ===== State =====
  const state = {
    tracks: [],          // { id, file, url, title, duration }
    currentIndex: -1,
    isPlaying: false,
    loopMode: "off",     // "off" | "one" | "all"
    shuffle: false,
    shuffleOrder: [],
  };

  // ===== DOM =====
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => document.querySelectorAll(sel);

  const audio        = $("#audio");
  const dropZone     = $("#dropZone");
  const fileInput    = $("#fileInput");
  const playlistEl   = $("#playlist");
  const emptyState   = $("#emptyState");
  const trackCount   = $("#trackCount");
  const currentTitle = $("#currentTitle");
  const currentMeta  = $("#currentMeta");
  const currentTimeEl= $("#currentTime");
  const durationEl   = $("#duration");
  const progressBar  = $("#progressBar");
  const progressFill = $("#progressFill");
  const progressHandle = $("#progressHandle");
  const volumeSlider = $("#volumeSlider");
  const btnPlay      = $("#btnPlay");
  const iconPlay     = $("#iconPlay");
  const iconPause    = $("#iconPause");
  const btnPrev      = $("#btnPrev");
  const btnNext      = $("#btnNext");
  const btnShuffle   = $("#btnShuffle");
  const btnLoop      = $("#btnLoop");
  const loopBadge    = $("#loopBadge");
  const btnClear     = $("#btnClear");

  // ===== Utils =====
  const uid = () => crypto.randomUUID?.() || Date.now().toString(36) + Math.random().toString(36).slice(2);

  function formatTime(sec) {
    if (!Number.isFinite(sec) || sec < 0) return "0:00";
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${m}:${s.toString().padStart(2, "0")}`;
  }

  function getAudioDuration(file) {
    return new Promise((resolve) => {
      const tmp = new Audio();
      const url = URL.createObjectURL(file);
      tmp.preload = "metadata";
      tmp.onloadedmetadata = () => {
        resolve(tmp.duration);
        URL.revokeObjectURL(url);
      };
      tmp.onerror = () => {
        resolve(0);
        URL.revokeObjectURL(url);
      };
      tmp.src = url;
    });
  }

  // ===== Core Player =====
  function loadTrack(index) {
    if (index < 0 || index >= state.tracks.length) return;

    state.currentIndex = index;
    const track = state.tracks[index];
    audio.src = track.url;
    audio.load();

    currentTitle.textContent = track.title;
    currentMeta.textContent = track.duration
      ? formatTime(track.duration)
      : "読み込み中...";

    updatePlaylistUI();
    updatePlayButton();
  }

  function play() {
    if (state.tracks.length === 0) return;
    if (state.currentIndex === -1) {
      loadTrack(0);
    }
    audio.play().then(() => {
      state.isPlaying = true;
      updatePlayButton();
    }).catch(() => {
      state.isPlaying = false;
      updatePlayButton();
    });
  }

  function pause() {
    audio.pause();
    state.isPlaying = false;
    updatePlayButton();
  }

  function togglePlay() {
    if (state.isPlaying) pause();
    else play();
  }

  function next() {
    if (state.tracks.length === 0) return;

    let nextIndex;
    if (state.shuffle) {
      const pos = state.shuffleOrder.indexOf(state.currentIndex);
      nextIndex = state.shuffleOrder[(pos + 1) % state.shuffleOrder.length];
    } else {
      nextIndex = state.currentIndex + 1;
      if (nextIndex >= state.tracks.length) {
        if (state.loopMode === "all") nextIndex = 0;
        else {
          pause();
          return;
        }
      }
    }
    loadTrack(nextIndex);
    if (state.isPlaying || state.loopMode !== "off") play();
  }

  function prev() {
    if (state.tracks.length === 0) return;
    // if > 3s into track, restart instead of previous
    if (audio.currentTime > 3) {
      audio.currentTime = 0;
      return;
    }

    let prevIndex;
    if (state.shuffle) {
      const pos = state.shuffleOrder.indexOf(state.currentIndex);
      prevIndex = state.shuffleOrder[(pos - 1 + state.shuffleOrder.length) % state.shuffleOrder.length];
    } else {
      prevIndex = state.currentIndex - 1;
      if (prevIndex < 0) {
        if (state.loopMode === "all") prevIndex = state.tracks.length - 1;
        else prevIndex = 0;
      }
    }
    loadTrack(prevIndex);
    if (state.isPlaying) play();
  }

  function rebuildShuffleOrder() {
    const indices = state.tracks.map((_, i) => i);
    for (let i = indices.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [indices[i], indices[j]] = [indices[j], indices[i]];
    }
    // ensure current track is first if playing
    if (state.currentIndex >= 0) {
      const idx = indices.indexOf(state.currentIndex);
      if (idx > 0) {
        indices.splice(idx, 1);
        indices.unshift(state.currentIndex);
      }
    }
    state.shuffleOrder = indices;
  }

  // ===== Playlist Management =====
  async function addFiles(fileList) {
    const files = Array.from(fileList).filter((f) => f.type.startsWith("audio/"));
    if (files.length === 0) return;

    const newTracks = await Promise.all(
      files.map(async (file) => {
        const duration = await getAudioDuration(file);
        return {
          id: uid(),
          file,
          url: URL.createObjectURL(file),
          title: file.name.replace(/\.[^/.]+$/, ""),
          duration,
        };
      })
    );

    state.tracks.push(...newTracks);
    if (state.shuffle) rebuildShuffleOrder();

    renderPlaylist();
    updateTrackCount();

    // auto-start if nothing was playing
    if (state.currentIndex === -1 && state.tracks.length > 0) {
      loadTrack(0);
    }
  }

  function removeTrack(id) {
    const index = state.tracks.findIndex((t) => t.id === id);
    if (index === -1) return;

    const track = state.tracks[index];
    URL.revokeObjectURL(track.url);
    state.tracks.splice(index, 1);

    if (state.tracks.length === 0) {
      state.currentIndex = -1;
      state.isPlaying = false;
      audio.src = "";
      currentTitle.textContent = "—";
      currentMeta.textContent = "ファイルを追加してください";
      progressFill.style.width = "0%";
      progressHandle.style.left = "0%";
      currentTimeEl.textContent = "0:00";
      durationEl.textContent = "0:00";
      updatePlayButton();
    } else if (index === state.currentIndex) {
      // was current → load next or previous
      const newIndex = Math.min(index, state.tracks.length - 1);
      loadTrack(newIndex);
      if (state.isPlaying) play();
    } else if (index < state.currentIndex) {
      state.currentIndex -= 1;
    }

    if (state.shuffle) rebuildShuffleOrder();
    renderPlaylist();
    updateTrackCount();
  }

  function clearPlaylist() {
    state.tracks.forEach((t) => URL.revokeObjectURL(t.url));
    state.tracks = [];
    state.currentIndex = -1;
    state.isPlaying = false;
    state.shuffleOrder = [];
    audio.src = "";
    currentTitle.textContent = "—";
    currentMeta.textContent = "ファイルを追加してください";
    progressFill.style.width = "0%";
    progressHandle.style.left = "0%";
    currentTimeEl.textContent = "0:00";
    durationEl.textContent = "0:00";
    updatePlayButton();
    renderPlaylist();
    updateTrackCount();
  }

  // ===== UI Render =====
  function renderPlaylist() {
    playlistEl.innerHTML = "";

    if (state.tracks.length === 0) {
      emptyState.classList.remove("hidden");
      return;
    }
    emptyState.classList.add("hidden");

    const frag = document.createDocumentFragment();
    state.tracks.forEach((track, i) => {
      const li = document.createElement("li");
      li.className = "playlist-item" + (i === state.currentIndex ? " active" : "");
      li.dataset.id = track.id;
      li.draggable = true;

      li.innerHTML = `
        <span class="item-index">${i + 1}</span>
        <div class="item-info">
          <div class="item-title">${escapeHtml(track.title)}</div>
          <div class="item-duration">${formatTime(track.duration)}</div>
        </div>
        <button class="item-remove" title="削除" aria-label="削除">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M18 6L6 18M6 6l12 12"/>
          </svg>
        </button>
      `;

      li.addEventListener("click", (e) => {
        if (e.target.closest(".item-remove")) return;
        loadTrack(i);
        play();
      });

      li.querySelector(".item-remove").addEventListener("click", (e) => {
        e.stopPropagation();
        removeTrack(track.id);
      });

      // Drag & drop reorder
      li.addEventListener("dragstart", (e) => {
        li.classList.add("dragging");
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("text/plain", track.id);
      });
      li.addEventListener("dragend", () => li.classList.remove("dragging"));
      li.addEventListener("dragover", (e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
      });
      li.addEventListener("drop", (e) => {
        e.preventDefault();
        const fromId = e.dataTransfer.getData("text/plain");
        const toId = track.id;
        if (fromId === toId) return;
        reorderTracks(fromId, toId);
      });

      frag.appendChild(li);
    });
    playlistEl.appendChild(frag);
  }

  function reorderTracks(fromId, toId) {
    const fromIdx = state.tracks.findIndex((t) => t.id === fromId);
    const toIdx = state.tracks.findIndex((t) => t.id === toId);
    if (fromIdx === -1 || toIdx === -1) return;

    const [item] = state.tracks.splice(fromIdx, 1);
    state.tracks.splice(toIdx, 0, item);

    // fix currentIndex
    if (state.currentIndex === fromIdx) {
      state.currentIndex = toIdx;
    } else if (fromIdx < state.currentIndex && toIdx >= state.currentIndex) {
      state.currentIndex -= 1;
    } else if (fromIdx > state.currentIndex && toIdx <= state.currentIndex) {
      state.currentIndex += 1;
    }

    if (state.shuffle) rebuildShuffleOrder();
    renderPlaylist();
  }

  function updatePlaylistUI() {
    $$(".playlist-item").forEach((el, i) => {
      el.classList.toggle("active", i === state.currentIndex);
    });
  }

  function updateTrackCount() {
    trackCount.textContent = state.tracks.length;
  }

  function updatePlayButton() {
    if (state.isPlaying) {
      iconPlay.classList.add("hidden");
      iconPause.classList.remove("hidden");
    } else {
      iconPlay.classList.remove("hidden");
      iconPause.classList.add("hidden");
    }
  }

  function updateLoopUI() {
    btnLoop.classList.toggle("active", state.loopMode !== "off");
    loopBadge.classList.toggle("hidden", state.loopMode !== "one");
    btnLoop.dataset.mode = state.loopMode;
    const titles = { off: "ループ: オフ", all: "ループ: 全曲", one: "ループ: 1曲" };
    btnLoop.title = titles[state.loopMode];
  }

  function escapeHtml(str) {
    const div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
  }

  // ===== Event Bindings =====
  // Upload
  dropZone.addEventListener("click", () => fileInput.click());
  fileInput.addEventListener("change", () => {
    if (fileInput.files.length) addFiles(fileInput.files);
    fileInput.value = "";
  });

  dropZone.addEventListener("dragover", (e) => {
    e.preventDefault();
    dropZone.classList.add("dragover");
  });
  dropZone.addEventListener("dragleave", () => dropZone.classList.remove("dragover"));
  dropZone.addEventListener("drop", (e) => {
    e.preventDefault();
    dropZone.classList.remove("dragover");
    if (e.dataTransfer.files.length) addFiles(e.dataTransfer.files);
  });

  // Controls
  btnPlay.addEventListener("click", togglePlay);
  btnPrev.addEventListener("click", prev);
  btnNext.addEventListener("click", next);

  btnShuffle.addEventListener("click", () => {
    state.shuffle = !state.shuffle;
    btnShuffle.classList.toggle("active", state.shuffle);
    if (state.shuffle) rebuildShuffleOrder();
  });

  btnLoop.addEventListener("click", () => {
    const modes = ["off", "all", "one"];
    const next = modes[(modes.indexOf(state.loopMode) + 1) % modes.length];
    state.loopMode = next;
    updateLoopUI();
  });

  btnClear.addEventListener("click", () => {
    if (state.tracks.length && confirm("プレイリストをすべてクリアしますか？")) {
      clearPlaylist();
    }
  });

  // Progress seek
  let isSeeking = false;
  progressBar.addEventListener("mousedown", (e) => {
    isSeeking = true;
    seek(e);
  });
  document.addEventListener("mousemove", (e) => {
    if (isSeeking) seek(e);
  });
  document.addEventListener("mouseup", () => {
    isSeeking = false;
  });
  progressBar.addEventListener("touchstart", (e) => {
    isSeeking = true;
    seek(e.touches[0]);
  }, { passive: true });
  document.addEventListener("touchmove", (e) => {
    if (isSeeking) seek(e.touches[0]);
  }, { passive: true });
  document.addEventListener("touchend", () => {
    isSeeking = false;
  });

  function seek(e) {
    if (!audio.duration) return;
    const rect = progressBar.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    audio.currentTime = ratio * audio.duration;
    updateProgress();
  }

  // Volume
  volumeSlider.addEventListener("input", () => {
    audio.volume = parseFloat(volumeSlider.value);
  });
  audio.volume = parseFloat(volumeSlider.value);

  // Audio events
  audio.addEventListener("timeupdate", updateProgress);
  audio.addEventListener("loadedmetadata", () => {
    durationEl.textContent = formatTime(audio.duration);
    if (state.currentIndex >= 0) {
      state.tracks[state.currentIndex].duration = audio.duration;
      currentMeta.textContent = formatTime(audio.duration);
      // update duration in list
      const item = playlistEl.children[state.currentIndex];
      if (item) {
        const durEl = item.querySelector(".item-duration");
        if (durEl) durEl.textContent = formatTime(audio.duration);
      }
    }
  });

  audio.addEventListener("ended", () => {
    if (state.loopMode === "one") {
      audio.currentTime = 0;
      audio.play();
    } else {
      next();
    }
  });

  audio.addEventListener("play", () => {
    state.isPlaying = true;
    updatePlayButton();
  });
  audio.addEventListener("pause", () => {
    // only update if not seeking or intentional
    if (!isSeeking) {
      state.isPlaying = false;
      updatePlayButton();
    }
  });

  function updateProgress() {
    if (!audio.duration) return;
    const ratio = (audio.currentTime / audio.duration) * 100;
    progressFill.style.width = `${ratio}%`;
    progressHandle.style.left = `${ratio}%`;
    currentTimeEl.textContent = formatTime(audio.currentTime);
  }

  // Keyboard shortcuts
  document.addEventListener("keydown", (e) => {
    if (e.target.matches("input, textarea")) return;
    switch (e.code) {
      case "Space":
        e.preventDefault();
        togglePlay();
        break;
      case "ArrowRight":
        e.preventDefault();
        next();
        break;
      case "ArrowLeft":
        e.preventDefault();
        prev();
        break;
    }
  });

  // Init UI
  updateLoopUI();
  updateTrackCount();
})();
