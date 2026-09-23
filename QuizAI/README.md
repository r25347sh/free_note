# QuizAI

Screen-share powered quiz solver using **WebLLM** (local Vision-Language Model) + **Screen Capture API** (`getDisplayMedia`).

## Features

- 画面共有: Screen Capture API (`navigator.mediaDevices.getDisplayMedia`)
- 共有画面から問題 + 選択肢 / 入力欄を認識
- VLM が問題と正解を判別
- **出力は正解の選択肢 / 入力語のみ** (`<p>` タグのみ)
- 完全クライアントサイド・プライバシー重視 (データは端末外に出ない)
- WebGPU 加速

## 対応問題形式

- 4択など複数選択 (例: 「炎症」→ inflammation / flatter / inflict / plantation)
- 入力式 (例: 「重大な」→ 入力欄)
- 文章穴埋め (文法確認テスト)

## 使い方

1. ローカルサーバーで開く (ES modules のため必須)

```bash
cd QuizAI
npx serve .
# または
python -m http.server 8080
```

2. Chrome 124+ (WebGPU 推奨) でアクセス
3. **Load Model** → 初回は 2–4 GB 程度のモデルをダウンロード (以降はキャッシュ)
4. **Start Screen Share** → 問題が表示されているウィンドウ / タブを選択
5. 問題画面がプレビューに映ったら **解答生成 (Solve)**
6. Answer パネルに正解のみ表示

ショートカット: `Ctrl + Enter` / `Cmd + Enter` で解答生成

## 技術構成

| ファイル     | 役割                          |
|--------------|-------------------------------|
| `index.html` | 構造                          |
| `style.css`  | 見た目 (ダーク・性能重視)     |
| `script.js`  | ロジック (WebLLM + Screen Capture API) |

- Runtime: `@mlc-ai/web-llm` (esm.run CDN)
- Default model: `Phi-3.5-vision-instruct-q4f16_1-MLC`
- 画像は JPEG 圧縮 + 長辺 1280px にリサイズしてトークン・メモリを抑制

## 注意

- 初回モデルロードに時間がかかります
- VRAM 目安: q4f16 で約 4 GB
- 精度はプロンプトとモデルに依存します。必要に応じて temperature や max_tokens を調整してください
- 試験・課題での不正利用は避けてください

## License

MIT (本プロジェクトコード)。モデルは各 Hugging Face / MLC のライセンスに従います。
