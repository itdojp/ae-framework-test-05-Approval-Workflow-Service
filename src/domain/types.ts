export type RequestType = 'EXPENSE' | 'PURCHASE' | 'GENERIC';

export type RequestStatus =
  | 'DRAFT'
  | 'SUBMITTED'
  | 'IN_REVIEW'
  | 'APPROVED'
  | 'REJECTED'
  | 'RETURNED'
  | 'CANCELLED'
  | 'WITHDRAWN';

export type WorkflowStatus = 'ACTIVE' | 'INACTIVE';

export type StepMode = 'ALL' | 'ANY';

export type TaskStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED' | 'SKIPPED';

export type TaskDecision = 'APPROVE' | 'REJECT' | 'RETURN';

export interface ActorContext {
  tenantId: string;
  userId: string;
  roles: string[];
}

export interface WorkflowMatchCondition {
  amountMin?: number;
  amountMax?: number;
  requestTypes?: RequestType[];
  priority?: number;
}

export interface StepDefinition {
  stepId: string;
  name: string;
  mode: StepMode;
  approverSelector: string;
  timeoutSeconds?: number | null;
  onTimeout?: 'ESCALATE' | 'AUTO_REJECT' | 'NOOP';
}

export interface WorkflowDefinition {
  workflowId: string;
  tenantId: string;
  name: string;
  version: number;
  status: WorkflowStatus;
  matchCondition: WorkflowMatchCondition;
  steps: StepDefinition[];
  createdAt: string;
  updatedAt: string;
}

export interface ApprovalRequest {
  requestId: string;
  tenantId: string;
  requesterUserId: string;
  type: RequestType;
  title: string;
  description: string | null;
  amount: number;
  currency: string;
  status: RequestStatus;
  workflowId: string | null;
  workflowVersion: number | null;
  currentStepIndex: number | null;
  createdAt: string;
  updatedAt: string;
  submittedAt: string | null;
  decidedAt: string | null;
}

export interface ApprovalTask {
  taskId: string;
  tenantId: string;
  requestId: string;
  stepId: string;
  stepIndex: number;
  assigneeUserId: string;
  status: TaskStatus;
  decidedAt: string | null;
  decisionComment: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface OrgRelation {
  tenantId: string;
  userId: string;
  managerUserId: string | null;
  roles: string[];
}

export interface AuditLog {
  auditId: string;
  tenantId: string;
  requestId: string | null;
  taskId: string | null;
  actorUserId: string;
  action:
    | 'REQUEST_CREATE'
    | 'REQUEST_SUBMIT'
    | 'REQUEST_WITHDRAW'
    | 'REQUEST_CANCEL'
    | 'REQUEST_APPROVE'
    | 'REQUEST_REJECT'
    | 'REQUEST_RETURN'
    | 'TASK_ASSIGN'
    | 'TASK_APPROVE'
    | 'TASK_REJECT'
    | 'WORKFLOW_CREATE'
    | 'WORKFLOW_ACTIVATE'
    | 'WORKFLOW_DEACTIVATE';
  detail: Record<string, unknown>;
  createdAt: string;
}

export interface CreateWorkflowInput {
  workflowId?: string;
  name: string;
  version?: number;
  matchCondition?: WorkflowMatchCondition;
  steps: StepDefinition[];
}

export interface CreateRequestInput {
  type: RequestType;
  title: string;
  description?: string | null;
  amount: number;
  currency: string;
}

