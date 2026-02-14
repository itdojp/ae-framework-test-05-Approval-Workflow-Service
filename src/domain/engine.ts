import { randomUUID } from 'node:crypto';
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from './errors.js';
import { Mutex } from './mutex.js';
import type {
  ActorContext,
  ApprovalRequest,
  ApprovalTask,
  AuditLog,
  CreateRequestInput,
  CreateWorkflowInput,
  OrgRelation,
  RequestStatus,
  TaskDecision,
  TaskStatus,
  WorkflowDefinition,
  WorkflowMatchCondition
} from './types.js';

const TERMINAL_STATUSES = new Set<RequestStatus>(['APPROVED', 'REJECTED', 'CANCELLED', 'WITHDRAWN']);

interface EngineOptions {
  now?: () => Date;
  idGenerator?: () => string;
}

export class ApprovalEngine {
  private readonly requests = new Map<string, ApprovalRequest>();
  private readonly tasks = new Map<string, ApprovalTask>();
  private readonly workflows = new Map<string, WorkflowDefinition>();
  private readonly orgRelations = new Map<string, OrgRelation>();
  private readonly audits: AuditLog[] = [];
  private readonly requestMutex = new Map<string, Mutex>();
  private readonly options: EngineOptions;

  constructor(options?: EngineOptions) {
    this.options = options ?? {};
  }

  upsertOrgRelation(relation: OrgRelation): OrgRelation {
    const normalized: OrgRelation = {
      ...relation,
      roles: [...new Set(relation.roles.map((role) => role.trim()).filter(Boolean))]
    };
    this.orgRelations.set(this.orgKey(normalized.tenantId, normalized.userId), normalized);
    return this.clone(normalized);
  }

  createWorkflow(input: CreateWorkflowInput, actor: ActorContext): WorkflowDefinition {
    if (!input.name.trim()) {
      throw new ValidationError('workflow name is required');
    }
    if (!Array.isArray(input.steps) || input.steps.length === 0) {
      throw new ValidationError('at least one workflow step is required');
    }

    const workflowId = input.workflowId?.trim() || this.nextId('wf');
    const now = this.nowIso();
    const key = this.workflowKey(actor.tenantId, workflowId);

    if (this.workflows.has(key)) {
      throw new ConflictError(`workflow already exists: ${workflowId}`);
    }

    const workflow: WorkflowDefinition = {
      workflowId,
      tenantId: actor.tenantId,
      name: input.name.trim(),
      version: input.version ?? 1,
      status: 'INACTIVE',
      matchCondition: input.matchCondition ?? {},
      steps: input.steps.map((step, index) => ({
        ...step,
        stepId: step.stepId || `step_${index + 1}`
      })),
      createdAt: now,
      updatedAt: now
    };

    this.workflows.set(key, workflow);
    this.addAudit({
      actor,
      action: 'WORKFLOW_CREATE',
      requestId: null,
      taskId: null,
      detail: { workflowId: workflow.workflowId, version: workflow.version }
    });
    return this.clone(workflow);
  }

  activateWorkflow(workflowId: string, actor: ActorContext): WorkflowDefinition {
    const workflow = this.requireWorkflow(actor.tenantId, workflowId);
    workflow.status = 'ACTIVE';
    workflow.updatedAt = this.nowIso();
    this.addAudit({
      actor,
      action: 'WORKFLOW_ACTIVATE',
      requestId: null,
      taskId: null,
      detail: { workflowId }
    });
    return this.clone(workflow);
  }

  deactivateWorkflow(workflowId: string, actor: ActorContext): WorkflowDefinition {
    const workflow = this.requireWorkflow(actor.tenantId, workflowId);
    workflow.status = 'INACTIVE';
    workflow.updatedAt = this.nowIso();
    this.addAudit({
      actor,
      action: 'WORKFLOW_DEACTIVATE',
      requestId: null,
      taskId: null,
      detail: { workflowId }
    });
    return this.clone(workflow);
  }

  listWorkflows(actor: ActorContext): WorkflowDefinition[] {
    return [...this.workflows.values()]
      .filter((workflow) => workflow.tenantId === actor.tenantId)
      .sort((a, b) => a.workflowId.localeCompare(b.workflowId))
      .map((workflow) => this.clone(workflow));
  }

