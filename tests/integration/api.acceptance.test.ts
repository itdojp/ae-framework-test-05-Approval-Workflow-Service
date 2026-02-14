import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../../src/api/app.js';
import { ApprovalEngine } from '../../src/domain/engine.js';

const tenantId = 'tenant-api';

function headers(userId: string, roles: string[] = []): Record<string, string> {
  return {
    'x-tenant-id': tenantId,
    'x-user-id': userId,
    'x-roles': roles.join(',')
  };
}

async function upsertRelation(
  app: ReturnType<typeof createApp>,
  targetUserId: string,
  roles: string[],
  managerUserId: string | null = null
): Promise<void> {
  const res = await request(app)
    .post('/api/v1/org-relations')
    .set(headers('admin-01', ['ADMIN']))
    .send({ userId: targetUserId, managerUserId, roles });
  expect(res.status).toBe(201);
}

async function createActiveWorkflow(
  app: ReturnType<typeof createApp>,
  workflowId: string,
  body: Record<string, unknown>
): Promise<void> {
  const createRes = await request(app)
    .post('/api/v1/workflows')
    .set(headers('admin-01', ['ADMIN']))
    .send(body);
  expect(createRes.status).toBe(201);

  const activateRes = await request(app)
    .post(`/api/v1/workflows/${workflowId}/activate`)
    .set(headers('admin-01', ['ADMIN']))
    .send({});
  expect(activateRes.status).toBe(200);
}

