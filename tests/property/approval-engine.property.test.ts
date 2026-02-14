import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { ApprovalEngine } from '../../src/domain/engine.js';
import { ConflictError } from '../../src/domain/errors.js';
import type { ActorContext, RequestStatus, StepMode } from '../../src/domain/types.js';

const tenantId = 'tenant-property';
const terminalStatuses = new Set<RequestStatus>(['APPROVED', 'REJECTED', 'CANCELLED', 'WITHDRAWN']);

function actor(userId: string, roles: string[] = []): ActorContext {
  return { tenantId, userId, roles };
}

function setupScenario(stepSettings: Array<{ mode: StepMode; approverCount: number }>): {
  engine: ApprovalEngine;
  admin: ActorContext;
  requester: ActorContext;
  requestId: string;
  steps: Array<{ stepId: string; mode: StepMode; approverUserIds: string[] }>;
} {
  const engine = new ApprovalEngine();
  const admin = actor('admin-property', ['ADMIN']);
  const requester = actor('requester-property');

  const steps = stepSettings.map((setting, index) => {
    const stepId = `step-${index + 1}`;
    const role = `STEP_ROLE_${index + 1}`;
    const approverUserIds = Array.from({ length: setting.approverCount }, (_, userIndex) => {
      const userId = `approver-${index + 1}-${userIndex + 1}`;
      engine.upsertOrgRelation({
        tenantId,
        userId,
        managerUserId: null,
        roles: [role]
      });
      return userId;
    });
    return { stepId, mode: setting.mode, approverUserIds };
  });

  const created = engine.createWorkflow(
    {
      workflowId: 'wf-property',
      name: 'PropertyWorkflow',
      matchCondition: { priority: 100 },
      steps: steps.map((step) => ({
        stepId: step.stepId,
        name: step.stepId,
        mode: step.mode,
        approverSelector: `ROLE:STEP_ROLE_${Number(step.stepId.split('-')[1])}`
      }))
    },
    admin
  );
  engine.activateWorkflow(created.workflowId, admin);

  const request = engine.createRequest(
    {
      type: 'GENERIC',
      title: 'Property Request',
      amount: 50000,
      currency: 'JPY'
    },
    requester
  );

  return {
    engine,
    admin,
    requester,
    requestId: request.requestId,
    steps
  };
}

describe('Approval Workflow Property', () => {
  it('P-AW-01: request.status==APPROVED implies all steps are satisfied', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(
          fc.record({
            mode: fc.constantFrom<StepMode>('ANY', 'ALL'),
            approverCount: fc.integer({ min: 1, max: 3 })
          }),
          { minLength: 1, maxLength: 3 }
        ),
        fc.array(fc.nat(20), { minLength: 1, maxLength: 20 }),
        async (stepSettings, picks) => {
          const { engine, admin, requester, requestId, steps } = setupScenario(stepSettings);
          await engine.submitRequest(requestId, requester);

          for (const pick of picks) {
            const current = engine.getRequest(requestId, admin);
            if (current.status !== 'IN_REVIEW') {
              break;
            }
            const pending = engine.listTasks(admin, { requestId, status: 'PENDING' });
            if (pending.length === 0) {
              break;
            }
            const target = pending[pick % pending.length]!;
            await engine.decideTask(target.taskId, actor(target.assigneeUserId), 'APPROVE', 'property-approve');
          }

          const request = engine.getRequest(requestId, admin);
          if (request.status !== 'APPROVED') {
            return;
          }

          const tasks = engine.listTasks(admin, { requestId });
          for (const step of steps) {
            const stepTasks = tasks.filter((task) => task.stepId === step.stepId);
            if (step.mode === 'ANY') {
              expect(stepTasks.some((task) => task.status === 'APPROVED')).toBe(true);
            } else {
              expect(stepTasks.length).toBeGreaterThan(0);
              expect(stepTasks.every((task) => task.status === 'APPROVED')).toBe(true);
            }
          }
        }
      ),
      { numRuns: 50 }
    );
  });

  it('P-AW-02/P-AW-03: terminal requests have no pending tasks and no duplicate assignee-task keys', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(
          fc.record({
            mode: fc.constantFrom<StepMode>('ANY', 'ALL'),
            approverCount: fc.integer({ min: 1, max: 3 })
          }),
          { minLength: 1, maxLength: 3 }
        ),
        fc.array(
          fc.record({
            decision: fc.constantFrom<'APPROVE' | 'REJECT'>('APPROVE', 'REJECT'),
            pick: fc.nat(20)
          }),
          { minLength: 1, maxLength: 24 }
        ),
        async (stepSettings, operations) => {
          const { engine, admin, requester, requestId } = setupScenario(stepSettings);
          await engine.submitRequest(requestId, requester);

          for (const operation of operations) {
            const pending = engine.listTasks(admin, { requestId, status: 'PENDING' });
            if (pending.length === 0) {
              break;
            }
            const target = pending[operation.pick % pending.length]!;
            try {
              await engine.decideTask(
                target.taskId,
                actor(target.assigneeUserId),
                operation.decision,
                `property-${operation.decision.toLowerCase()}`
              );
            } catch {
              // 競合時は次の操作へ進める
            }
          }

          const request = engine.getRequest(requestId, admin);
          const tasks = engine.listTasks(admin, { requestId });

          if (terminalStatuses.has(request.status)) {
            expect(tasks.some((task) => task.status === 'PENDING')).toBe(false);
          }

          const keys = tasks.map((task) => `${task.requestId}:${task.stepId}:${task.assigneeUserId}`);
          expect(new Set(keys).size).toBe(keys.length);
        }
      ),
      { numRuns: 50 }
    );
  });

  it('P-AW-04: task decision is idempotent (second submission is 409)', async () => {
    await fc.assert(
      fc.asyncProperty(fc.constantFrom<'APPROVE' | 'REJECT'>('APPROVE', 'REJECT'), async (decision) => {
        const { engine, admin, requester, requestId } = setupScenario([{ mode: 'ANY', approverCount: 1 }]);
        await engine.submitRequest(requestId, requester);

        const task = engine.listTasks(admin, { requestId, status: 'PENDING' })[0]!;
        const taskActor = actor(task.assigneeUserId);

        await engine.decideTask(task.taskId, taskActor, decision, 'first');

        const afterFirstRequest = engine.getRequest(requestId, admin);
        const afterFirstTask = engine.listTasks(admin, { requestId }).find((item) => item.taskId === task.taskId)!;
        const afterFirstAuditCount = engine.listAuditLogs(admin, requestId).length;

        await expect(engine.decideTask(task.taskId, taskActor, decision, 'second')).rejects.toBeInstanceOf(
          ConflictError
        );

        const afterSecondRequest = engine.getRequest(requestId, admin);
        const afterSecondTask = engine.listTasks(admin, { requestId }).find((item) => item.taskId === task.taskId)!;
        const afterSecondAuditCount = engine.listAuditLogs(admin, requestId).length;

        expect(afterSecondRequest.status).toBe(afterFirstRequest.status);
        expect(afterSecondTask.status).toBe(afterFirstTask.status);
        expect(afterSecondAuditCount).toBe(afterFirstAuditCount);
      }),
      { numRuns: 40 }
    );
  });
});
