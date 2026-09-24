# QuizAI v3 — Gemini Flash

画面共有 → スクショを **Gemini 2.0 Flash（無料）** に送って正解だけ返す。

## なぜ v3 か

| 版 | 方式 | 問題 |
|----|------|------|
| v1 | WebLLM Vision ~4GB | クラッシュ |
| v2 | OCR + 小型LLM | 誤答・17秒・重い |
| **v3** | **Gemini Flash 画像直接** | 速い・正確・軽い |

## セットアップ（完全無料）

1. [Google AI Studio](https://aistudio.google.com/apikey) で API キー発行（クレカ不要）
2. サイトでキーを貼って **Save Key**（localStorage のみ・サーバーに送らない）
3. **Start Screen Share** → 問題ウィンドウを選択
4. **解答生成** または `Ctrl/Cmd+Enter`

## 技術

- Screen Capture API (`getDisplayMedia`)
- 画像を JPEG でキャプチャ → Gemini 2.0 Flash `generateContent`
- 出力は正解ワードのみ（`<p>`）

## 注意

- 無料枠のレート制限あり（通常のクイズ用途では十分なことが多い）
- 試験での不正利用はしないこと
