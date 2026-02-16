# 開発計画（Issue #1 対応）

## 1. 文書メタ

- 文書ID: `AW-PLAN-001`
- 版: `v0.1`
- 作成日: `2026-02-14`
- 参照Issue: `#1`（仕様）, `#2`（実行環境）, `itdojp/ae-framework#1967`（BIZ_001）

## 2. 目的

- Approval Workflow Service の最小実装を段階的に開発し、Issue #1 の受入基準（AW-ACC-01〜04）を満たす。
- 開発プロセス全体で `ae-framework` を適用し、仕様・検証・中間生成物の追跡性を検証する。

## 3. 前提条件

- 実行環境:
  - Codex CLI: `0.101.0`
  - Model: `gpt-5.3-codex`
- ae-framework 側の前提:
  - 利用ref固定: `b68a4014f2827db300cae1f50fa4e1ee17998cab`
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
  - 要求ID（AW-REQ/AW-WF/AW-TASK/AW-INV/AW-AUTH/AW-AUD/AW-ACC）のトレーサビリティ表を作成（`docs/specs/requirements-traceability.md`）。
  - Phase 1 の主要成果物を追加（`contracts/openapi.yaml`, `spec/approval-workflow.md`, `schema/*.json`）。
  - Phase 2 として状態遷移エンジンを実装（`src/domain/engine.ts`）。
  - AW-ACC-01〜04 を受入テスト化（ドメイン + API統合）し、`vitest` で全件成功。
  - ae-framework の `dev-fast`, `pr-gate`, `nightly-deep`, `full` を実行し、証跡を `artifacts/runs/*` に保存。
  - conformance は `rule-ids` 指定でサービス固有ルールに限定し、`overall=PASS` を確認。
  - formal はサービス固有モデルで `TLA/CSP` とも `status=ran` を確認。
  - MBTテストを追加（`tests/mbt/approval-engine.mbt.test.ts`）し、`pr-gate/full` に統合。
  - 申請編集APIを追加（`PATCH /requests/{requestId}`）し、DRAFT/RETURNED のみ編集可を実装・検証。
  - `RETURN` 決裁と `RETURNED -> submit(resubmit)` を実装し、受入/API/MBTで検証。
  - 最小UI（`/ui/`）を追加し、申請一覧/作成編集提出/承認受箱/決裁を1画面で操作可能化。
  - `AW-WF-002`（priority選択）と `AW-WF-010`（approver未解決時422）を受入/APIテストで追加検証。
  - `AW-AUTH-001`（request閲覧の可視性）と `AW-TENANT-001`（cross-tenant 403）を受入/APIテストで追加検証。
  - conformance ルールを式ベースへ更新し、`RequestVisibilityScope` と `TenantIsolationGuard` を追加（rule-id 4件運用）。
  - mutation対象を9系統へ拡張し（request閲覧ガード・tenant分離ガードを追加）、score=1.0を維持。
  - `verify-lite` 証跡ハーネスを追加（`scripts/testing/verify-lite-harness.mjs`）し、`artifacts/verify-lite/summary.json` を自動生成。
  - conformance 異常系ハーネスを追加（`scripts/testing/conformance-negative-harness.mjs`）し、`artifacts/conformance/negative-summary.json` を生成。
  - conformance 異常系ハーネスを並列化（`CONF_NEG_CONCURRENCY`、既定2）し、`pr-gate` の待ち時間を短縮。
  - `run.sh` のプロファイルを修正し、`dev-fast/pr-gate/full` で `verify-lite` を必ず実行。
  - GitHub Actions を追加し、`pr-gate.yml`（PR/Push）と `nightly-deep.yml`（schedule/manual）を自動実行化。
  - `full-regression.yml`（weekly/manual）を追加し、`full` プロファイルの定期総合回帰と生成物保存を自動実行化。
  - CIの生成物保存を `scripts/ci/persist-artifacts.sh` へ共通化し、push競合時の保存失敗を再試行で吸収するようにした。
  - GitHub Actions 実行後に `artifacts/` と `.ae/` を自動コミット保存するステップを導入し、CI由来の中間生成物を main へ保存する運用へ変更。
  - `scripts/ae/run.sh` の run完了時に `artifacts/runs/<run-id>/snapshots/` へ主要成果物を自動複製し、run単位での再現性を強化。
  - `scripts/testing/trend-report.mjs` を追加し、`nightly-deep/full` 実行後に `artifacts/trends/summary.json` を自動生成するようにした。
  - `scripts/testing/run-artifact-audit.mjs` を追加し、各run終了時に `artifacts/runs/<run-id>/audit.json` で成果物欠落を自動監査するようにした。
  - `scripts/testing/run-index-report.mjs` を追加し、各run終了時に `artifacts/runs/index.json` / `artifacts/runs/index.md` を自動更新して run横断の監査・参照を可能にした。
  - `.gitignore` の `*.log` 除外を見直し、`artifacts/runs/<run-id>/logs/*.log` をGit保存対象へ変更した。
  - `spec lint` warning を fail-fast でゲート化する `spec-lint-warning-gate` を追加し、fixed ref 基準で `SPEC_LINT_MAX_WARNINGS=3` を既定運用にした。
  - `pr-gate` / `nightly-deep` で参照する `ae-framework` を `configs/ae-framework/ref.txt` の固定SHA checkoutへ変更した。
  - `pr-gate` / `nightly-deep` の `ae-framework` 依存導入は互換性のため `--no-frozen-lockfile` を維持し、非意図改変は `ae-framework-ref-guard` で検知する運用へ整理した。
  - `ae-framework-ref-guard` を追加し、run開始時に fixed ref 実使用を fail-fast 検証するようにした（SHA一致 + `ae-framework` 作業ツリーの tracked 変更なし）。
  - `scripts/testing/framework-gap-status.mjs` と `configs/framework-gaps/issues.json` を追加し、upstreamギャップIssue状態を `artifacts/framework-gaps/status.json` として nightly/full で定期取得するようにした。
  - framework gap status に `revalidationRequired` 判定を追加し、upstream issue が close された際の再検証要否を機械判定できるようにした。
  - `BIZ_001` 警告ギャップを `ae-framework` 本体 Issue `#1967` として起票した。
  - `itdojp/ae-framework#1967` close を確認したが、評価整合のため fixed ref 継続方針とし、`BIZ_001` は fixed ref 既知差分として管理する運用に切り替えた。

## 9. 進捗（2026-02-16）

- 完了:
  - `AW-REQ-002`（submit必須項目）, `AW-WF-003`（workflow固定）, `AW-AUD-001`（withdraw/cancel監査）の不足分を実装・受入/APIテストで補完した。
  - `docs/specs/requirements-traceability.md` を更新し、Issue #1 要求IDの判定を `達成` に整理した。
  - fixed ref のクリーンコピーを用いて `RUN_ID=2026-02-16-full-specfit-r1` で `bash scripts/ae/run.sh full` を実行し、全フェーズ完走を確認した。
  - 有用性評価レポート `docs/reports/ae-framework-usefulness-evaluation.md` を作成し、証跡ファイルを根拠に判定を記録した。
