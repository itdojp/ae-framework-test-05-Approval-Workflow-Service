# ae-framework 利用仕様（参照用）

## 1. 文書メタ

- 文書ID: `AW-AE-TOOL-001`
- 版: `v0.5`
- 作成日: `2026-02-14`
- 対象: Approval Workflow Service（Issue #1）

## 2. 方針

- `ae-framework` を「仕様機械化」「検証自動化」「証跡集約」の3用途で利用する。
- 実行は可能な限り自動化し、手動操作は初期セットアップと障害解析に限定する。
- すべての中間生成物は本リポジトリ配下の `artifacts/` に保存し、GitHubへ反映する。

## 3. 前提バージョン

- ae-framework（参照元）: <https://github.com/itdojp/ae-framework>
- Node.js: `>=20.11 <23`
- pnpm: `10.x`

根拠:
- `ae-framework` の `README.md` と `docs/product/PRODUCT-FIT-INPUT-OUTPUT-TOOL-MAP.md`

## 4. 利用ツール選定

| 区分 | 利用コマンド | 目的 | 入力 | 出力（本リポジトリ保存先） | 実行タイミング |
| --- | --- | --- | --- | --- | --- |
| 仕様検証 | `ae spec validate` / `ae spec lint` | Issue仕様の機械可読化と静的検査 | `spec/*.md` | `.ae/ae-ir.json`, `artifacts/spec/*` | 各仕様更新時 |
| 契約生成 | `node scripts/spec/generate-contracts.mjs` | API契約の抽出 | `.ae/ae-ir.json` | `artifacts/contracts/contracts-summary.json`（補助出力として `artifacts/spec/contracts.json`） | API変更時 |
| Replay生成 | `node scripts/spec/generate-replay-fixtures.mjs` | 検証用入力固定化 | `contracts-summary.json` | `artifacts/domain/replay-fixtures.sample.json`（補助出力として `artifacts/spec/replay.json`） | 契約更新時 |
| Deterministic実行 | `node scripts/simulation/deterministic-runner.mjs` | 再現性確認 | `replay-fixtures.sample.json` | `artifacts/simulation/deterministic-summary.json`（補助出力として `artifacts/sim/sim.json`） | PR前 |
| 軽量ゲート | `pnpm run verify:lite:report` | lint/test/build の最小品質担保と結果保存 | 実装コード一式 | `artifacts/verify-lite/*` | PRごと |
| Conformance | `ae conformance verify` + `pnpm run test:conformance:negative` | ルール/スキーマ違反検出と異常系での fail 検証（title/amount + request可視性 + tenant分離） | 入力JSON + ルール | `artifacts/conformance/*` | API/ルール更新時 |
| MBT | `pnpm run test:mbt:quick` | 状態遷移モデル（12.1）の検証 | `tests/mbt/*` | `artifacts/mbt/*` | PRごと |
| Formal（重点） | `pnpm run verify:tla`, `pnpm run verify:csp` | 同時決裁競合（AW-ACC-01）の安全性検証 | `spec/formal/*` | `artifacts/formal/*` | 日次または手動 |
| Property | `pnpm run test:property` + `node scripts/testing/property-harness.mjs` | 不変条件（AW-INV）検証 | `tests/property/*` | `artifacts/properties/*` | PRごと |
| Mutation | `pnpm run test:mutation:quick` | テストの欠陥検知能力確認（ANY/ALL・終端ガード・assigneeガード・request閲覧ガード・tenant分離ガード・workflow priority・approver未解決・RETURN/resubmit） | 実装/テスト | `artifacts/mutation/*` | 週次 |
| Trend | `pnpm run trend:report` | run単位の品質推移集計（nightly/full） | `artifacts/runs/*/manifest.json`, `artifacts/runs/*/snapshots/**/*` | `artifacts/trends/summary.json` | nightly-deep/full |
| Framework Gap Status | `pnpm run framework:gaps:status` | upstream gap issue 状態の定期取得（BIZ_001 追跡） | `configs/framework-gaps/issues.json` | `artifacts/framework-gaps/status.json` | nightly-deep/full |
| Artifact Audit | `pnpm run artifacts:audit -- --run-id <id> --profile <profile>` | run単位成果物欠落の検知（fail-fast） | `artifacts/runs/<run-id>/` | `artifacts/runs/<run-id>/audit.json` | 各run終了時 |

