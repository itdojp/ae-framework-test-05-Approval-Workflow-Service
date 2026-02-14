# Request State Machine

## Request Transition Matrix (v0)

| Current | Operation | Next | Notes |
| --- | --- | --- | --- |
| DRAFT / RETURNED | update | same status | title/amount/currency validation required |
| DRAFT | submit | IN_REVIEW | Workflow is selected and first tasks are created |
| RETURNED | submit | IN_REVIEW | Request is re-submitted after correction |
| IN_REVIEW | approve-final | APPROVED | All required steps are completed |
| IN_REVIEW | reject | REJECTED | Any reject finalizes request |
| IN_REVIEW | return | RETURNED | Reviewer returns request for correction |
| SUBMITTED / IN_REVIEW / RETURNED | withdraw | WITHDRAWN | Requester stops review flow |
| DRAFT / SUBMITTED | cancel | CANCELLED | Requester or admin cancels request |

## Invariants

- Terminal status is immutable: APPROVED, REJECTED, CANCELLED, WITHDRAWN.
- Request becomes APPROVED only when all required workflow steps are completed.
- Request in terminal state has no PENDING task.
- Task can be decided exactly once.
