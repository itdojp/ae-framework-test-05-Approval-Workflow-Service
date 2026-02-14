# Approval Workflow Service

本リポジトリは、Issue #1 の仕様に基づく Approval Workflow Service の実装と、`ae-framework` の有用性検証を同時に行うための開発リポジトリ。

## 参照

- 仕様（正本）: <https://github.com/itdojp/ae-framework-test-05-Approval-Workflow-Service/issues/1>
- 開発開始時の実行環境: <https://github.com/itdojp/ae-framework-test-05-Approval-Workflow-Service/issues/2>
- 開発計画: `docs/plans/development-plan.md`
- ae-framework 利用仕様: `docs/specs/ae-framework-tooling-spec.md`
- 中間生成物保存仕様: `docs/specs/artifact-retention-spec.md`
- 自動実行設定: `codex/ae.playbook.yaml`, `scripts/ae/run.sh`

## 実装（Phase 1/2）

- ドメイン実装: `src/domain/engine.ts`
- API実装: `src/api/app.ts`
- OpenAPI契約: `contracts/openapi.yaml`
- AE-Spec入力: `spec/approval-workflow.md`
- 受入基準テスト: `tests/acceptance/approval-engine.acceptance.test.ts`

## 実行コマンド

```bash
pnpm install
pnpm run test
pnpm run build
```

ae-framework 連携（外部リポジトリ参照先を指定）:

```bash
AE_FRAMEWORK_DIR=../ae-framework bash scripts/ae/run.sh dev-fast
AE_FRAMEWORK_DIR=../ae-framework bash scripts/ae/run.sh pr-gate
AE_FRAMEWORK_DIR=../ae-framework bash scripts/ae/run.sh nightly-deep
```
