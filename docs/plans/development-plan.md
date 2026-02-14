# 開発計画（Issue #1 対応）

## 1. 文書メタ

- 文書ID: `AW-PLAN-001`
- 版: `v0.1`
- 作成日: `2026-02-14`
- 参照Issue: `#1`（仕様）, `#2`（実行環境）

## 2. 目的

- Approval Workflow Service の最小実装を段階的に開発し、Issue #1 の受入基準（AW-ACC-01〜04）を満たす。
- 開発プロセス全体で `ae-framework` を適用し、仕様・検証・中間生成物の追跡性を検証する。

## 3. 前提条件

- 実行環境:
  - Codex CLI: `0.101.0`
  - Model: `gpt-5.3-codex`
- ae-framework 側の前提:
  - Node.js `>=20.11 <23`
  - pnpm `10.x`
  - GitHub Actions 利用
- 仕様正本は Issue #1 とし、ドキュメント側は仕様との差分管理を行う。

## 4. 開発フェーズ

| フェーズ | 目的 | 主な成果物 | 完了条件 |
| --- | --- | --- | --- |
| Phase 0: 初期化 | 計画・運用ルール確定 | 本計画、ツール利用仕様、保存仕様 | 計画文書が main に反映済み |
| Phase 1: 契約/状態遷移定義 | API と状態遷移を機械可読化 | `contracts/openapi.yaml`, `spec/state-machine.md`, `schema/*.json` | submit/decide 系の契約が定義済み |
| Phase 2: 最小実装 | Request/Task/Workflow の基本フロー実装 | `src/` 実装, `tests/unit/` | DRAFT→SUBMITTED→IN_REVIEW→終端が通る |
| Phase 3: 競合・検証強化 | ANY/ALL 同時決裁の安全性検証 | `spec/formal/*`, `tests/property/*`, `tests/mutation/*` | AW-ACC-01/02/03 の自動検証が成立 |
| Phase 4: 監査・運用整備 | AuditLog と運用観点の確立 | `tests/integration/*`, `artifacts/*`, 運用手順 | AW-ACC-04 を含む受入判定が可能 |

## 5. タスク分解（初回）

1. 仕様分解:
- Issue #1 から要求ID（AW-REQ/AW-WF/AW-TASK/AW-INV/AW-ACC）を抽出し、実装トレーサビリティ表を作成する。
2. データモデル:
- `ApprovalRequest`, `WorkflowDefinition`, `ApprovalTask`, `AuditLog` を最小スキーマで定義する。
3. API契約:
- `POST /requests/{id}/submit`, `POST /tasks/{id}/decide` を最優先で契約化する。
4. 検証基盤:
- ae-framework の `spec`, `conformance`, `formal`, `property`, `mutation`, `verify-lite` を順次有効化する。
5. CI自動化:
- PR時に軽量ゲート、手動/夜間で重め検証を実行する。

## 6. リスクと対策

| リスク | 影響 | 対策 |
| --- | --- | --- |
| 仕様拡張が早期に発生 | 設計手戻り | Issue #1 を正本とし、変更は Issue + 文書差分で先に固定 |
| 同時決裁の競合不具合 | 受入基準未達 | formal/property を Phase 3 で必須化 |
| 中間生成物の散逸 | ae-framework 評価不可 | `docs/specs/artifact-retention-spec.md` に従い Git 管理 |
| 検証コスト過多 | 進捗停滞 | PRは軽量ゲート中心、重検証はバッチ化 |

## 7. 完了判定（Definition of Done）

- AW-ACC-01〜04 が自動テストと検証レポートで確認できる。
- 実装、仕様、検証成果物の参照関係が GitHub 上で追跡できる。
- 中間生成物を含む実行証跡が本リポジトリに保存されている。

## 8. 進捗（2026-02-14）

- 完了:
  - Phase 1 の主要成果物を追加（`contracts/openapi.yaml`, `spec/approval-workflow.md`, `schema/*.json`）。
  - Phase 2 として状態遷移エンジンを実装（`src/domain/engine.ts`）。
  - AW-ACC-01〜04 を受入テスト化（ドメイン + API統合）し、`vitest` で全件成功。
  - ae-framework の `dev-fast`, `pr-gate`, `nightly-deep`, `full` を実行し、証跡を `artifacts/runs/*` に保存。
  - conformance は `rule-ids` 指定でサービス固有ルールに限定し、`overall=PASS` を確認。
  - formal はサービス固有モデルで `TLA/CSP` とも `status=ran` を確認。
  - MBTテストを追加（`tests/mbt/approval-engine.mbt.test.ts`）し、`pr-gate/full` に統合。
- 継続タスク:
  - `RETURN/resubmit` を含む状態遷移拡張と、UI最小実装の段階着手。