  createRequest(input: CreateRequestInput, actor: ActorContext): ApprovalRequest {
    if (!input.title.trim()) {
      throw new ValidationError('title is required');
    }
    if (!Number.isFinite(input.amount) || input.amount < 0) {
      throw new ValidationError('amount must be a non-negative number');
    }
    if (!input.currency.trim()) {
      throw new ValidationError('currency is required');
    }

    const now = this.nowIso();
    const request: ApprovalRequest = {
      requestId: this.nextId('req'),
      tenantId: actor.tenantId,
      requesterUserId: actor.userId,
      type: input.type,
      title: input.title.trim(),
      description: input.description?.trim() || null,
      amount: input.amount,
      currency: input.currency.trim(),
      status: 'DRAFT',
      workflowId: null,
      workflowVersion: null,
      currentStepIndex: null,
      createdAt: now,
      updatedAt: now,
      submittedAt: null,
      decidedAt: null
    };
    this.requests.set(request.requestId, request);
    this.addAudit({
      actor,
      action: 'REQUEST_CREATE',
      requestId: request.requestId,
      taskId: null,
      detail: { title: request.title, amount: request.amount, currency: request.currency }
    });
    return this.clone(request);
  }

  async submitRequest(requestId: string, actor: ActorContext): Promise<ApprovalRequest> {
    return this.withRequestLock(requestId, async () => {
      const request = this.requireRequest(requestId);
      this.assertTenant(actor.tenantId, request.tenantId);
      this.assertRequesterOrAdmin(request, actor);

      if (TERMINAL_STATUSES.has(request.status)) {
        throw new ConflictError(`request is terminal: ${request.status}`);
      }
      if (request.status !== 'DRAFT' && request.status !== 'RETURNED') {
        throw new ConflictError(`submit not allowed in status: ${request.status}`);
      }

      const workflow = this.selectWorkflowForRequest(request);
      const now = this.nowIso();
      request.workflowId = workflow.workflowId;
      request.workflowVersion = workflow.version;
      request.submittedAt = now;
      request.updatedAt = now;
      request.status = 'SUBMITTED';

      this.addAudit({
        actor,
        action: 'REQUEST_SUBMIT',
        requestId: request.requestId,
        taskId: null,
        detail: { workflowId: workflow.workflowId, workflowVersion: workflow.version }
      });

      this.openFirstStep(request, workflow, actor);
      return this.clone(request);
    });
  }

  async decideTask(
    taskId: string,
    actor: ActorContext,
    decision: TaskDecision,
    comment?: string
  ): Promise<{ request: ApprovalRequest; task: ApprovalTask }> {
    const task = this.requireTask(taskId);
    return this.withRequestLock(task.requestId, async () => {
      const lockedTask = this.requireTask(taskId);
      const request = this.requireRequest(lockedTask.requestId);
      this.assertTenant(actor.tenantId, request.tenantId);

      if (TERMINAL_STATUSES.has(request.status)) {
        throw new ConflictError(`request is terminal: ${request.status}`);
      }
      if (request.status !== 'IN_REVIEW') {
        throw new ConflictError(`task decision is not allowed in status: ${request.status}`);
      }
      if (lockedTask.status !== 'PENDING') {
        throw new ConflictError(`task is already decided: ${lockedTask.status}`);
      }
      if (!this.isAdmin(actor) && lockedTask.assigneeUserId !== actor.userId) {
        throw new ForbiddenError('only task assignee can decide');
      }

      const now = this.nowIso();
      lockedTask.decidedAt = now;
      lockedTask.updatedAt = now;
      lockedTask.decisionComment = comment ?? null;

      if (decision === 'APPROVE') {
        lockedTask.status = 'APPROVED';
        this.addAudit({
          actor,
          action: 'TASK_APPROVE',
          requestId: request.requestId,
          taskId: lockedTask.taskId,
          detail: { stepId: lockedTask.stepId, comment: lockedTask.decisionComment }
        });
        this.handleApproveDecision(request, lockedTask, actor);
      } else if (decision === 'REJECT') {
        lockedTask.status = 'REJECTED';
        this.addAudit({
          actor,
          action: 'TASK_REJECT',
          requestId: request.requestId,
          taskId: lockedTask.taskId,
          detail: { stepId: lockedTask.stepId, comment: lockedTask.decisionComment }
        });
        this.rejectRequest(request, actor, lockedTask.taskId);
      } else {
        throw new ValidationError(`unsupported decision: ${decision}`);
      }

      return {
        request: this.clone(request),
        task: this.clone(lockedTask)
      };
    });
  }

