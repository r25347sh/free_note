# QuizAI (Light)

**軽量版** — Screen Capture API + Tesseract.js OCR + 小型 WebLLM テキストモデル。

重い Vision モデル (Phi-3.5 ~4GB) をやめ、OCR → 小型LLM に変更しました。  
クラッシュ / 強制リロードが起きにくくなっています。

## 構成

| 層 | 技術 | 目安サイズ |
|----|------|------------|
| 画面取得 | Screen Capture API (`getDisplayMedia`) | — |
| 文字認識 | Tesseract.js (jpn+eng) | ~数十MB |
| 解答生成 | WebLLM テキストモデル | 200–700 MB |

## モデル選択

- **SmolLM2 360M** … 最軽量・推奨
- Qwen2.5 0.5B
- Llama 3.2 1B
- TinyLlama 1.1B

## 使い方

```bash
cd QuizAI
npx serve .
```

1. Load Model（初回のみダウンロード）
2. Start Screen Share → 問題ウィンドウを選択
3. 解答生成 (Solve) または `Ctrl/Cmd+Enter`
4. Answer に正解のみ表示（`<p>`）

## ファイル

- `index.html` / `style.css` / `script.js`

## 注意

- OCR 精度は画面の解像度・フォントに依存します
- 日本語が薄く見える場合は共有ウィンドウを大きくしてください
- 試験での不正利用は避けてください
