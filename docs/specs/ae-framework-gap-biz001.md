# ae-framework Gap: `BIZ_001` 警告の恒常発生

## 1. 背景

- 対象: `ae-framework` の `spec validate` / `spec lint`
- 対象警告: `BIZ_001`（Entity に business rules が未定義）
- 観測日: `2026-02-14`

## 2. 観測結果

- 本リポジトリの `spec/approval-workflow.md` では `Business Rules` を定義しているが、以下警告が継続発生する。
  - `Entity 'ApprovalRequest' has no business rules defined`
  - `Entity 'ApprovalTask' has no business rules defined`
  - `Entity 'WorkflowDefinition' has no business rules defined`
- 再現 run-id:
  - `2026-02-14-full-r10`
  - `2026-02-14-full-r11`

## 3. 技術的観点（根拠）

- `ae-framework/packages/spec-compiler/src/compiler.ts` の `validateBusinessLogic` は、`invariants[].entities` に Entity 名が入っていることを前提に判定している。
- 同ファイル `parseInvariants` では `entities: []` 固定で生成しており、Markdown から Entity 参照を抽出していない。
- そのため、仕様側で `Business Rules` を追加しても `BIZ_001` が解消しない。

## 4. 暫定対応

- 本リポジトリでは `BIZ_001` を「frameworkギャップ」として記録し、他の検証（conformance/mbt/property/formal/mutation）を継続する。

## 5. 改善提案（ae-framework 側）

1. `parseInvariants` で Entity 名抽出を実装し、`invariants[].entities` を自動補完する。
2. もしくは `Business Rules` 章の `BR-*` 記述を `invariants` 相当にマッピングする。
3. いずれも難しい場合、`BIZ_001` メッセージを「Invariants section が必要」に変更して誤解を減らす。
