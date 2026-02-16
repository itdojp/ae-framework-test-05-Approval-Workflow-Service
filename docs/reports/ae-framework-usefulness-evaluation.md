# ae-framework 有用性検証レポート（Issue #1）

## 1. 文書メタ

- 文書ID: `AW-AE-EVAL-001`
- 評価日: `2026-02-16`
- 対象仕様: Issue #1 `AW-SPEC-001 v0.9`
- 対象トレーサビリティ: `docs/specs/requirements-traceability.md`
- 対象実行: `artifacts/runs/2026-02-16-full-specfit-r1/manifest.json`
- ae-framework 固定ref: `b68a4014f2827db300cae1f50fa4e1ee17998cab`

## 2. 総合判定

- 判定: **有用**
- 根拠:
  - 仕様適合確認を `要求ID-実装-テスト` で明示し、未達項目を追加実装で解消できた。
  - `full` プロファイルで仕様検証から回帰検証までを一連自動化し、証跡を run 単位で保存できた。
  - fixed ref ガードにより、`ae-framework` 側作業ツリー汚染を fail-fast で検知できた（再現性担保）。

## 3. Issue #1 仕様適合の確認結果

- `docs/specs/requirements-traceability.md` を更新し、Issue #1 要求IDを `達成` へ整理。
- 今回追加した主な適合実装:
  - `AW-REQ-002`: `src/domain/engine.ts` に `assertRequestSubmitRequiredFields` を追加。
  - `AW-WF-003`: `src/domain/engine.ts` に `resolveWorkflowForSubmit` を追加し、resubmit時も固定workflow/versionを再利用。
  - `AW-AUD-001`: withdraw/cancel の監査ログ検証を受入/APIテストへ追加。
- 今回追加した主なテスト:
  - `tests/acceptance/approval-engine.acceptance.test.ts` (`AW-REQ-002`, `AW-WF-003`, `AW-AUD-001`)
  - `tests/integration/api.acceptance.test.ts` (`AW-REQ-002`, `AW-WF-003`, `AW-AUD-001`)
- ローカル回帰:
  - `pnpm run test`: `33/33 passed`
  - `pnpm run verify:lite`: `pass`

## 4. ae-framework ツール別評価（full run）

| 区分 | 証跡 | 観測結果 | 有用性評価 |
| --- | --- | --- | --- |
| Ref Guard | `artifacts/spec/ae-framework-ref-check.json` | `refMatched=true`, `workingTreeClean=true`, `passed=true` | fixed ref 運用逸脱を即時検知できる |
| Spec Validate/Lint | `.ae/ae-ir.json`, `artifacts/spec/lint-gate.json` | warning `3/3` で gate 通過 | 仕様機械化と warning しきい値管理に有効 |
| Verify Lite | `artifacts/verify-lite/summary.json` | `status=pass`, `durationMs=4242` | 変更の即時回帰確認に有効 |
| Conformance | `artifacts/conformance/result.json` | `overall=pass`, `rulesPassed=5`, `rulesFailed=0` | 仕様ルール準拠を機械判定可能 |
| Conformance Negative | `artifacts/conformance/negative-summary.json` | `passed=true`, `4/4 scenario pass` | 異常系拒否仕様の担保に有効 |
| MBT | `artifacts/mbt/summary.json` | `status=pass`, `durationMs=1391` | 状態遷移の網羅確認に有効 |
| Property | `artifacts/properties/summary.json` | `passed=true`, `runs=50` | 不変条件の確率的検証に有効 |
| Formal | `artifacts/formal/2026-02-16-full-specfit-r1-*.json` | TLA/CSP とも `status=ran`, `ok=true` | 同時決裁安全性の裏取りに有効 |
| Mutation | `artifacts/mutation/summary.json` | `mutationScore=1`, `9/9 killed` | テストの欠陥検知能力評価に有効 |
| Artifact Audit/Index | `artifacts/runs/2026-02-16-full-specfit-r1/audit.json`, `artifacts/runs/index.json` | `missingCount=0`, `audit passed` | 中間生成物の欠落監査・追跡に有効 |
| Trend | `artifacts/trends/summary.json` | full latest run が反映済み | 継続運用で品質推移を比較可能 |

## 5. 既知制約

- `BIZ_001` は fixed ref 運用上の既知差分として継続管理。
  - 参照: `artifacts/framework-gaps/status.json`（`status=pass`, `recommendedAction=hold_fixed_ref`）

