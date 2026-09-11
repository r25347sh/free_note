/**
 * LockSystem - 再利用可能なロックモジュール
 *
 * 他のHTMLからも以下のように使えます:
 *
 *   <script src="/free_note/lock/lock.js"></script>
 *   <script>
 *     LockSystem.init({
 *       audioSrc: './alert.mp3',          // 必須に近い（アラート音源）
 *       lockButtonId: 'myLockBtn',        // 省略可（自動でボタンを作る）
 *       unlockSequence: 'asobiseminar',   // 省略可
 *       offSequence: 'off',               // 省略可
 *       enterCountRequired: 3,            // 省略可
 *       onLock: () => {},                 // コールバック
 *       onUnlock: () => {},
 *       onAlertStart: () => {},
 *       onAlertStop: () => {}
 *     });
 *   </script>
 *
 * または既存のボタンを使う場合:
 *   <button id="lockBtn">🔒</button>
 *   LockSystem.init({ audioSrc: '...' });
 */

(function (global) {
  'use strict';

  const DEFAULTS = {
    audioSrc: './alert.mp3',
    unlockSequence: 'asobiseminar',
    offSequence: 'off',
    enterCountRequired: 3,
    lockButtonId: 'lockBtn',
    overlayId: 'lock-overlay',
    // マウス操作とみなすイベント
    mouseEvents: [
      'mousedown',
      'mouseup',
      'click',
      'dblclick',
      'mousemove',
      'mouseenter',
      'mouseleave',
      'contextmenu',
      'wheel',
      'pointerdown',
      'pointermove'
    ]
  };

  let options = {};
  let isLocked = false;
  let isAlerting = false;
  let audio = null;

  // シーケンス用バッファ
  let unlockBuffer = '';
  let unlockEnterCount = 0;
  let unlockPhase = 'typing'; // 'typing' | 'enters'

  let offBuffer = '';
  let offEnterCount = 0;
  let offPhase = 'typing'; // 'typing' | 'enters'

  // リスナー参照（解除用）
  let keydownHandler = null;
  let mouseHandlers = [];

  /**
   * 初期化
   * @param {Object} userOptions
   */
  function init(userOptions = {}) {
    options = Object.assign({}, DEFAULTS, userOptions);

    // オーディオ準備
    if (options.audioSrc) {
      audio = new Audio(options.audioSrc);
      audio.loop = true;
      audio.preload = 'auto';
      // エラー時のフォールバック表示
      audio.addEventListener('error', () => {
        console.warn('[LockSystem] 音声ファイルを読み込めませんでした:', options.audioSrc);
        console.warn('lock/ フォルダに alert.mp3 を置くか、audioSrc オプションを指定してください。');
      });
    }

    // ロックボタンを確保
    ensureLockButton();

    // オーバーレイを事前作成（非表示）
    ensureOverlay();

    console.log('[LockSystem] initialized');
  }

  /**
   * ロックボタンを作成または既存のものを利用
   */
  function ensureLockButton() {
    let btn = document.getElementById(options.lockButtonId);

    if (!btn) {
      btn = document.createElement('button');
      btn.id = options.lockButtonId;
      btn.type = 'button';
      btn.textContent = '🔒';
      btn.setAttribute('aria-label', 'ロック開始');
      btn.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        z-index: 9998;
        font-size: 28px;
        width: 56px;
        height: 56px;
        border-radius: 50%;
        border: none;
        background: #1a1a1a;
        color: #fff;
        cursor: pointer;
        box-shadow: 0 4px 12px rgba(0,0,0,0.3);
        transition: transform 0.15s, background 0.15s;
      `;
      btn.addEventListener('mouseenter', () => {
        btn.style.transform = 'scale(1.08)';
        btn.style.background = '#333';
      });
      btn.addEventListener('mouseleave', () => {
        btn.style.transform = 'scale(1)';
        btn.style.background = '#1a1a1a';
      });
      document.body.appendChild(btn);
    }

    // 既存でも新規でもクリックでロック開始
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (!isLocked) {
        startLock();
      }
    });
  }

  /**
   * フルスクリーンオーバーレイを作成
   */
  function ensureOverlay() {
    let overlay = document.getElementById(options.overlayId);
    if (overlay) return overlay;

    overlay = document.createElement('div');
    overlay.id = options.overlayId;
    overlay.style.cssText = `
      display: none;
      position: fixed;
      inset: 0;
      z-index: 9999;
      background: rgba(0, 0, 0, 0.88);
      color: #fff;
      font-family: system-ui, -apple-system, sans-serif;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      text-align: center;
      user-select: none;
      -webkit-user-select: none;
    `;

    overlay.innerHTML = `
      <div style="font-size: 64px; margin-bottom: 16px;">🔒</div>
      <div style="font-size: 28px; font-weight: 600; letter-spacing: 0.05em;">LOCKED</div>
      <div id="lock-status" style="margin-top: 24px; font-size: 14px; opacity: 0.7; max-width: 320px; line-height: 1.5;">
        解除するには正しいシーケンスを入力してください
      </div>
      <div id="lock-alert-indicator" style="display:none; margin-top: 32px; color: #ff6b6b; font-size: 15px;">
        ⚠ アラート再生中 — 「off」+ Enter×3 で停止
      </div>
    `;

    document.body.appendChild(overlay);
    return overlay;
  }

  /**
   * ロック開始
   */
  function startLock() {
    if (isLocked) return;

    isLocked = true;
    isAlerting = false;
    resetUnlockState();
    resetOffState();

    const overlay = ensureOverlay();
    overlay.style.display = 'flex';

    // スクロール防止
    document.body.style.overflow = 'hidden';

    // キーボード監視
    keydownHandler = handleKeydown;
    window.addEventListener('keydown', keydownHandler, true);

    // マウス操作監視（アラート用）
    mouseHandlers = [];
    options.mouseEvents.forEach((evtName) => {
      const handler = (e) => {
        // オーバーレイ上の操作も含めて感知
        if (isLocked && !isAlerting) {
          startAlert();
        }
      };
      // capture で確実に拾う
      window.addEventListener(evtName, handler, true);
      mouseHandlers.push({ evtName, handler });
    });

    updateStatus('解除シーケンスを入力してください');

    if (typeof options.onLock === 'function') {
      options.onLock();
    }

    console.log('[LockSystem] locked');
  }

  /**
   * ロック解除
   */
  function unlock() {
    if (!isLocked) return;

    stopAlert();

    isLocked = false;
    resetUnlockState();
    resetOffState();

    const overlay = document.getElementById(options.overlayId);
    if (overlay) {
      overlay.style.display = 'none';
    }

    document.body.style.overflow = '';

    // リスナー解除
    if (keydownHandler) {
      window.removeEventListener('keydown', keydownHandler, true);
      keydownHandler = null;
    }
    mouseHandlers.forEach(({ evtName, handler }) => {
      window.removeEventListener(evtName, handler, true);
    });
    mouseHandlers = [];

    if (typeof options.onUnlock === 'function') {
      options.onUnlock();
    }

    console.log('[LockSystem] unlocked');
  }

  /**
   * アラート開始（ループ再生）
   */
  function startAlert() {
    if (isAlerting || !isLocked) return;

    isAlerting = true;

    if (audio) {
      audio.currentTime = 0;
      const playPromise = audio.play();
      if (playPromise && typeof playPromise.catch === 'function') {
        playPromise.catch((err) => {
          console.warn('[LockSystem] 音声再生に失敗しました（ユーザー操作が必要な場合があります）:', err);
        });
      }
    } else {
      console.warn('[LockSystem] audioSrc が設定されていません');
    }

    const indicator = document.getElementById('lock-alert-indicator');
    if (indicator) indicator.style.display = 'block';

    updateStatus('アラート中 — 「off」を入力して Enter を3回');

    if (typeof options.onAlertStart === 'function') {
      options.onAlertStart();
    }

    console.log('[LockSystem] alert started');
  }

  /**
   * アラート停止
   */
  function stopAlert() {
    if (!isAlerting) return;

    isAlerting = false;

    if (audio) {
      audio.pause();
      audio.currentTime = 0;
    }

    const indicator = document.getElementById('lock-alert-indicator');
    if (indicator) indicator.style.display = 'none';

    if (isLocked) {
      updateStatus('解除シーケンスを入力してください');
    }

    resetOffState();

    if (typeof options.onAlertStop === 'function') {
      options.onAlertStop();
    }

    console.log('[LockSystem] alert stopped');
  }

  /**
   * キー入力ハンドラ（capture phase）
   */
  function handleKeydown(e) {
    if (!isLocked) return;

    // ブラウザのデフォルト動作をある程度抑制
    // （特にスペースや矢印でのスクロールなど）
    if ([' ', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab'].includes(e.key)) {
      e.preventDefault();
    }

    const key = e.key;

    // ---- アラート中は off シーケンスを優先 ----
    if (isAlerting) {
      processOffSequence(key, e);
      return;
    }

    // ---- 通常ロック中は unlock シーケンス ----
    processUnlockSequence(key, e);
  }

  /**
   * 解除シーケンス処理
   * 「asobiseminar」→ Enter ×3
   */
  function processUnlockSequence(key, e) {
    if (unlockPhase === 'typing') {
      const expected = options.unlockSequence;
      const nextChar = expected[unlockBuffer.length];

      if (key.length === 1 && key.toLowerCase() === nextChar) {
        // 正しい文字
        unlockBuffer += key.toLowerCase();
        e.preventDefault();

        if (unlockBuffer === expected) {
          // 全文一致 → Enter待ちへ
          unlockPhase = 'enters';
          unlockEnterCount = 0;
          updateStatus('Enter を 3 回押してください');
        } else {
          updateStatus(`入力中... (${unlockBuffer.length}/${expected.length})`);
        }
      } else if (key === 'Enter' || key === 'Backspace' || key === 'Escape') {
        // 途中の特殊キーはリセット
        resetUnlockState();
        updateStatus('解除シーケンスを入力してください');
      } else if (key.length === 1) {
        // 間違った文字 → リセット
        resetUnlockState();
        updateStatus('解除シーケンスを入力してください');
      }
      // その他のキー（Shiftなど）は無視
    } else if (unlockPhase === 'enters') {
      if (key === 'Enter') {
        e.preventDefault();
        unlockEnterCount += 1;
        updateStatus(`Enter ${unlockEnterCount} / ${options.enterCountRequired}`);

        if (unlockEnterCount >= options.enterCountRequired) {
          unlock();
        }
      } else {
        // Enter以外が来たら最初から
        resetUnlockState();
        updateStatus('解除シーケンスを入力してください');
      }
    }
  }

  /**
   * アラート停止シーケンス処理
   * 「off」→ Enter ×3
   */
  function processOffSequence(key, e) {
    if (offPhase === 'typing') {
      const expected = options.offSequence;
      const nextChar = expected[offBuffer.length];

      if (key.length === 1 && key.toLowerCase() === nextChar) {
        offBuffer += key.toLowerCase();
        e.preventDefault();

        if (offBuffer === expected) {
          offPhase = 'enters';
          offEnterCount = 0;
          updateStatus('アラート停止: Enter を 3 回');
        } else {
          updateStatus(`off 入力中... (${offBuffer.length}/${expected.length})`);
        }
      } else if (key === 'Enter' || key === 'Backspace' || key === 'Escape') {
        resetOffState();
        updateStatus('アラート中 — 「off」を入力して Enter を3回');
      } else if (key.length === 1) {
        resetOffState();
        updateStatus('アラート中 — 「off」を入力して Enter を3回');
      }
    } else if (offPhase === 'enters') {
      if (key === 'Enter') {
        e.preventDefault();
        offEnterCount += 1;
        updateStatus(`アラート停止 Enter ${offEnterCount} / ${options.enterCountRequired}`);

        if (offEnterCount >= options.enterCountRequired) {
          stopAlert();
          // アラートだけ止め、ロックは継続
          updateStatus('解除シーケンスを入力してください');
        }
      } else {
        resetOffState();
        updateStatus('アラート中 — 「off」を入力して Enter を3回');
      }
    }
  }

  function resetUnlockState() {
    unlockBuffer = '';
    unlockEnterCount = 0;
    unlockPhase = 'typing';
  }

  function resetOffState() {
    offBuffer = '';
    offEnterCount = 0;
    offPhase = 'typing';
  }

  function updateStatus(text) {
    const el = document.getElementById('lock-status');
    if (el) el.textContent = text;
  }

  // 公開API
  const LockSystem = {
    init,
    startLock,
    unlock,
    startAlert,
    stopAlert,
    isLocked: () => isLocked,
    isAlerting: () => isAlerting,
    // デバッグ用
    getState: () => ({
      isLocked,
      isAlerting,
      unlockBuffer,
      unlockEnterCount,
      unlockPhase,
      offBuffer,
      offEnterCount,
      offPhase
    })
  };

  // グローバルに公開
  global.LockSystem = LockSystem;

})(typeof window !== 'undefined' ? window : this);
