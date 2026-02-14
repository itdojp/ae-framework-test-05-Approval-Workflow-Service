# Approval Workflow Service

本リポジトリは、Issue #1 の仕様に基づく Approval Workflow Service の実装と、`ae-framework` の有用性検証を同時に行うための開発リポジトリ。

## 参照

- 仕様（正本）: <https://github.com/itdojp/ae-framework-test-05-Approval-Workflow-Service/issues/1>
- 開発開始時の実行環境: <https://github.com/itdojp/ae-framework-test-05-Approval-Workflow-Service/issues/2>
- 開発計画: `docs/plans/development-plan.md`
- ae-framework 利用仕様: `docs/specs/ae-framework-tooling-spec.md`
- ae-framework ギャップ記録（BIZ_001）: `docs/specs/ae-framework-gap-biz001.md`
- 中間生成物保存仕様: `docs/specs/artifact-retention-spec.md`
- 自動実行設定: `codex/ae.playbook.yaml`, `scripts/ae/run.sh`

## 実装（Phase 1/2）

- ドメイン実装: `src/domain/engine.ts`
- API実装: `src/api/app.ts`
  - `PATCH /api/v1/requests/{requestId}`（DRAFT/RETURNED 編集）を含む
  - `POST /api/v1/tasks/{taskId}/decide` の `RETURN` 決裁を含む
- 最小UI: `src/ui/index.html`, `src/ui/app.js`, `src/ui/styles.css`
  - 配信先: `/ui/`（`/` は `/ui/` へリダイレクト）
- OpenAPI契約: `contracts/openapi.yaml`
- AE-Spec入力: `spec/approval-workflow.md`
- 受入基準テスト: `tests/acceptance/approval-engine.acceptance.test.ts`
- API統合テスト: `tests/integration/api.acceptance.test.ts`
- MBTテスト: `tests/mbt/approval-engine.mbt.test.ts`
- Propertyテスト: `tests/property/approval-engine.property.test.ts`
- Mutationクイック検証: `scripts/testing/mutation-quick.mjs`
- Formalモデル: `spec/formal/ApprovalAnyAll.tla`, `spec/formal/approval-any-all.cspm`

## 実行コマンド

```bash
pnpm install
pnpm run test
pnpm run build
pnpm run dev
pnpm run test:mbt
pnpm run test:property
pnpm run test:mutation:quick
```

`pnpm run dev` 後、`http://localhost:3000/ui/` で最小UIを利用可能。

ae-framework 連携（外部リポジトリ参照先を指定）:

```bash
AE_FRAMEWORK_DIR=../ae-framework bash scripts/ae/run.sh dev-fast
AE_FRAMEWORK_DIR=../ae-framework bash scripts/ae/run.sh pr-gate
AE_FRAMEWORK_DIR=../ae-framework bash scripts/ae/run.sh nightly-deep
AE_FRAMEWORK_DIR=../ae-framework bash scripts/ae/run.sh full
```

conformance は `configs/conformance/rule-ids.txt` で対象ルールを限定して実行する。
