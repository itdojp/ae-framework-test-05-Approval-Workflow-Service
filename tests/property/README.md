# Property Tests

Issue #1 の P-AW-01〜04 を `fast-check` で検証する。

- 実体テスト: `tests/property/approval-engine.property.test.ts`
- MBT実体テスト: `tests/mbt/approval-engine.mbt.test.ts`
- 実行コマンド: `pnpm run test:property`
- 生成サマリ: `artifacts/properties/summary.json`（`scripts/ae/run.sh` 実行時）
