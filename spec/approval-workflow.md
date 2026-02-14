# ApprovalWorkflowServiceSpec

Minimal AE-Spec for approval workflow service verification.

## Glossary

- **ApprovalRequest**: Business request created by requester and processed through approval steps.
- **ApprovalTask**: Decision unit assigned to one approver in a specific workflow step.
- **WorkflowDefinition**: Configurable set of steps that determines how approvals are evaluated.

## Domain

### ApprovalRequest
- **requestId** (uuid, required) - Unique request identifier
- **tenantId** (string, required) - Tenant isolation key
- **requesterUserId** (string, required) - Request owner user id
- **type** (string, required) - Request business category
- **title** (string, required) - Request title text
- **amount** (number, required) - Requested monetary amount
- **currency** (string, required) - Currency code
- **status** (string, required) - Current request lifecycle status
- **workflowId** (string) - Bound workflow identifier
- **submittedAt** (date) - Submission timestamp
- **decidedAt** (date) - Final decision timestamp

### ApprovalTask
- **taskId** (uuid, required) - Unique task identifier
- **requestId** (uuid, required) - Parent request identifier
- **stepId** (string, required) - Workflow step identifier
- **stepIndex** (number, required) - Step position in workflow
- **assigneeUserId** (string, required) - Assignee user id
- **status** (string, required) - Current task status
- **decidedAt** (date) - Decision timestamp
- **decisionComment** (string) - Decision reason text

### WorkflowDefinition
- **workflowId** (string, required) - Workflow identifier
- **name** (string, required) - Workflow display name
- **version** (number, required) - Workflow version number
- **status** (string, required) - Activation status
- **steps** (array, required) - Ordered step definitions

## Business Rules

1. **BR-AW-REQ-001**: ApprovalRequest in terminal status must not transition again.
2. **BR-AW-REQ-002**: ApprovalRequest can be APPROVED only after all required steps are completed.
3. **BR-AW-TASK-001**: ApprovalTask can be decided exactly once; repeated decisions must return conflict.
4. **BR-AW-WF-001**: WorkflowDefinition selected at submit is fixed for the lifecycle of the ApprovalRequest.

## Use Cases

### Submit Request
- Requester creates a draft request with title amount and currency fields.
- System selects one active workflow by priority and matching condition.
- System creates initial approval tasks from the first workflow step.
- System transitions request status from draft to in review.

### Decide Approval Task
- Assignee opens pending task assigned in current workflow step.
- Assignee decides approve or reject with optional decision comment.
- System updates request status according to ANY or ALL step mode.
- System records audit entries for task decision and request transition.

## API

- POST /workflows - Create workflow definition
- POST /workflows/:workflowId/activate - Activate workflow
- POST /requests - Create draft request
- POST /requests/:requestId/submit - Submit request
- POST /tasks/:taskId/decide - Decide assigned task
- GET /requests - List visible requests
- GET /tasks - List visible tasks
- GET /audit-logs - List audit logs
