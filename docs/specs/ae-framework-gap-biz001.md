# ae-framework ギャップ記録（BIZ_001）

## 概要

`ae spec validate/lint` 実行時に、`BIZ_001`（Entity has no business rules）が継続して3件出力される。

## 再現条件

- 対象: `spec/approval-workflow.md`
- コマンド:
  - `AE_FRAMEWORK_DIR=../ae-framework bash scripts/ae/run.sh dev-fast`
  - または `pnpm --dir ../ae-framework exec tsx src/cli/index.ts spec validate -i spec/approval-workflow.md`

## 技術的根拠

`ae-framework` の `spec-compiler` 実装（2026-02-14 時点）で以下を確認:

1. `parseInvariants` が Markdown から invariant を生成する際、`entities` を常に空配列で生成する。
2. `validateBusinessLogic` は `invariants[].entities` に entity 名が含まれるかのみで `BIZ_001` を判定する。
3. strict schema は `invariants[].entities` に最低1件を要求する。

結果として、現行 parser のままでは Markdown 記述だけで `BIZ_001` を消し込めない。

## 期待される改善方向（framework側）

1. Invariant記法に entity 紐付け構文を追加し parser で `entities` を埋める。
2. または parser 側で description から entity 名を抽出して `entities` を補完する。
3. strict schema と parser 仕様の整合を取る（生成される invariant が strict schema を満たすこと）。
