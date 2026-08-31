# FE_B_exam — 擬似言語 練習IDE

基本情報技術者試験・応用情報技術者試験で使われる **IPA擬似言語** の練習用エディタ＆実行環境です。

## 使い方

1. [index.html](https://r25347sh.github.io/free_note/FE_B_exam/) を開く（GitHub Pagesが有効な場合）またはローカルで開く
2. エディタに擬似言語を書く
3. 「▶ 実行」または Ctrl+Enter で実行
4. 出力タブ・変数タブで結果を確認
5. サンプルから選んで試す

## 対応している主な記法

- 変数宣言: `整数型: x ← 10`
- 代入: `x ← x ＋ 1`
- if / elseif / else / endif
- while / endwhile
- do / while
- for (i を 1 から n まで 1 ずつ増やす) / endfor
- 配列: `{1,2,3}` , `a[1]`（1始まり）
- 関数: `○整数型: fact(整数型: n) ... return`
- 組込み: `writeLine(値)`, `要素数(配列)`

演算子: `＋ － × ÷ mod ＝ ≠ ＜ ＞ ≦ ≧ and or not`

## 注意

試験の正式な仕様を完全に再現したものではなく、学習・トレース練習用の近似実装です。問題文の注記が優先されます。

ディレクトリ: `FE_B_exam`
