import { describe, expect, it } from 'vitest';
import { ApprovalEngine } from '../../src/domain/engine.js';
import { ConflictError, ForbiddenError, ValidationError } from '../../src/domain/errors.js';
import type { ActorContext, CreateWorkflowInput } from '../../src/domain/types.js';

const tenantId = 'tenant-acme';

function actor(userId: string, roles: string[] = []): ActorContext {
  return { tenantId, userId, roles };
}

async function createAndActivateWorkflow(
  engine: ApprovalEngine,
  workflow: CreateWorkflowInput
): Promise<void> {
  const admin = actor('admin-01', ['ADMIN']);
  const created = engine.createWorkflow(workflow, admin);
  engine.activateWorkflow(created.workflowId, admin);
}

describe('Approval Workflow Acceptance', () => {
  it('AW-ACC-01: ANY step simultaneous approvals complete step once without duplicate next-step tasks', async () => {
    const engine = new ApprovalEngine();
    const admin = actor('admin-01', ['ADMIN']);
    const requester = actor('requester-01');
    const approverA = actor('approver-a');
    const approverB = actor('approver-b');
    const finalApprover = actor('final-approver');

    engine.upsertOrgRelation({
      tenantId,
      userId: approverA.userId,
      managerUserId: null,
      roles: ['DEPT_HEAD']
    });
    engine.upsertOrgRelation({
      tenantId,
      userId: approverB.userId,
      managerUserId: null,
      roles: ['DEPT_HEAD']
    });
    engine.upsertOrgRelation({
      tenantId,
      userId: finalApprover.userId,
      managerUserId: null,
      roles: ['FINANCE']
    });

    await createAndActivateWorkflow(engine, {
      workflowId: 'wf-any-all',
      name: 'AnyThenAll',
      matchCondition: { priority: 100 },
      steps: [
        { stepId: 'step-1', name: 'Dept Approval', mode: 'ANY', approverSelector: 'ROLE:DEPT_HEAD' },
        { stepId: 'step-2', name: 'Finance Approval', mode: 'ALL', approverSelector: `USER:${finalApprover.userId}` }
      ]
    });

    const request = engine.createRequest(
      {
        type: 'GENERIC',
        title: 'Purchase New Monitor',
        amount: 120000,
        currency: 'JPY'
      },
      requester
    );
    await engine.submitRequest(request.requestId, requester);

    const step1Tasks = engine
      .listTasks(admin, { requestId: request.requestId })
      .filter((task) => task.stepId === 'step-1');
    expect(step1Tasks).toHaveLength(2);

    const [r1, r2] = await Promise.allSettled([
      engine.decideTask(step1Tasks[0]!.taskId, approverA, 'APPROVE', 'ok'),
      engine.decideTask(step1Tasks[1]!.taskId, approverB, 'APPROVE', 'ok')
    ]);

    const settled = [r1, r2];
    const rejectedCount = settled.filter((item) => item.status === 'rejected').length;
    expect(rejectedCount).toBe(1);

    const updatedRequest = engine.getRequest(request.requestId, admin);
    expect(updatedRequest.status).toBe('IN_REVIEW');
    expect(updatedRequest.currentStepIndex).toBe(1);

    const allTasks = engine.listTasks(admin, { requestId: request.requestId });
    const step1Approved = allTasks.filter((task) => task.stepId === 'step-1' && task.status === 'APPROVED');
    const step1Skipped = allTasks.filter((task) => task.stepId === 'step-1' && task.status === 'SKIPPED');
    const step2Tasks = allTasks.filter((task) => task.stepId === 'step-2');

    expect(step1Approved).toHaveLength(1);
    expect(step1Skipped).toHaveLength(1);
    expect(step2Tasks).toHaveLength(1);
    expect(step2Tasks[0]!.status).toBe('PENDING');
  });

  it('AW-ACC-02: a single reject moves request to REJECTED and closes all pending tasks', async () => {
    const engine = new ApprovalEngine();
    const admin = actor('admin-01', ['ADMIN']);
    const requester = actor('requester-01');
    const approverA = actor('approver-a');
    const approverB = actor('approver-b');

    engine.upsertOrgRelation({
      tenantId,
      userId: approverA.userId,
      managerUserId: null,
      roles: ['APPROVER']
    });
    engine.upsertOrgRelation({
      tenantId,
      userId: approverB.userId,
      managerUserId: null,
      roles: ['APPROVER']
    });

    await createAndActivateWorkflow(engine, {
      workflowId: 'wf-reject',
      name: 'RejectPath',
      matchCondition: { priority: 100 },
      steps: [{ stepId: 'step-1', name: 'Dual Approval', mode: 'ALL', approverSelector: 'ROLE:APPROVER' }]
    });

    const request = engine.createRequest(
      {
        type: 'GENERIC',
        title: 'Contract Renewal',
        amount: 80000,
        currency: 'JPY'
      },
      requester
    );
    await engine.submitRequest(request.requestId, requester);

    const pendingTasks = engine.listTasks(admin, { requestId: request.requestId, status: 'PENDING' });
    expect(pendingTasks).toHaveLength(2);

    await engine.decideTask(pendingTasks[0]!.taskId, approverA, 'REJECT', 'budget over');

    const updatedRequest = engine.getRequest(request.requestId, admin);
    expect(updatedRequest.status).toBe('REJECTED');

    const tasks = engine.listTasks(admin, { requestId: request.requestId });
    expect(tasks.some((task) => task.status === 'PENDING')).toBe(false);
    expect(tasks.some((task) => task.status === 'CANCELLED')).toBe(true);
  });

  it('AW-ACC-03: submit/decide operations are rejected after terminal state', async () => {
    const engine = new ApprovalEngine();
    const admin = actor('admin-01', ['ADMIN']);
    const requester = actor('requester-01');
    const approver = actor('approver-01');

    await createAndActivateWorkflow(engine, {
      workflowId: 'wf-terminal',
      name: 'TerminalGuard',
      matchCondition: { priority: 100 },
      steps: [{ stepId: 'step-1', name: 'Single', mode: 'ANY', approverSelector: `USER:${approver.userId}` }]
    });

    const request = engine.createRequest(
      {
        type: 'GENERIC',
        title: 'Team Offsite Request',
        amount: 30000,
        currency: 'JPY'
      },
      requester
    );
    await engine.submitRequest(request.requestId, requester);

    const task = engine.listTasks(admin, { requestId: request.requestId, status: 'PENDING' })[0];
    await engine.decideTask(task!.taskId, approver, 'APPROVE', 'approved');

    const approvedRequest = engine.getRequest(request.requestId, admin);
    expect(approvedRequest.status).toBe('APPROVED');

    await expect(engine.submitRequest(request.requestId, requester)).rejects.toMatchObject({
      message: expect.stringContaining('request is terminal')
    });
    await expect(engine.decideTask(task!.taskId, approver, 'APPROVE', 'retry')).rejects.toMatchObject({
      message: expect.stringContaining('request is terminal')
    });
  });

  it('AW-AUTH-001: request detail is visible only to requester assignee and admin', async () => {
    const engine = new ApprovalEngine();
    const admin = actor('admin-01', ['ADMIN']);
    const requester = actor('requester-01');
    const approver = actor('approver-01');
    const intruder = actor('intruder-01');

    await createAndActivateWorkflow(engine, {
      workflowId: 'wf-auth-request-view',
      name: 'AuthRequestView',
      matchCondition: { priority: 100 },
      steps: [{ stepId: 'step-1', name: 'Single', mode: 'ANY', approverSelector: `USER:${approver.userId}` }]
    });

    const request = engine.createRequest(
      {
        type: 'GENERIC',
        title: 'Request Visibility',
        amount: 15000,
        currency: 'JPY'
      },
      requester
    );
    await engine.submitRequest(request.requestId, requester);

    expect(engine.getRequest(request.requestId, requester).requestId).toBe(request.requestId);
    expect(engine.getRequest(request.requestId, approver).requestId).toBe(request.requestId);
    expect(engine.getRequest(request.requestId, admin).requestId).toBe(request.requestId);
    expect(() => engine.getRequest(request.requestId, intruder)).toThrow(ForbiddenError);
  });

  it('AW-AUTH-002: task decision is denied for non-assignee', async () => {
    const engine = new ApprovalEngine();
    const admin = actor('admin-01', ['ADMIN']);
    const requester = actor('requester-01');
    const approver = actor('approver-01');
    const intruder = actor('intruder-01');

    await createAndActivateWorkflow(engine, {
      workflowId: 'wf-auth',
      name: 'AuthGuard',
      matchCondition: { priority: 100 },
      steps: [{ stepId: 'step-1', name: 'Single', mode: 'ANY', approverSelector: `USER:${approver.userId}` }]
    });

    const request = engine.createRequest(
      {
        type: 'GENERIC',
        title: 'Auth Guard',
        amount: 12345,
        currency: 'JPY'
      },
      requester
    );
    await engine.submitRequest(request.requestId, requester);

    const task = engine.listTasks(admin, { requestId: request.requestId, status: 'PENDING' })[0];
    await expect(engine.decideTask(task!.taskId, intruder, 'APPROVE', 'hijack')).rejects.toBeInstanceOf(
      ForbiddenError
    );

    const stillPending = engine.listTasks(admin, { requestId: request.requestId, status: 'PENDING' });
    expect(stillPending).toHaveLength(1);
    expect(engine.getRequest(request.requestId, admin).status).toBe('IN_REVIEW');
  });

  it('AW-TENANT-001: cross-tenant access to request and task is denied', async () => {
    const engine = new ApprovalEngine();
    const admin = actor('admin-01', ['ADMIN']);
    const requester = actor('requester-01');
    const approver = actor('approver-01');
    const crossTenantRequester: ActorContext = { tenantId: 'tenant-other', userId: requester.userId, roles: [] };
    const crossTenantApprover: ActorContext = { tenantId: 'tenant-other', userId: approver.userId, roles: [] };

    await createAndActivateWorkflow(engine, {
      workflowId: 'wf-auth-tenant',
      name: 'AuthTenant',
      matchCondition: { priority: 100 },
      steps: [{ stepId: 'step-1', name: 'Single', mode: 'ANY', approverSelector: `USER:${approver.userId}` }]
    });

    const request = engine.createRequest(
      {
        type: 'GENERIC',
        title: 'Tenant Guard',
        amount: 18000,
        currency: 'JPY'
      },
      requester
    );
    await engine.submitRequest(request.requestId, requester);

    const pendingTask = engine.listTasks(admin, { requestId: request.requestId, status: 'PENDING' })[0];
    expect(() => engine.getRequest(request.requestId, crossTenantRequester)).toThrow(ForbiddenError);
    await expect(
      engine.decideTask(pendingTask!.taskId, crossTenantApprover, 'APPROVE', 'cross-tenant')
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('AW-REQ-EDIT-01: request update is allowed in DRAFT and denied in IN_REVIEW', async () => {
    const engine = new ApprovalEngine();
    const admin = actor('admin-01', ['ADMIN']);
    const requester = actor('requester-01');
    const approver = actor('approver-01');

    await createAndActivateWorkflow(engine, {
      workflowId: 'wf-edit',
      name: 'EditFlow',
      matchCondition: { priority: 100 },
      steps: [{ stepId: 'step-1', name: 'Single', mode: 'ANY', approverSelector: `USER:${approver.userId}` }]
    });

    const draft = engine.createRequest(
      {
        type: 'GENERIC',
        title: 'Draft before edit',
        amount: 1000,
        currency: 'JPY'
      },
      requester
    );

    const updated = await engine.updateRequest(
      draft.requestId,
      {
        title: 'Draft after edit',
        amount: 2000
      },
      requester
    );
    expect(updated.title).toBe('Draft after edit');
    expect(updated.amount).toBe(2000);

    const auditActions = engine.listAuditLogs(admin, draft.requestId).map((audit) => audit.action);
    expect(auditActions).toContain('REQUEST_UPDATE');

    await engine.submitRequest(draft.requestId, requester);
    await expect(
      engine.updateRequest(
        draft.requestId,
        {
          title: 'Edit after submit'
        },
        requester
      )
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it('AW-REQ-RETURN-01: RETURN moves request to RETURNED and resubmit regenerates first-step tasks', async () => {
    const engine = new ApprovalEngine();
    const admin = actor('admin-01', ['ADMIN']);
    const requester = actor('requester-01');
    const approverA = actor('approver-a');
    const approverB = actor('approver-b');

    engine.upsertOrgRelation({
      tenantId,
      userId: approverA.userId,
      managerUserId: null,
      roles: ['APPROVER']
    });
    engine.upsertOrgRelation({
      tenantId,
      userId: approverB.userId,
      managerUserId: null,
      roles: ['APPROVER']
    });

    await createAndActivateWorkflow(engine, {
      workflowId: 'wf-return',
      name: 'ReturnFlow',
      matchCondition: { priority: 100 },
      steps: [{ stepId: 'step-1', name: 'Dual', mode: 'ALL', approverSelector: 'ROLE:APPROVER' }]
    });

    const created = engine.createRequest(
      {
        type: 'GENERIC',
        title: 'Need correction',
        amount: 10000,
        currency: 'JPY'
      },
      requester
    );
    await engine.submitRequest(created.requestId, requester);

    const pendingBefore = engine.listTasks(admin, { requestId: created.requestId, status: 'PENDING' });
    expect(pendingBefore).toHaveLength(2);
    await engine.decideTask(pendingBefore[0]!.taskId, actor(pendingBefore[0]!.assigneeUserId), 'RETURN', 'fix');

    const returned = engine.getRequest(created.requestId, admin);
    expect(returned.status).toBe('RETURNED');
    expect(engine.listTasks(admin, { requestId: created.requestId, status: 'PENDING' })).toHaveLength(0);
    expect(engine.listAuditLogs(admin, created.requestId).map((audit) => audit.action)).toContain('REQUEST_RETURN');

    await engine.updateRequest(
      created.requestId,
      {
        title: 'Need correction v2'
      },
      requester
    );
    const resubmitted = await engine.submitRequest(created.requestId, requester);
    expect(resubmitted.status).toBe('IN_REVIEW');

    const pendingAfter = engine.listTasks(admin, { requestId: created.requestId, status: 'PENDING' });
    expect(pendingAfter).toHaveLength(2);
  });

  it('AW-WF-002: highest priority active workflow is selected on submit', async () => {
    const engine = new ApprovalEngine();
    const admin = actor('admin-01', ['ADMIN']);
    const requester = actor('requester-01');
    const lowApprover = actor('low-approver');
    const highApprover = actor('high-approver');

    await createAndActivateWorkflow(engine, {
      workflowId: 'wf-low-priority',
      name: 'LowPriority',
      matchCondition: { priority: 10 },
      steps: [{ stepId: 'step-1', name: 'Low', mode: 'ANY', approverSelector: `USER:${lowApprover.userId}` }]
    });
    await createAndActivateWorkflow(engine, {
      workflowId: 'wf-high-priority',
      name: 'HighPriority',
      matchCondition: { priority: 100 },
      steps: [{ stepId: 'step-1', name: 'High', mode: 'ANY', approverSelector: `USER:${highApprover.userId}` }]
    });

    const created = engine.createRequest(
      {
        type: 'GENERIC',
        title: 'Priority check',
        amount: 15000,
        currency: 'JPY'
      },
      requester
    );
    const submitted = await engine.submitRequest(created.requestId, requester);
    expect(submitted.workflowId).toBe('wf-high-priority');

    const tasks = engine.listTasks(admin, { requestId: created.requestId, status: 'PENDING' });
    expect(tasks).toHaveLength(1);
    expect(tasks[0]!.assigneeUserId).toBe(highApprover.userId);
  });

  it('AW-WF-010: submit is rejected when approver selector resolves no users', async () => {
    const engine = new ApprovalEngine();
    const admin = actor('admin-01', ['ADMIN']);
    const requester = actor('requester-01');

    await createAndActivateWorkflow(engine, {
      workflowId: 'wf-no-approver',
      name: 'NoApprover',
      matchCondition: { priority: 100 },
      steps: [{ stepId: 'step-1', name: 'MissingRole', mode: 'ALL', approverSelector: 'ROLE:UNASSIGNED_ROLE' }]
    });

    const created = engine.createRequest(
      {
        type: 'GENERIC',
        title: 'No approver case',
        amount: 5000,
        currency: 'JPY'
      },
      requester
    );

    await expect(engine.submitRequest(created.requestId, requester)).rejects.toBeInstanceOf(ValidationError);
    expect(engine.getRequest(created.requestId, admin).status).toBe('DRAFT');
    expect(engine.listTasks(admin, { requestId: created.requestId })).toHaveLength(0);
  });

  it('AW-ACC-04: audit log keeps submit to final decision trace', async () => {
    const engine = new ApprovalEngine();
    const admin = actor('admin-01', ['ADMIN']);
    const requester = actor('requester-01');
    const approver = actor('approver-01');

    await createAndActivateWorkflow(engine, {
      workflowId: 'wf-audit',
      name: 'AuditPath',
      matchCondition: { priority: 100 },
      steps: [{ stepId: 'step-1', name: 'Single', mode: 'ANY', approverSelector: `USER:${approver.userId}` }]
    });

    const request = engine.createRequest(
      {
        type: 'GENERIC',
        title: 'SaaS Procurement',
        amount: 42000,
        currency: 'JPY'
      },
      requester
    );
    await engine.submitRequest(request.requestId, requester);

    const task = engine.listTasks(admin, { requestId: request.requestId, status: 'PENDING' })[0];
    await engine.decideTask(task!.taskId, approver, 'APPROVE', 'ok');

    const auditLogs = engine.listAuditLogs(admin, request.requestId);
    const actions = auditLogs.map((audit) => audit.action);
    expect(actions).toContain('REQUEST_SUBMIT');
    expect(actions).toContain('TASK_ASSIGN');
    expect(actions).toContain('TASK_APPROVE');
    expect(actions).toContain('REQUEST_APPROVE');
  });
});
