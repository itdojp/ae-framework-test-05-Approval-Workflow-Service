import { describe, expect, it } from 'vitest';
import { ApprovalEngine } from '../../src/domain/engine.js';
import { ConflictError, ForbiddenError } from '../../src/domain/errors.js';
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
