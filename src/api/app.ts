import express, { type Request, type Response, type NextFunction } from 'express';
import { ApprovalEngine } from '../domain/engine.js';
import { DomainError, ValidationError } from '../domain/errors.js';
import type { ActorContext, TaskDecision } from '../domain/types.js';

function actorFromRequest(req: Request): ActorContext {
  const tenantId = (req.header('x-tenant-id') || '').trim() || 'tenant-default';
  const userId = (req.header('x-user-id') || '').trim();
  if (!userId) {
    throw new ValidationError('x-user-id header is required');
  }
  const rolesRaw = (req.header('x-roles') || '').trim();
  const roles = rolesRaw
    ? rolesRaw
        .split(',')
        .map((role) => role.trim())
        .filter(Boolean)
    : [];
  return { tenantId, userId, roles };
}

function parseTaskDecision(value: unknown): TaskDecision {
  if (value === 'APPROVE' || value === 'REJECT' || value === 'RETURN') {
    return value;
  }
  throw new ValidationError('decision must be APPROVE or REJECT');
}

export function createApp(engine: ApprovalEngine): express.Express {
  const app = express();
  app.use(express.json({ limit: '1mb' }));

  app.get('/healthz', (_req, res) => {
    res.status(200).json({ ok: true });
  });

  app.post('/api/v1/org-relations', (req, res) => {
    const actor = actorFromRequest(req);
    if (!actor.roles.includes('ADMIN')) {
      throw new ValidationError('ADMIN role is required to manage org relations');
    }
    const relation = engine.upsertOrgRelation({
      tenantId: actor.tenantId,
      userId: String(req.body.userId || '').trim(),
      managerUserId: req.body.managerUserId ? String(req.body.managerUserId) : null,
      roles: Array.isArray(req.body.roles) ? req.body.roles.map(String) : []
    });
    res.status(201).json(relation);
  });

  app.post('/api/v1/workflows', (req, res) => {
    const actor = actorFromRequest(req);
    if (!actor.roles.includes('ADMIN')) {
      throw new ValidationError('ADMIN role is required to create workflow');
    }
    const workflow = engine.createWorkflow(
      {
        workflowId: req.body.workflowId,
        name: String(req.body.name || ''),
        version: req.body.version,
        matchCondition: req.body.matchCondition,
        steps: req.body.steps
      },
      actor
    );
    res.status(201).json(workflow);
  });

  app.post('/api/v1/workflows/:workflowId/activate', (req, res) => {
    const actor = actorFromRequest(req);
    if (!actor.roles.includes('ADMIN')) {
      throw new ValidationError('ADMIN role is required to activate workflow');
    }
    const workflow = engine.activateWorkflow(req.params.workflowId, actor);
    res.status(200).json(workflow);
  });

  app.post('/api/v1/workflows/:workflowId/deactivate', (req, res) => {
    const actor = actorFromRequest(req);
    if (!actor.roles.includes('ADMIN')) {
      throw new ValidationError('ADMIN role is required to deactivate workflow');
    }
    const workflow = engine.deactivateWorkflow(req.params.workflowId, actor);
    res.status(200).json(workflow);
  });

  app.get('/api/v1/workflows', (req, res) => {
    const actor = actorFromRequest(req);
    res.status(200).json(engine.listWorkflows(actor));
  });

  app.post('/api/v1/requests', (req, res) => {
    const actor = actorFromRequest(req);
    const created = engine.createRequest(
      {
        type: req.body.type,
        title: req.body.title,
        description: req.body.description,
        amount: req.body.amount,
        currency: req.body.currency
      },
      actor
    );
    res.status(201).json(created);
  });

  app.post('/api/v1/requests/:requestId/submit', async (req, res) => {
    const actor = actorFromRequest(req);
    const request = await engine.submitRequest(req.params.requestId, actor);
    res.status(200).json(request);
  });

  app.post('/api/v1/requests/:requestId/withdraw', async (req, res) => {
    const actor = actorFromRequest(req);
    const request = await engine.withdrawRequest(req.params.requestId, actor);
    res.status(200).json(request);
  });

  app.post('/api/v1/requests/:requestId/cancel', async (req, res) => {
    const actor = actorFromRequest(req);
    const request = await engine.cancelRequest(req.params.requestId, actor);
    res.status(200).json(request);
  });

  app.get('/api/v1/requests', (req, res) => {
    const actor = actorFromRequest(req);
    res.status(200).json(engine.listRequests(actor));
  });

  app.get('/api/v1/requests/:requestId', (req, res) => {
    const actor = actorFromRequest(req);
    res.status(200).json(engine.getRequest(req.params.requestId, actor));
  });

  app.get('/api/v1/tasks', (req, res) => {
    const actor = actorFromRequest(req);
    const status = req.query.status ? String(req.query.status) : undefined;
    const requestId = req.query.requestId ? String(req.query.requestId) : undefined;
    const assigneeUserId = req.query.assigneeUserId ? String(req.query.assigneeUserId) : undefined;
    res.status(200).json(engine.listTasks(actor, { status: status as any, requestId, assigneeUserId }));
  });

  app.post('/api/v1/tasks/:taskId/decide', async (req, res) => {
    const actor = actorFromRequest(req);
    const result = await engine.decideTask(
      req.params.taskId,
      actor,
      parseTaskDecision(req.body.decision),
      req.body.comment
    );
    res.status(200).json(result);
  });

  app.get('/api/v1/audit-logs', (req, res) => {
    const actor = actorFromRequest(req);
    const requestId = req.query.requestId ? String(req.query.requestId) : undefined;
    res.status(200).json(engine.listAuditLogs(actor, requestId));
  });

  app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (error instanceof DomainError) {
      res.status(error.statusCode).json({
        code: error.code,
        message: error.message
      });
      return;
    }
    const message = error instanceof Error ? error.message : 'internal server error';
    res.status(500).json({ code: 'INTERNAL_ERROR', message });
  });

  return app;
}

