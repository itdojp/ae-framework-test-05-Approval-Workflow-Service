import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { ApprovalEngine } from '../../src/domain/engine.js';
import { ConflictError } from '../../src/domain/errors.js';
import type { ActorContext, RequestStatus } from '../../src/domain/types.js';

const tenantId = 'tenant-mbt';
const terminalStatuses = new Set<RequestStatus>(['APPROVED', 'REJECTED', 'CANCELLED', 'WITHDRAWN']);

type Operation = 'submit' | 'update' | 'approve' | 'reject' | 'withdraw' | 'cancel';
type StepState = 'NONE' | 'STEP1' | 'STEP2' | 'DONE';

interface ModelState {
  status: RequestStatus;
  step: StepState;
}

function actor(userId: string, roles: string[] = []): ActorContext {
  return { tenantId, userId, roles };
}

async function setupScenario() {
  const engine = new ApprovalEngine();
  const admin = actor('admin-01', ['ADMIN']);
  const requester = actor('requester-01');

  engine.upsertOrgRelation({
    tenantId,
    userId: 'approver-a',
    managerUserId: null,
    roles: ['STEP1']
  });
  engine.upsertOrgRelation({
    tenantId,
    userId: 'approver-b',
    managerUserId: null,
    roles: ['STEP1']
  });
  engine.upsertOrgRelation({
    tenantId,
    userId: 'approver-c',
    managerUserId: null,
    roles: ['STEP2']
  });

  const workflow = engine.createWorkflow(
    {
      workflowId: 'wf-mbt',
      name: 'MBTWorkflow',
      matchCondition: { priority: 100 },
      steps: [
        { stepId: 'step-1', name: 'AnyStep', mode: 'ANY', approverSelector: 'ROLE:STEP1' },
        { stepId: 'step-2', name: 'AllStep', mode: 'ALL', approverSelector: 'ROLE:STEP2' }
      ]
    },
    admin
  );
  engine.activateWorkflow(workflow.workflowId, admin);

  const request = engine.createRequest(
    {
      type: 'GENERIC',
      title: 'MBT Request',
      amount: 45000,
      currency: 'JPY'
    },
    requester
  );

  return {
    engine,
    admin,
    requester,
    requestId: request.requestId
  };
}

function canApply(model: ModelState, operation: Operation): boolean {
  switch (operation) {
    case 'submit':
      return model.status === 'DRAFT' || model.status === 'RETURNED';
    case 'update':
      return model.status === 'DRAFT' || model.status === 'RETURNED';
    case 'approve':
    case 'reject':
      return model.status === 'IN_REVIEW';
    case 'withdraw':
      return model.status === 'SUBMITTED' || model.status === 'IN_REVIEW' || model.status === 'RETURNED';
    case 'cancel':
      return model.status === 'DRAFT' || model.status === 'SUBMITTED';
    default:
      return false;
  }
}

function applyModel(model: ModelState, operation: Operation): ModelState {
  switch (operation) {
    case 'submit':
      return { status: 'IN_REVIEW', step: 'STEP1' };
    case 'update':
      return model;
    case 'approve':
      if (model.step === 'STEP1') {
        return { status: 'IN_REVIEW', step: 'STEP2' };
      }
      if (model.step === 'STEP2') {
        return { status: 'APPROVED', step: 'DONE' };
      }
      return model;
    case 'reject':
      return { status: 'REJECTED', step: 'DONE' };
    case 'withdraw':
      return { status: 'WITHDRAWN', step: 'DONE' };
    case 'cancel':
      return { status: 'CANCELLED', step: 'DONE' };
    default:
      return model;
  }
}

async function runOperation(
  engine: ApprovalEngine,
  requestId: string,
  requester: ActorContext,
  admin: ActorContext,
  operation: Operation
): Promise<boolean> {
  try {
    switch (operation) {
      case 'submit':
        await engine.submitRequest(requestId, requester);
        return true;
      case 'update':
        await engine.updateRequest(
          requestId,
          {
            title: `MBT Updated ${Date.now()}`,
            amount: 46000
          },
          requester
        );
        return true;
      case 'approve': {
        const pending = engine.listTasks(admin, { requestId, status: 'PENDING' });
        if (pending.length === 0) {
          throw new ConflictError('no pending task');
        }
        const task = pending[0]!;
        await engine.decideTask(task.taskId, actor(task.assigneeUserId), 'APPROVE', 'mbt-approve');
        return true;
      }
      case 'reject': {
        const pending = engine.listTasks(admin, { requestId, status: 'PENDING' });
        if (pending.length === 0) {
          throw new ConflictError('no pending task');
        }
        const task = pending[0]!;
        await engine.decideTask(task.taskId, actor(task.assigneeUserId), 'REJECT', 'mbt-reject');
        return true;
      }
      case 'withdraw':
        await engine.withdrawRequest(requestId, requester);
        return true;
      case 'cancel':
        await engine.cancelRequest(requestId, requester);
        return true;
      default:
        return false;
    }
  } catch {
    return false;
  }
}

describe('Approval Workflow MBT', () => {
  it('AW-MBT-01: generated operation sequence follows request state machine', async () => {
    await fc.assert(
      fc.asyncProperty(fc.array(fc.constantFrom<Operation>('submit', 'update', 'approve', 'reject', 'withdraw', 'cancel'), { minLength: 1, maxLength: 20 }), async (operations) => {
        const { engine, admin, requester, requestId } = await setupScenario();
        let model: ModelState = { status: 'DRAFT', step: 'NONE' };

        for (const operation of operations) {
          const expectedValid = canApply(model, operation);
          const actualValid = await runOperation(engine, requestId, requester, admin, operation);

          expect(actualValid).toBe(expectedValid);

          if (actualValid) {
            model = applyModel(model, operation);
          }

          const request = engine.getRequest(requestId, admin);
          expect(request.status).toBe(model.status);

          const tasks = engine.listTasks(admin, { requestId });
          if (terminalStatuses.has(request.status)) {
            expect(tasks.some((task) => task.status === 'PENDING')).toBe(false);
          }

          const keys = tasks.map((task) => `${task.requestId}:${task.stepId}:${task.assigneeUserId}`);
          expect(new Set(keys).size).toBe(keys.length);
        }
      }),
      { numRuns: 60 }
    );
  });
});