  async withdrawRequest(requestId: string, actor: ActorContext): Promise<ApprovalRequest> {
    return this.withRequestLock(requestId, async () => {
      const request = this.requireRequest(requestId);
      this.assertTenant(actor.tenantId, request.tenantId);
      this.assertRequesterOrAdmin(request, actor);

      if (TERMINAL_STATUSES.has(request.status)) {
        throw new ConflictError(`request is terminal: ${request.status}`);
      }
      if (!['SUBMITTED', 'IN_REVIEW', 'RETURNED'].includes(request.status)) {
        throw new ConflictError(`withdraw not allowed in status: ${request.status}`);
      }

      request.status = 'WITHDRAWN';
      request.decidedAt = this.nowIso();
      request.updatedAt = request.decidedAt;
      this.closePendingTasks(request.requestId, 'CANCELLED', new Set());

      this.addAudit({
        actor,
        action: 'REQUEST_WITHDRAW',
        requestId: request.requestId,
        taskId: null,
        detail: {}
      });
      return this.clone(request);
    });
  }

  async cancelRequest(requestId: string, actor: ActorContext): Promise<ApprovalRequest> {
    return this.withRequestLock(requestId, async () => {
      const request = this.requireRequest(requestId);
      this.assertTenant(actor.tenantId, request.tenantId);
      this.assertRequesterOrAdmin(request, actor);

      if (TERMINAL_STATUSES.has(request.status)) {
        throw new ConflictError(`request is terminal: ${request.status}`);
      }
      if (!['DRAFT', 'SUBMITTED'].includes(request.status)) {
        throw new ConflictError(`cancel not allowed in status: ${request.status}`);
      }

      request.status = 'CANCELLED';
      request.decidedAt = this.nowIso();
      request.updatedAt = request.decidedAt;
      this.closePendingTasks(request.requestId, 'CANCELLED', new Set());

      this.addAudit({
        actor,
        action: 'REQUEST_CANCEL',
        requestId: request.requestId,
        taskId: null,
        detail: {}
      });
      return this.clone(request);
    });
  }

  listRequests(actor: ActorContext): ApprovalRequest[] {
    const assignedRequestIds = new Set(
      [...this.tasks.values()]
        .filter((task) => task.tenantId === actor.tenantId && task.assigneeUserId === actor.userId)
        .map((task) => task.requestId)
    );

    return [...this.requests.values()]
      .filter((request) => {
        if (request.tenantId !== actor.tenantId) {
          return false;
        }
        if (this.isAdmin(actor)) {
          return true;
        }
        return request.requesterUserId === actor.userId || assignedRequestIds.has(request.requestId);
      })
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      .map((request) => this.clone(request));
  }

  getRequest(requestId: string, actor: ActorContext): ApprovalRequest {
    const request = this.requireRequest(requestId);
    this.assertTenant(actor.tenantId, request.tenantId);
    if (!this.isAdmin(actor) && request.requesterUserId !== actor.userId) {
      const assigned = [...this.tasks.values()].some(
        (task) => task.requestId === request.requestId && task.assigneeUserId === actor.userId
      );
      if (!assigned) {
        throw new ForbiddenError('request access is denied');
      }
    }
    return this.clone(request);
  }

  listTasks(
    actor: ActorContext,
    filter?: { status?: TaskStatus; requestId?: string; assigneeUserId?: string }
  ): ApprovalTask[] {
    return [...this.tasks.values()]
      .filter((task) => {
        if (task.tenantId !== actor.tenantId) {
          return false;
        }
        if (!this.isAdmin(actor) && task.assigneeUserId !== actor.userId) {
          return false;
        }
        if (filter?.status && task.status !== filter.status) {
          return false;
        }
        if (filter?.requestId && task.requestId !== filter.requestId) {
          return false;
        }
        if (filter?.assigneeUserId && task.assigneeUserId !== filter.assigneeUserId) {
          return false;
        }
        return true;
      })
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      .map((task) => this.clone(task));
  }

  listAuditLogs(actor: ActorContext, requestId?: string): AuditLog[] {
    return this.audits
      .filter((audit) => audit.tenantId === actor.tenantId)
      .filter((audit) => (requestId ? audit.requestId === requestId : true))
      .map((audit) => this.clone(audit));
  }

  private openFirstStep(request: ApprovalRequest, workflow: WorkflowDefinition, actor: ActorContext): void {
    this.openStep(request, workflow, 0, actor);
  }

