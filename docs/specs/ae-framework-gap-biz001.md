# ae-framework Gap: `BIZ_001` 警告（解消記録）

## 1. 背景

- 対象: `ae-framework` の `spec validate` / `spec lint`
- 識別子: `BIZ_001`
- 起票: <https://github.com/itdojp/ae-framework/issues/1967>

## 2. 過去の観測（2026-02-14）

- `spec/approval-workflow.md` に `Business Rules` を記述しても、以下警告が継続発生していた。
  - `Entity 'ApprovalRequest' has no business rules defined`
  - `Entity 'ApprovalTask' has no business rules defined`
  - `Entity 'WorkflowDefinition' has no business rules defined`
- 当時は本ギャップを known gap として扱い、他検証（conformance/mbt/property/formal/mutation）を継続していた。

## 3. 現在の状態（2026-02-15）

- upstream issue `itdojp/ae-framework#1967` は `closed`。
- 本リポジトリの再検証結果:
  - run-id: `2026-02-15-pr-gate-ci-13`
  - `spec-validate.log`: Warnings `0`
  - `spec-lint.log`: Warnings `0`
- 判定: `BIZ_001` は本リポジトリ観点で解消確認済み。

## 4. 運用ルール

- `configs/framework-gaps/issues.json` で以下を管理する。
  - `revalidatedAtRunId`
  - `revalidatedAt`
  - `resolutionNote`
- `scripts/testing/framework-gap-status.mjs` は upstream issue が close かつ `revalidatedAtRunId` 未設定の場合に
  `revalidationRequired=true` を返す。

