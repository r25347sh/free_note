/**
 * FE_B_exam 擬似言語 IDE フロントエンド
 */

let editor;
let interpreter;
let lastResult = null;

document.addEventListener('DOMContentLoaded', () => {
  // CodeMirror 初期化
  editor = CodeMirror.fromTextArea(document.getElementById('code-editor'), {
    mode: 'javascript', // 近似ハイライト
    theme: 'dracula',
    lineNumbers: true,
    indentUnit: 2,
    tabSize: 2,
    lineWrapping: true,
    extraKeys: {
      'Ctrl-Enter': runCode,
      'Cmd-Enter': runCode
    }
  });

  // 初期サンプル
  editor.setValue(SAMPLES.sum);

  // イベント
  document.getElementById('btn-run').addEventListener('click', runCode);
  document.getElementById('btn-step').addEventListener('click', () => {
    alert('ステップ実行は今後の拡張予定です。現在は一括実行のみ対応しています。');
  });
  document.getElementById('btn-clear-out').addEventListener('click', () => {
    document.getElementById('output').textContent = '';
  });
  document.getElementById('btn-reset').addEventListener('click', () => {
    if (interpreter) interpreter.reset();
    document.getElementById('vars-view').innerHTML = '<p class="info">変数はリセットされました</p>';
    document.getElementById('status').textContent = 'リセット完了';
  });
  document.getElementById('sample-select').addEventListener('change', (e) => {
    const key = e.target.value;
    if (key && SAMPLES[key]) {
      editor.setValue(SAMPLES[key]);
      e.target.value = '';
    }
  });
  document.getElementById('btn-help').addEventListener('click', () => {
    switchTab('ref');
  });

  // タブ切替
  document.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', () => switchTab(tab.dataset.tab));
  });

  setStatus('準備完了 — Ctrl+Enter で実行');
});

function switchTab(name) {
  document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.tab === name));
  document.querySelectorAll('.tab-content').forEach(c => {
    c.classList.toggle('hidden', c.id !== 'tab-' + name);
  });
}

function setStatus(msg) {
  document.getElementById('status').textContent = msg;
}

function runCode() {
  const source = editor.getValue();
  const outEl = document.getElementById('output');
  outEl.innerHTML = '';
  setStatus('実行中…');

  interpreter = new PseudoInterpreter({ maxSteps: 50000 });
  const result = interpreter.execute(source);
  lastResult = result;

  // 出力描画
  if (result.output.length === 0 && !result.error) {
    outEl.innerHTML = '<span class="info">（出力なし）</span>';
  } else {
    result.output.forEach(item => {
      const span = document.createElement('div');
      span.className = item.type;
      span.textContent = item.msg;
      outEl.appendChild(span);
    });
  }

  // 変数表示
  renderVars(result.vars);

  if (result.error) {
    setStatus('エラー発生');
    switchTab('output');
  } else {
    setStatus(`実行完了（${result.steps} ステップ）`);
    switchTab('output');
  }
}

function renderVars(varsMap) {
  const el = document.getElementById('vars-view');
  if (!varsMap || varsMap.size === 0) {
    el.innerHTML = '<p class="info">変数はありません</p>';
    return;
  }
  let html = '';
  for (const [name, info] of varsMap) {
    let valStr;
    if (info.value === undefined) valStr = '未定義';
    else if (Array.isArray(info.value)) valStr = JSON.stringify(info.value);
    else if (typeof info.value === 'string') valStr = `"${info.value}"`;
    else valStr = String(info.value);

    html += `<div class="var-row">
      <span class="var-name">${escapeHtml(name)}</span>
      <span class="var-type">${escapeHtml(info.type || '')}</span>
      <span class="var-value">${escapeHtml(valStr)}</span>
    </div>`;
  }
  el.innerHTML = html;
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