  private openStep(
    request: ApprovalRequest,
    workflow: WorkflowDefinition,
    stepIndex: number,
    actor: ActorContext
  ): void {
    const step = workflow.steps[stepIndex];
    if (!step) {
      request.status = 'APPROVED';
      request.decidedAt = this.nowIso();
      request.updatedAt = request.decidedAt;
      this.addAudit({
        actor,
        action: 'REQUEST_APPROVE',
        requestId: request.requestId,
        taskId: null,
        detail: { reason: 'workflow_completed' }
      });
      return;
    }

    const approvers = this.resolveApprovers(
      request.tenantId,
      request.requesterUserId,
      step.approverSelector
    );
    if (approvers.length === 0) {
      throw new ValidationError(`no approver resolved for step ${step.stepId}`);
    }

    const now = this.nowIso();
    for (const assigneeUserId of approvers) {
      const duplicate = [...this.tasks.values()].find(
        (task) =>
          task.requestId === request.requestId &&
          task.stepId === step.stepId &&
          task.assigneeUserId === assigneeUserId
      );
      if (duplicate) {
        continue;
      }

      const task: ApprovalTask = {
        taskId: this.nextId('task'),
        tenantId: request.tenantId,
        requestId: request.requestId,
        stepId: step.stepId,
        stepIndex,
        assigneeUserId,
        status: 'PENDING',
        decidedAt: null,
        decisionComment: null,
        createdAt: now,
        updatedAt: now
      };
      this.tasks.set(task.taskId, task);
      this.addAudit({
        actor,
        action: 'TASK_ASSIGN',
        requestId: request.requestId,
        taskId: task.taskId,
        detail: { stepId: step.stepId, assigneeUserId }
      });
    }

    request.currentStepIndex = stepIndex;
    request.status = 'IN_REVIEW';
    request.updatedAt = now;
  }

  private handleApproveDecision(
    request: ApprovalRequest,
    decidedTask: ApprovalTask,
    actor: ActorContext
  ): void {
    const workflow = this.requireRequestWorkflow(request);
    const step = workflow.steps[decidedTask.stepIndex];
    if (!step) {
      throw new ConflictError(`missing step definition: ${decidedTask.stepIndex}`);
    }

    const stepTasks = [...this.tasks.values()].filter(
      (task) => task.requestId === request.requestId && task.stepId === step.stepId
    );

    if (step.mode === 'ANY') {
      for (const task of stepTasks) {
        if (task.taskId !== decidedTask.taskId && task.status === 'PENDING') {
          task.status = 'SKIPPED';
          task.updatedAt = this.nowIso();
        }
      }
      this.advanceWorkflow(request, decidedTask.stepIndex + 1, actor);
      return;
    }

    const allApproved = stepTasks.every((task) => task.status === 'APPROVED');
    if (allApproved) {
      this.advanceWorkflow(request, decidedTask.stepIndex + 1, actor);
    }
  }

  private advanceWorkflow(request: ApprovalRequest, nextStepIndex: number, actor: ActorContext): void {
    const workflow = this.requireRequestWorkflow(request);
    if (!workflow.steps[nextStepIndex]) {
      request.status = 'APPROVED';
      request.decidedAt = this.nowIso();
      request.updatedAt = request.decidedAt;
      this.closePendingTasks(request.requestId, 'CANCELLED', new Set());
      this.addAudit({
        actor,
        action: 'REQUEST_APPROVE',
        requestId: request.requestId,
        taskId: null,
        detail: { reason: 'all_steps_completed' }
      });
      return;
    }
    this.openStep(request, workflow, nextStepIndex, actor);
  }

  private rejectRequest(request: ApprovalRequest, actor: ActorContext, decidedTaskId: string): void {
    request.status = 'REJECTED';
    request.decidedAt = this.nowIso();
    request.updatedAt = request.decidedAt;
    this.closePendingTasks(request.requestId, 'CANCELLED', new Set([decidedTaskId]));
    this.addAudit({
      actor,
      action: 'REQUEST_REJECT',
      requestId: request.requestId,
      taskId: decidedTaskId,
      detail: {}
    });
  }

  private closePendingTasks(
    requestId: string,
    terminalStatus: Extract<TaskStatus, 'CANCELLED' | 'SKIPPED'>,
    keepTaskIds: Set<string>
  ): void {
    for (const task of this.tasks.values()) {
      if (task.requestId !== requestId) {
        continue;
      }
      if (keepTaskIds.has(task.taskId)) {
        continue;
      }
      if (task.status === 'PENDING') {
        task.status = terminalStatus;
        task.updatedAt = this.nowIso();
      }
    }
  }

  private resolveApprovers(tenantId: string, requesterUserId: string, selector: string): string[] {
    if (!selector) {
      return [];
    }
    if (selector === 'REQUESTER_MANAGER') {
      const relation = this.orgRelations.get(this.orgKey(tenantId, requesterUserId));
      return relation?.managerUserId ? [relation.managerUserId] : [];
    }
    if (selector.startsWith('USER:')) {
      const userId = selector.slice('USER:'.length).trim();
      return userId ? [userId] : [];
    }
    if (selector.startsWith('ROLE:')) {
      const roleName = selector.slice('ROLE:'.length).trim();
      if (!roleName) {
        return [];
      }
      return [...this.orgRelations.values()]
        .filter((relation) => relation.tenantId === tenantId)
        .filter((relation) => relation.roles.includes(roleName))
        .map((relation) => relation.userId)
        .sort();
    }
    return [];
  }

