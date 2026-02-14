# 中間生成物保存仕様

## 1. 文書メタ

- 文書ID: `AW-ART-001`
- 版: `v0.3`
- 作成日: `2026-02-14`

## 2. 目的

- ae-framework 評価に必要な中間生成物を欠落なく保存し、再現性と監査性を確保する。

## 3. 保存対象

1. 仕様系:
- `spec/*.md`
- `.ae/ae-ir.json`
- `artifacts/spec/*`
- `artifacts/contracts/*`
- `artifacts/domain/*`
- `artifacts/simulation/*`
2. 検証系:
- `artifacts/verify-lite/*`
- `artifacts/conformance/*`
- `artifacts/mbt/*`
- `artifacts/formal/*`
- `artifacts/properties/*`
- `artifacts/mutation/*`
- `artifacts/trends/*`
3. 実行メタ:
- `artifacts/runs/<run-id>/manifest.json`
- 実行ログ（必要に応じて `artifacts/runs/<run-id>/logs/*`）
- run単位スナップショット: `artifacts/runs/<run-id>/snapshots/**/*`

## 4. 命名規則

- `run-id`: `YYYY-MM-DD-<phase-or-purpose>`
- 例:
  - `2026-02-14-init`
  - `2026-02-20-pr-gate`
  - `2026-02-21-nightly-deep`

## 5. コミット規則

1. 生成物は実行ごとに `artifacts/runs/<run-id>/` へ集約する。
  - `scripts/ae/run.sh` は終了時に主要成果物を `snapshots/` へ自動複製する。
2. 生成物を含むコミットメッセージには `run-id` と目的を含める。
3. PR説明欄に対象 `run-id` を列挙し、追跡可能にする。

## 6. 除外方針

- 機密情報（トークン、個人情報、秘密鍵）は保存禁止。
- 一時キャッシュで再現価値がないものは保存対象外。
