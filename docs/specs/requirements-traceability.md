# 要求IDトレーサビリティ表

## 1. 文書メタ

- 文書ID: `AW-TRACE-001`
- 作成日: `2026-02-16`
- 更新日: `2026-02-16`
- 参照仕様: Issue #1 `AW-SPEC-001 v0.9`
- 対象リビジョン: `main`（`e6c3a4a` 以降）

## 2. 判定ルール

- `達成`: 実装と自動テスト（または同等の検証）が確認できる。
- `部分達成`: 実装はあるが、要求を直接検証するテストが不足している。
- `要確認`: 実装と要求の解釈差があり、追加検討が必要。

## 3. 要求ID-実装-テスト

| 要求ID | 要件要約 | 実装箇所 | テスト/検証 | 判定 | コメント |
| --- | --- | --- | --- | --- | --- |
| `AW-REQ-001` | submitは`DRAFT/RETURNED`のみ許可 | `src/domain/engine.ts` (`submitRequest`) | `tests/mbt/approval-engine.mbt.test.ts`, `tests/integration/api.acceptance.test.ts` (`AW-ACC-03`, `AW-REQ-RETURN-01`) | 達成 | 不正遷移は`409`で拒否 |
| `AW-REQ-002` | submit時に必須項目妥当性を満たす | `src/domain/engine.ts` (`assertRequestSubmitRequiredFields`) | `tests/acceptance/approval-engine.acceptance.test.ts` (`AW-REQ-002`), `tests/integration/api.acceptance.test.ts` (`AW-REQ-002`) | 達成 | title/amount/currency 欠落・不正値を拒否 |
| `AW-REQ-003` | submit時にworkflow/versionを固定 | `src/domain/engine.ts` (`resolveWorkflowForSubmit`, `workflowId`, `workflowVersion`) | `tests/acceptance/approval-engine.acceptance.test.ts` (`AW-WF-003`), `tests/integration/api.acceptance.test.ts` (`AW-WF-003`) | 達成 | `RETURNED -> resubmit` でも初回固定workflow/versionを再利用 |
| `AW-REQ-004` | step定義に従いtask生成 | `src/domain/engine.ts` (`openFirstStep`, `openStep`) | `tests/acceptance/approval-engine.acceptance.test.ts` (`AW-ACC-01`, `AW-ACC-02`, `AW-REQ-RETURN-01`) | 達成 | ANY/ALL双方を検証済み |
| `AW-WF-001` | ACTIVEかつmatch条件一致workflowを選択 | `src/domain/engine.ts` (`selectWorkflowForRequest`) | `tests/acceptance/approval-engine.acceptance.test.ts` (`AW-WF-002`) | 達成 | 単一/複数一致の選択経路をカバー |
| `AW-WF-002` | 複数一致時はpriority高を選択 | `src/domain/engine.ts` (`priority`降順ソート) | `tests/acceptance/approval-engine.acceptance.test.ts` (`AW-WF-002`), `tests/integration/api.acceptance.test.ts` (`AW-WF-002`) | 達成 | mutationでも分岐反転を検知 |
| `AW-WF-003` | 申請中はworkflow固定（定義変更非影響） | `src/domain/engine.ts` (`resolveWorkflowForSubmit`, `requireWorkflow`) | `tests/acceptance/approval-engine.acceptance.test.ts` (`AW-WF-003`), `tests/integration/api.acceptance.test.ts` (`AW-WF-003`) | 達成 | RETURN後に高優先workflow追加しても固定workflowを維持 |
| `AW-WF-010` | approver未解決ならsubmitを拒否 | `src/domain/engine.ts` (`no approver resolved` 検証) | `tests/acceptance/approval-engine.acceptance.test.ts` (`AW-WF-010`), `tests/integration/api.acceptance.test.ts` (`AW-WF-010`) | 達成 | `422`を確認済み |
| `AW-AUTH-001` | request閲覧は申請者/assignee/adminのみ | `src/domain/engine.ts` (`getRequest`) | `tests/acceptance/approval-engine.acceptance.test.ts` (`AW-AUTH-001`), `tests/integration/api.acceptance.test.ts` (`AW-AUTH-001`) | 達成 | unauthorizedは`403` |
| `AW-AUTH-002` | task決裁はassigneeのみ | `src/domain/engine.ts` (`decideTask`) | `tests/acceptance/approval-engine.acceptance.test.ts` (`AW-AUTH-002`), `tests/integration/api.acceptance.test.ts` (`AW-AUTH-002`) | 達成 | unauthorizedは`403` |
| `AW-TASK-001` | taskは`PENDING`のみ決裁可 | `src/domain/engine.ts` (`lockedTask.status` 判定) | `tests/property/approval-engine.property.test.ts` (`P-AW-04`), `tests/integration/api.acceptance.test.ts` (`AW-ACC-03`) | 達成 | 二重決裁は`409` |
| `AW-TASK-002` | assigneeのみ決裁可能 | `src/domain/engine.ts` (`decideTask`のactor検証) | `tests/acceptance/approval-engine.acceptance.test.ts` (`AW-AUTH-002`), `tests/integration/api.acceptance.test.ts` (`AW-AUTH-002`) | 達成 | ADMIN代行は許容実装 |
| `AW-TASK-010` | ANY step完了後の他task決裁を防止 | `src/domain/engine.ts` (`ANY`で残taskを`SKIPPED`) | `tests/acceptance/approval-engine.acceptance.test.ts` (`AW-ACC-01`), `tests/integration/api.acceptance.test.ts` (`AW-ACC-01`) | 達成 | 競合時に`409`または`SKIPPED`挙動 |
| `AW-TASK-011` | REJECT成立でrequestを`REJECTED`へ遷移 | `src/domain/engine.ts` (`rejectRequest`) | `tests/acceptance/approval-engine.acceptance.test.ts` (`AW-ACC-02`), `tests/integration/api.acceptance.test.ts` (`AW-ACC-02`) | 達成 | 未決task終端化を確認 |
| `AW-INV-001` | 終端状態遷移不変 | `src/domain/engine.ts` (終端ガード群) | `tests/acceptance/approval-engine.acceptance.test.ts` (`AW-ACC-03`), `tests/mbt/approval-engine.mbt.test.ts` | 達成 | 終端後操作`409` |
| `AW-INV-002` | `APPROVED`は必要step完了時のみ | `src/domain/engine.ts` (`advanceWorkflow`) | `tests/property/approval-engine.property.test.ts` (`P-AW-01`) | 達成 | ANY/ALL両モードで検証 |
| `AW-INV-010` | task二重決裁なし | `src/domain/engine.ts` (`lockedTask.status` 判定) | `tests/property/approval-engine.property.test.ts` (`P-AW-04`) | 達成 | 冪等性検証あり |
| `AW-INV-020` | 全step完了時のみ`APPROVED` | `src/domain/engine.ts` (`openStep`, `advanceWorkflow`) | `tests/property/approval-engine.property.test.ts` (`P-AW-01`), `tests/acceptance/approval-engine.acceptance.test.ts` (`AW-ACC-01`) | 達成 | step進行整合を確認 |
| `AW-INV-021` | `REJECTED`後に新規taskを生成しない | `src/domain/engine.ts` (`rejectRequest`, `closePendingTasks`) | `tests/acceptance/approval-engine.acceptance.test.ts` (`AW-ACC-02`), `tests/mbt/approval-engine.mbt.test.ts` | 達成 | pending残存なしを確認 |
| `AW-AUD-001` | 提出〜決裁の監査ログを保持 | `src/domain/engine.ts` (`addAudit`呼出し群) | `tests/acceptance/approval-engine.acceptance.test.ts` (`AW-ACC-04`, `AW-AUD-001`), `tests/integration/api.acceptance.test.ts` (`AW-ACC-04`, `AW-AUD-001`) | 達成 | submit/approve/reject/return/withdraw/cancel を監査ログで確認 |
| `AW-ACC-01` | ANY同時approveでもstep完了は1回 | `src/domain/engine.ts` (`Mutex`, `handleApproveDecision`) | `tests/acceptance/approval-engine.acceptance.test.ts` (`AW-ACC-01`), `tests/integration/api.acceptance.test.ts` (`AW-ACC-01`), `spec/formal/*` | 達成 | formalモデルで同時決裁安全性も確認 |
| `AW-ACC-02` | reject1件でrequest終端・未決task終端 | `src/domain/engine.ts` (`rejectRequest`) | `tests/acceptance/approval-engine.acceptance.test.ts` (`AW-ACC-02`), `tests/integration/api.acceptance.test.ts` (`AW-ACC-02`) | 達成 | |
| `AW-ACC-03` | 終端後submit/decideは`409` | `src/domain/engine.ts` (終端ガード) | `tests/acceptance/approval-engine.acceptance.test.ts` (`AW-ACC-03`), `tests/integration/api.acceptance.test.ts` (`AW-ACC-03`) | 達成 | |
| `AW-ACC-04` | 監査ログで提出〜決裁追跡可能 | `src/domain/engine.ts` (`addAudit`) | `tests/acceptance/approval-engine.acceptance.test.ts` (`AW-ACC-04`), `tests/integration/api.acceptance.test.ts` (`AW-ACC-04`) | 達成 | |

## 4. 追加要求（Issue #1以外の拡張ID）

| 要求ID | 実装箇所 | テスト/検証 | 判定 |
| --- | --- | --- | --- |
| `AW-TENANT-001` | `src/domain/engine.ts` (`assertTenant`) | `tests/acceptance/approval-engine.acceptance.test.ts`, `tests/integration/api.acceptance.test.ts` | 達成 |
| `AW-REQ-EDIT-01` | `src/domain/engine.ts` (`updateRequest`) | `tests/acceptance/approval-engine.acceptance.test.ts`, `tests/integration/api.acceptance.test.ts` | 達成 |
| `AW-REQ-RETURN-01` | `src/domain/engine.ts` (`returnRequest`, `resetTasksForResubmit`) | `tests/acceptance/approval-engine.acceptance.test.ts`, `tests/integration/api.acceptance.test.ts` | 達成 |

## 5. 残課題（本表から抽出）

| 区分 | 内容 | 推奨対応 |
| --- | --- | --- |
| なし | `2026-02-16` 時点で Issue #1 の要求IDに対する未解決項目なし | 仕様更新が入った場合は本表を再評価 |
