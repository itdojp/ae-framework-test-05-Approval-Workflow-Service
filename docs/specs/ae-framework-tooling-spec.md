# ae-framework 利用仕様（参照用）

## 1. 文書メタ

- 文書ID: `AW-AE-TOOL-001`
- 版: `v0.1`
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
| 契約生成 | `node scripts/spec/generate-contracts.mjs` | API契約の抽出 | `.ae/ae-ir.json` | `artifacts/spec/contracts.json` | API変更時 |
| Replay生成 | `node scripts/spec/generate-replay-fixtures.mjs` | 検証用入力固定化 | `contracts.json` | `artifacts/spec/replay.json` | 契約更新時 |
| Deterministic実行 | `node scripts/simulation/deterministic-runner.mjs` | 再現性確認 | `replay.json` | `artifacts/sim/sim.json` | PR前 |
| 軽量ゲート | `pnpm run verify:lite` | lint/test/build の最小品質担保 | 実装コード一式 | `artifacts/verify-lite/*` | PRごと |
| Conformance | `ae conformance verify` | ルール/スキーマ違反検出 | 入力JSON + ルール | `artifacts/conformance/*` | API/ルール更新時 |
| MBT | `pnpm run test:mbt:quick` | 状態遷移モデル（12.1）の検証 | `tests/mbt/*` | `artifacts/mbt/*` | PRごと |
| Formal（重点） | `pnpm run verify:tla`, `pnpm run verify:csp` | 同時決裁競合（AW-ACC-01）の安全性検証 | `spec/formal/*` | `artifacts/formal/*` | 日次または手動 |
| Property | `pnpm run test:property` + `node scripts/testing/property-harness.mjs` | 不変条件（AW-INV）検証 | `tests/property/*` | `artifacts/properties/*` | PRごと |
| Mutation | `pnpm run test:mutation:quick` | テストの欠陥検知能力確認（ANY/ALL反転・終端ガード欠落・assigneeガード欠落） | 実装/テスト | `artifacts/mutation/*` | 週次 |

## 5. 自動化ポリシー

1. ローカル自動化:
- Codex 実行は `approval_policy=never` を基準とする。
- 実行スクリプトは fail-fast（実装品質に直結）と report-only（重検証）を分離する。
2. CI自動化:
- PRトリガ: `verify:lite` + property + conformance（軽量範囲）
- 手動/定期トリガ: formal + mutation（重検証）
3. 証跡保存:
- 各ジョブで `artifacts/` を更新し、必要に応じてコミットして追跡可能にする。

## 6. 実行プロファイル

| プロファイル | 対象 | 構成 |
| --- | --- | --- |
| `dev-fast` | 日常開発 | spec validate/lint, verify-lite |
| `pr-gate` | PR品質ゲート | verify-lite, conformance, mbt, property |
| `nightly-deep` | 深夜定期検証 | formal(tla/csp), mutation, trend集計 |

## 6.1 自動実行設定ファイル

- タスク定義: `codex/ae.playbook.yaml`
- 実行ラッパー: `scripts/ae/run.sh`
- conformance対象ルール: `configs/conformance/rule-ids.txt`
- MBT: `tests/mbt/approval-engine.mbt.test.ts`, `scripts/testing/mbt-quick.mjs`
- formalモデル（サービス固有）: `spec/formal/ApprovalAnyAll.tla`, `spec/formal/approval-any-all.cspm`
- 実行例:
  - `bash scripts/ae/run.sh dev-fast`
  - `bash scripts/ae/run.sh pr-gate`
  - `bash scripts/ae/run.sh nightly-deep`
  - `bash scripts/ae/run.sh full`

## 7. 成果物配置ルール

- 仕様変換: `.ae/`
- 検証成果物: `artifacts/<category>/`
- 実行単位のマニフェスト: `artifacts/runs/<run-id>/manifest.json`
- 仕様書/計画書: `docs/specs/`, `docs/plans/`