describe('API acceptance', () => {
  it('UI-AW-00: serves workflow console static UI', async () => {
    const app = createApp(new ApprovalEngine());

    const rootRes = await request(app).get('/');
    expect(rootRes.status).toBe(302);
    expect(rootRes.headers.location).toBe('/ui/');

    const uiRes = await request(app).get('/ui/');
    expect(uiRes.status).toBe(200);
    expect(uiRes.text).toContain('Workflow Console');
  });

  it('AW-ACC-01: ANY step concurrent approve does not duplicate next step tasks', async () => {
    const app = createApp(new ApprovalEngine());

    await upsertRelation(app, 'approver-a', ['DEPT_HEAD']);
    await upsertRelation(app, 'approver-b', ['DEPT_HEAD']);
    await upsertRelation(app, 'final-approver', ['FINANCE']);

    await createActiveWorkflow(app, 'wf-api-any', {
      workflowId: 'wf-api-any',
      name: 'ApiAny',
      matchCondition: { priority: 100 },
      steps: [
        { stepId: 'step-1', name: 'Dept', mode: 'ANY', approverSelector: 'ROLE:DEPT_HEAD' },
        { stepId: 'step-2', name: 'Finance', mode: 'ALL', approverSelector: 'USER:final-approver' }
      ]
    });

    const createReqRes = await request(app).post('/api/v1/requests').set(headers('requester-01')).send({
      type: 'GENERIC',
      title: 'Concurrent Approval',
      amount: 100000,
      currency: 'JPY'
    });
    expect(createReqRes.status).toBe(201);
    const requestId = createReqRes.body.requestId as string;

    const submitRes = await request(app)
      .post(`/api/v1/requests/${requestId}/submit`)
      .set(headers('requester-01'))
      .send({});
    expect(submitRes.status).toBe(200);
    expect(submitRes.body.status).toBe('IN_REVIEW');

    const taskListRes = await request(app)
      .get('/api/v1/tasks')
      .query({ requestId, status: 'PENDING' })
      .set(headers('admin-01', ['ADMIN']));
    expect(taskListRes.status).toBe(200);
    const step1Tasks = (taskListRes.body as Array<any>).filter((task) => task.stepId === 'step-1');
    expect(step1Tasks).toHaveLength(2);

    const [r1, r2] = await Promise.allSettled([
      request(app)
        .post(`/api/v1/tasks/${step1Tasks[0]!.taskId}/decide`)
        .set(headers(step1Tasks[0]!.assigneeUserId))
        .send({ decision: 'APPROVE', comment: 'ok' }),
      request(app)
        .post(`/api/v1/tasks/${step1Tasks[1]!.taskId}/decide`)
        .set(headers(step1Tasks[1]!.assigneeUserId))
        .send({ decision: 'APPROVE', comment: 'ok' })
    ]);

    const statuses = [r1, r2].map((item) => (item.status === 'fulfilled' ? item.value.status : 500));
    expect(statuses.filter((status) => status === 200)).toHaveLength(1);
    expect(statuses.filter((status) => status === 409)).toHaveLength(1);

    const allTasksRes = await request(app)
      .get('/api/v1/tasks')
      .query({ requestId })
      .set(headers('admin-01', ['ADMIN']));
    const allTasks = allTasksRes.body as Array<any>;
    expect(allTasks.filter((task) => task.stepId === 'step-2')).toHaveLength(1);
  });

  it('AW-ACC-02: reject closes pending tasks and request ends as REJECTED', async () => {
    const app = createApp(new ApprovalEngine());

    await upsertRelation(app, 'approver-a', ['APPROVER']);
    await upsertRelation(app, 'approver-b', ['APPROVER']);

    await createActiveWorkflow(app, 'wf-api-reject', {
      workflowId: 'wf-api-reject',
      name: 'ApiReject',
      matchCondition: { priority: 100 },
      steps: [{ stepId: 'step-1', name: 'Approval', mode: 'ALL', approverSelector: 'ROLE:APPROVER' }]
    });

    const createReqRes = await request(app).post('/api/v1/requests').set(headers('requester-01')).send({
      type: 'GENERIC',
      title: 'Reject Flow',
      amount: 80000,
      currency: 'JPY'
    });
    const requestId = createReqRes.body.requestId as string;
    await request(app).post(`/api/v1/requests/${requestId}/submit`).set(headers('requester-01')).send({});

    const pendingRes = await request(app)
      .get('/api/v1/tasks')
      .query({ requestId, status: 'PENDING' })
      .set(headers('admin-01', ['ADMIN']));
    const pending = pendingRes.body as Array<any>;
    expect(pending).toHaveLength(2);

    const rejectRes = await request(app)
      .post(`/api/v1/tasks/${pending[0]!.taskId}/decide`)
      .set(headers(pending[0]!.assigneeUserId))
      .send({ decision: 'REJECT', comment: 'ng' });
    expect(rejectRes.status).toBe(200);
    expect(rejectRes.body.request.status).toBe('REJECTED');

    const taskRes = await request(app)
      .get('/api/v1/tasks')
      .query({ requestId })
      .set(headers('admin-01', ['ADMIN']));
    const tasks = taskRes.body as Array<any>;
    expect(tasks.some((task) => task.status === 'PENDING')).toBe(false);
    expect(tasks.some((task) => task.status === 'CANCELLED')).toBe(true);
  });

  it('AW-ACC-03: submit and decide return 409 after terminal', async () => {
    const app = createApp(new ApprovalEngine());

    await createActiveWorkflow(app, 'wf-api-terminal', {
      workflowId: 'wf-api-terminal',
      name: 'ApiTerminal',
      matchCondition: { priority: 100 },
      steps: [{ stepId: 'step-1', name: 'Single', mode: 'ANY', approverSelector: 'USER:approver-01' }]
    });

    const createReqRes = await request(app).post('/api/v1/requests').set(headers('requester-01')).send({
      type: 'GENERIC',
      title: 'Terminal Flow',
      amount: 10000,
      currency: 'JPY'
    });
    const requestId = createReqRes.body.requestId as string;
    await request(app).post(`/api/v1/requests/${requestId}/submit`).set(headers('requester-01')).send({});

    const pendingRes = await request(app)
      .get('/api/v1/tasks')
      .query({ requestId, status: 'PENDING' })
      .set(headers('admin-01', ['ADMIN']));
    const pending = pendingRes.body as Array<any>;
    const taskId = pending[0]!.taskId as string;

    const approveRes = await request(app)
      .post(`/api/v1/tasks/${taskId}/decide`)
      .set(headers('approver-01'))
      .send({ decision: 'APPROVE', comment: 'ok' });
    expect(approveRes.status).toBe(200);
    expect(approveRes.body.request.status).toBe('APPROVED');

    const submitAgain = await request(app)
      .post(`/api/v1/requests/${requestId}/submit`)
      .set(headers('requester-01'))
      .send({});
    expect(submitAgain.status).toBe(409);
    expect(submitAgain.body.message).toContain('request is terminal');

    const decideAgain = await request(app)
      .post(`/api/v1/tasks/${taskId}/decide`)
      .set(headers('approver-01'))
      .send({ decision: 'APPROVE', comment: 'retry' });
    expect(decideAgain.status).toBe(409);
    expect(decideAgain.body.message).toContain('request is terminal');
  });

  it('AW-AUTH-002: non-assignee cannot decide task', async () => {
    const app = createApp(new ApprovalEngine());

    await createActiveWorkflow(app, 'wf-api-auth', {
      workflowId: 'wf-api-auth',
      name: 'ApiAuth',
      matchCondition: { priority: 100 },
      steps: [{ stepId: 'step-1', name: 'Single', mode: 'ANY', approverSelector: 'USER:approver-01' }]
    });

    const createReqRes = await request(app).post('/api/v1/requests').set(headers('requester-01')).send({
      type: 'GENERIC',
      title: 'Auth Flow',
      amount: 20000,
      currency: 'JPY'
    });
    const requestId = createReqRes.body.requestId as string;
    await request(app).post(`/api/v1/requests/${requestId}/submit`).set(headers('requester-01')).send({});

    const pendingRes = await request(app)
      .get('/api/v1/tasks')
      .query({ requestId, status: 'PENDING' })
      .set(headers('admin-01', ['ADMIN']));
    const taskId = (pendingRes.body as Array<any>)[0]!.taskId as string;

    const forbiddenRes = await request(app)
      .post(`/api/v1/tasks/${taskId}/decide`)
      .set(headers('intruder-01'))
      .send({ decision: 'APPROVE', comment: 'hijack' });
    expect(forbiddenRes.status).toBe(403);
    expect(forbiddenRes.body.code).toBe('FORBIDDEN');

    const requestRes = await request(app)
      .get(`/api/v1/requests/${requestId}`)
      .set(headers('requester-01'));
    expect(requestRes.status).toBe(200);
    expect(requestRes.body.status).toBe('IN_REVIEW');

    const stillPending = await request(app)
      .get('/api/v1/tasks')
      .query({ requestId, status: 'PENDING' })
      .set(headers('admin-01', ['ADMIN']));
    expect((stillPending.body as Array<any>)).toHaveLength(1);
  });

  it('AW-REQ-EDIT-01: PATCH updates DRAFT and returns 409 after submit', async () => {
    const app = createApp(new ApprovalEngine());

    await createActiveWorkflow(app, 'wf-api-edit', {
      workflowId: 'wf-api-edit',
      name: 'ApiEdit',
      matchCondition: { priority: 100 },
      steps: [{ stepId: 'step-1', name: 'Single', mode: 'ANY', approverSelector: 'USER:approver-01' }]
    });

    const createReqRes = await request(app).post('/api/v1/requests').set(headers('requester-01')).send({
      type: 'GENERIC',
      title: 'Before Edit',
      amount: 1000,
      currency: 'JPY'
    });
    expect(createReqRes.status).toBe(201);
    const requestId = createReqRes.body.requestId as string;

    const patchDraft = await request(app).patch(`/api/v1/requests/${requestId}`).set(headers('requester-01')).send({
      title: 'After Edit',
      amount: 2000
    });
    expect(patchDraft.status).toBe(200);
    expect(patchDraft.body.title).toBe('After Edit');
    expect(patchDraft.body.amount).toBe(2000);

    const submitRes = await request(app)
      .post(`/api/v1/requests/${requestId}/submit`)
      .set(headers('requester-01'))
      .send({});
    expect(submitRes.status).toBe(200);
    expect(submitRes.body.status).toBe('IN_REVIEW');

    const patchReview = await request(app)
      .patch(`/api/v1/requests/${requestId}`)
      .set(headers('requester-01'))
      .send({ title: 'Edit in review' });
    expect(patchReview.status).toBe(409);
  });

  it('AW-REQ-RETURN-01: RETURN leads to RETURNED and submit works as resubmit', async () => {
    const app = createApp(new ApprovalEngine());

    await upsertRelation(app, 'approver-a', ['APPROVER']);
    await upsertRelation(app, 'approver-b', ['APPROVER']);

    await createActiveWorkflow(app, 'wf-api-return', {
      workflowId: 'wf-api-return',
      name: 'ApiReturn',
      matchCondition: { priority: 100 },
      steps: [{ stepId: 'step-1', name: 'Dual', mode: 'ALL', approverSelector: 'ROLE:APPROVER' }]
    });

    const createReqRes = await request(app).post('/api/v1/requests').set(headers('requester-01')).send({
      type: 'GENERIC',
      title: 'Need correction',
      amount: 12000,
      currency: 'JPY'
    });
    const requestId = createReqRes.body.requestId as string;

    await request(app).post(`/api/v1/requests/${requestId}/submit`).set(headers('requester-01')).send({});
    const pendingRes = await request(app)
      .get('/api/v1/tasks')
      .query({ requestId, status: 'PENDING' })
      .set(headers('admin-01', ['ADMIN']));
    const pending = pendingRes.body as Array<any>;
    expect(pending).toHaveLength(2);

    const returnRes = await request(app)
      .post(`/api/v1/tasks/${pending[0]!.taskId}/decide`)
      .set(headers(pending[0]!.assigneeUserId))
      .send({ decision: 'RETURN', comment: 'fix and resubmit' });
    expect(returnRes.status).toBe(200);
    expect(returnRes.body.request.status).toBe('RETURNED');

    const patchReturned = await request(app)
      .patch(`/api/v1/requests/${requestId}`)
      .set(headers('requester-01'))
      .send({ title: 'Need correction v2' });
    expect(patchReturned.status).toBe(200);

    const resubmitRes = await request(app)
      .post(`/api/v1/requests/${requestId}/submit`)
      .set(headers('requester-01'))
      .send({});
    expect(resubmitRes.status).toBe(200);
    expect(resubmitRes.body.status).toBe('IN_REVIEW');

    const pendingAfterRes = await request(app)
      .get('/api/v1/tasks')
      .query({ requestId, status: 'PENDING' })
      .set(headers('admin-01', ['ADMIN']));
    expect((pendingAfterRes.body as Array<any>)).toHaveLength(2);

    const auditRes = await request(app)
      .get('/api/v1/audit-logs')
      .query({ requestId })
      .set(headers('admin-01', ['ADMIN']));
    const actions = (auditRes.body as Array<any>).map((audit) => audit.action);
    expect(actions).toContain('REQUEST_RETURN');
  });

  it('AW-WF-002: submit selects highest priority workflow among active matches', async () => {
    const app = createApp(new ApprovalEngine());

    await createActiveWorkflow(app, 'wf-api-low-priority', {
      workflowId: 'wf-api-low-priority',
      name: 'ApiLowPriority',
      matchCondition: { priority: 10 },
      steps: [{ stepId: 'step-1', name: 'Low', mode: 'ANY', approverSelector: 'USER:low-approver' }]
    });
    await createActiveWorkflow(app, 'wf-api-high-priority', {
      workflowId: 'wf-api-high-priority',
      name: 'ApiHighPriority',
      matchCondition: { priority: 100 },
      steps: [{ stepId: 'step-1', name: 'High', mode: 'ANY', approverSelector: 'USER:high-approver' }]
    });

    const createReqRes = await request(app).post('/api/v1/requests').set(headers('requester-01')).send({
      type: 'GENERIC',
      title: 'Priority Selection',
      amount: 13000,
      currency: 'JPY'
    });
    expect(createReqRes.status).toBe(201);
    const requestId = createReqRes.body.requestId as string;

    const submitRes = await request(app)
      .post(`/api/v1/requests/${requestId}/submit`)
      .set(headers('requester-01'))
      .send({});
    expect(submitRes.status).toBe(200);
    expect(submitRes.body.workflowId).toBe('wf-api-high-priority');

    const pendingRes = await request(app)
      .get('/api/v1/tasks')
      .query({ requestId, status: 'PENDING' })
      .set(headers('admin-01', ['ADMIN']));
    expect(pendingRes.status).toBe(200);
    expect((pendingRes.body as Array<any>)).toHaveLength(1);
    expect((pendingRes.body as Array<any>)[0]!.assigneeUserId).toBe('high-approver');
  });

  it('AW-WF-010: submit returns 422 when no approver is resolved', async () => {
    const app = createApp(new ApprovalEngine());

    await createActiveWorkflow(app, 'wf-api-no-approver', {
      workflowId: 'wf-api-no-approver',
      name: 'ApiNoApprover',
      matchCondition: { priority: 100 },
      steps: [{ stepId: 'step-1', name: 'MissingRole', mode: 'ALL', approverSelector: 'ROLE:UNASSIGNED_ROLE' }]
    });

    const createReqRes = await request(app).post('/api/v1/requests').set(headers('requester-01')).send({
      type: 'GENERIC',
      title: 'No Approver',
      amount: 7000,
      currency: 'JPY'
    });
    expect(createReqRes.status).toBe(201);
    const requestId = createReqRes.body.requestId as string;

    const submitRes = await request(app)
      .post(`/api/v1/requests/${requestId}/submit`)
      .set(headers('requester-01'))
      .send({});
    expect(submitRes.status).toBe(422);
    expect(submitRes.body.message).toContain('no approver resolved');

    const requestRes = await request(app)
      .get(`/api/v1/requests/${requestId}`)
      .set(headers('requester-01'));
    expect(requestRes.status).toBe(200);
    expect(requestRes.body.status).toBe('DRAFT');
  });

  it('AW-ACC-04: audit logs keep submit to final decision', async () => {
    const app = createApp(new ApprovalEngine());

    await createActiveWorkflow(app, 'wf-api-audit', {
      workflowId: 'wf-api-audit',
      name: 'ApiAudit',
      matchCondition: { priority: 100 },
      steps: [{ stepId: 'step-1', name: 'Single', mode: 'ANY', approverSelector: 'USER:approver-01' }]
    });

    const createReqRes = await request(app).post('/api/v1/requests').set(headers('requester-01')).send({
      type: 'GENERIC',
      title: 'Audit Flow',
      amount: 50000,
      currency: 'JPY'
    });
    const requestId = createReqRes.body.requestId as string;
    await request(app).post(`/api/v1/requests/${requestId}/submit`).set(headers('requester-01')).send({});

    const pendingRes = await request(app)
      .get('/api/v1/tasks')
      .query({ requestId, status: 'PENDING' })
      .set(headers('admin-01', ['ADMIN']));
    const taskId = (pendingRes.body as Array<any>)[0]!.taskId as string;

    await request(app)
      .post(`/api/v1/tasks/${taskId}/decide`)
      .set(headers('approver-01'))
      .send({ decision: 'APPROVE', comment: 'ok' });

    const auditRes = await request(app)
      .get('/api/v1/audit-logs')
      .query({ requestId })
      .set(headers('admin-01', ['ADMIN']));
    expect(auditRes.status).toBe(200);
    const actions = (auditRes.body as Array<any>).map((audit) => audit.action);
    expect(actions).toContain('REQUEST_SUBMIT');
    expect(actions).toContain('TASK_ASSIGN');
    expect(actions).toContain('TASK_APPROVE');
    expect(actions).toContain('REQUEST_APPROVE');
  });
});