  private selectWorkflowForRequest(request: ApprovalRequest): WorkflowDefinition {
    const candidates = [...this.workflows.values()]
      .filter((workflow) => workflow.tenantId === request.tenantId)
      .filter((workflow) => workflow.status === 'ACTIVE')
      .filter((workflow) => this.matchWorkflowCondition(request, workflow.matchCondition))
      .sort((a, b) => {
        const ap = a.matchCondition.priority ?? 0;
        const bp = b.matchCondition.priority ?? 0;
        if (ap !== bp) {
          return bp - ap;
        }
        return a.workflowId.localeCompare(b.workflowId);
      });

    const selected = candidates[0];
    if (!selected) {
      throw new ValidationError('no active workflow matched');
    }
    return selected;
  }

  private matchWorkflowCondition(
    request: ApprovalRequest,
    condition: WorkflowMatchCondition | undefined
  ): boolean {
    if (!condition) {
      return true;
    }
    if (typeof condition.amountMin === 'number' && request.amount < condition.amountMin) {
      return false;
    }
    if (typeof condition.amountMax === 'number' && request.amount > condition.amountMax) {
      return false;
    }
    if (condition.requestTypes && condition.requestTypes.length > 0) {
      return condition.requestTypes.includes(request.type);
    }
    return true;
  }

  private requireRequestWorkflow(request: ApprovalRequest): WorkflowDefinition {
    if (!request.workflowId) {
      throw new ConflictError('request workflow is not fixed');
    }
    return this.requireWorkflow(request.tenantId, request.workflowId);
  }

  private requireRequest(requestId: string): ApprovalRequest {
    const request = this.requests.get(requestId);
    if (!request) {
      throw new NotFoundError(`request not found: ${requestId}`);
    }
    return request;
  }

  private requireTask(taskId: string): ApprovalTask {
    const task = this.tasks.get(taskId);
    if (!task) {
      throw new NotFoundError(`task not found: ${taskId}`);
    }
    return task;
  }

  private requireWorkflow(tenantId: string, workflowId: string): WorkflowDefinition {
    const workflow = this.workflows.get(this.workflowKey(tenantId, workflowId));
    if (!workflow) {
      throw new NotFoundError(`workflow not found: ${workflowId}`);
    }
    return workflow;
  }

  private assertTenant(actorTenantId: string, resourceTenantId: string): void {
    if (actorTenantId !== resourceTenantId) {
      throw new ForbiddenError('cross-tenant access is denied');
    }
  }

  private assertRequesterOrAdmin(request: ApprovalRequest, actor: ActorContext): void {
    if (request.requesterUserId !== actor.userId && !this.isAdmin(actor)) {
      throw new ForbiddenError('operation requires requester or admin role');
    }
  }

  private isAdmin(actor: ActorContext): boolean {
    return actor.roles.includes('ADMIN');
  }

  private workflowKey(tenantId: string, workflowId: string): string {
    return `${tenantId}:${workflowId}`;
  }

  private orgKey(tenantId: string, userId: string): string {
    return `${tenantId}:${userId}`;
  }

  private nowIso(): string {
    return (this.options.now?.() ?? new Date()).toISOString();
  }

  private nextId(prefix: string): string {
    return `${prefix}_${this.options.idGenerator?.() ?? randomUUID()}`;
  }

  private addAudit(input: {
    actor: ActorContext;
    requestId: string | null;
    taskId: string | null;
    action: AuditLog['action'];
    detail: Record<string, unknown>;
  }): void {
    const audit: AuditLog = {
      auditId: this.nextId('audit'),
      tenantId: input.actor.tenantId,
      requestId: input.requestId,
      taskId: input.taskId,
      actorUserId: input.actor.userId,
      action: input.action,
      detail: input.detail,
      createdAt: this.nowIso()
    };
    this.audits.push(audit);
  }

  private mutexForRequest(requestId: string): Mutex {
    let mutex = this.requestMutex.get(requestId);
    if (!mutex) {
      mutex = new Mutex();
      this.requestMutex.set(requestId, mutex);
    }
    return mutex;
  }

  private async withRequestLock<T>(requestId: string, fn: () => Promise<T> | T): Promise<T> {
    const mutex = this.mutexForRequest(requestId);
    return mutex.runExclusive(fn);
  }

  private clone<T>(value: T): T {
    return structuredClone(value);
  }
}

