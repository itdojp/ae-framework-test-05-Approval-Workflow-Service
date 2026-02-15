# ae-framework Gap: `BIZ_001` 警告（fixed ref 運用）

## 1. 背景

- 対象: `ae-framework` の `spec validate` / `spec lint`
- 識別子: `BIZ_001`
- 起票: <https://github.com/itdojp/ae-framework/issues/1967>
- 固定利用 ref: `b68a4014f2827db300cae1f50fa4e1ee17998cab`

## 2. 過去の観測（2026-02-14）

- `spec/approval-workflow.md` に `Business Rules` を記述しても、以下警告が継続発生していた。
  - `Entity 'ApprovalRequest' has no business rules defined`
  - `Entity 'ApprovalTask' has no business rules defined`
  - `Entity 'WorkflowDefinition' has no business rules defined`
- 当時は本ギャップを known gap として扱い、他検証（conformance/mbt/property/formal/mutation）を継続していた。

## 3. 現在の状態（2026-02-15）

- upstream issue `itdojp/ae-framework#1967` は `closed`。
- ただし本リポジトリは ae-framework を fixed ref で継続利用する方針のため、upstream 変更は追従しない。
- fixed ref に対する運用値:
  - `expectedSpecLintWarnings`: `3`
  - `SPEC_LINT_MAX_WARNINGS`: `3`（既定）
- 判定: 本ギャップは「解消版への追従待ち」ではなく、「fixed ref の既知差分」として管理する。

## 4. 運用ルール

- `configs/framework-gaps/issues.json` で以下を管理する。
  - `trackingMode`（`fixed_ref`）
  - `frameworkRef`
  - `expectedSpecLintWarnings`
  - `resolutionNote`
- `scripts/testing/framework-gap-status.mjs` は `trackingMode=fixed_ref` の場合、
  upstream close 状態でも `revalidationRequired=false` / `recommendedAction=hold_fixed_ref` を返す。