## 5. 自動化ポリシー

1. ローカル自動化:
- Codex 実行は `approval_policy=never` を基準とする。
- 実行スクリプトは fail-fast（実装品質に直結）と report-only（重検証）を分離する。
2. CI自動化:
- PRトリガ: `pr-gate.yml`（`verify-lite + conformance + mbt + property`）
- main push: `pr-gate.yml` 実行後、`artifacts/` と `.ae/` の差分を自動コミットして保存する。
- 手動/定期トリガ: `nightly-deep.yml`（formal + mutation）を実行し、同様に差分を自動コミットする。
3. 証跡保存:
- 各ジョブで `actions/upload-artifact` により実行時点の成果物を保存する。
- `push(main)` / `schedule` / `workflow_dispatch` では `artifacts/` と `.ae/` の更新差分を main に保存する。

## 6. 実行プロファイル

| プロファイル | 対象 | 構成 |
| --- | --- | --- |
| `dev-fast` | 日常開発 | spec validate/lint, verify-lite |
| `pr-gate` | PR品質ゲート | verify-lite, conformance, mbt, property |
| `nightly-deep` | 深夜定期検証 | formal(tla/csp), mutation, trend集計 |

## 6.1 自動実行設定ファイル

- タスク定義: `codex/ae.playbook.yaml`
- 実行ラッパー: `scripts/ae/run.sh`
- verify-lite証跡化: `scripts/testing/verify-lite-harness.mjs`
- conformance異常系検証: `scripts/testing/conformance-negative-harness.mjs`（`CONF_NEG_CONCURRENCY` で並列数制御）
- trend集計: `scripts/testing/trend-report.mjs`（`TREND_MAX_RUNS` で走査件数制御）
- framework gap状態取得: `scripts/testing/framework-gap-status.mjs`
- 成果物監査: `scripts/testing/run-artifact-audit.mjs`
- conformance対象ルール: `configs/conformance/rule-ids.txt`
- MBT: `tests/mbt/approval-engine.mbt.test.ts`, `scripts/testing/mbt-quick.mjs`
- formalモデル（サービス固有）: `spec/formal/ApprovalAnyAll.tla`, `spec/formal/approval-any-all.cspm`
- GitHub Actions: `.github/workflows/pr-gate.yml`, `.github/workflows/nightly-deep.yml`
- 自動コミット方針: `github-actions[bot]` が `ci: persist ... [skip ci]` で main へ保存
- 実行例:
  - `bash scripts/ae/run.sh dev-fast`
  - `bash scripts/ae/run.sh pr-gate`
  - `bash scripts/ae/run.sh nightly-deep`
  - `bash scripts/ae/run.sh full`

## 7. 成果物配置ルール

- 仕様変換: `.ae/`
- 検証成果物: `artifacts/<category>/`
- 仕様補助成果物: `artifacts/contracts/*`, `artifacts/domain/*`, `artifacts/simulation/*`
- trend成果物: `artifacts/trends/*`
- framework gap成果物: `artifacts/framework-gaps/*`
- 実行単位のマニフェスト: `artifacts/runs/<run-id>/manifest.json`
- 実行単位の監査結果: `artifacts/runs/<run-id>/audit.json`
- 実行単位のスナップショット: `artifacts/runs/<run-id>/snapshots/**/*`
- 仕様書/計画書: `docs/specs/`, `docs/plans/`
- CI由来の中間生成物は `artifacts/` / `.ae/` の差分として main に保存する

## 8. 既知ギャップ追跡

- `BIZ_001` 警告の恒常発生は `ae-framework` 側 Issue `#1967` で追跡する。
