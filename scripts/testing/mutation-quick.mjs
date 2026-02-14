#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const projectRoot = process.cwd();
const enginePath = resolve(projectRoot, 'src/domain/engine.ts');
const outDir = resolve(projectRoot, 'artifacts/mutation');
const summaryPath = resolve(outDir, 'summary.json');

const mutants = [
  {
    id: 'MUT-AW-ANY-ALL-INVERSION',
    description: 'ANY/ALL 分岐反転',
    find: "    if (step.mode === 'ANY') {\n",
    replace: "    if (step.mode !== 'ANY') {\n",
    testArgs: ['exec', 'vitest', 'run', 'tests/acceptance/approval-engine.acceptance.test.ts', '-t', 'AW-ACC-01']
  },
  {
    id: 'MUT-AW-TERMINAL-GUARD-DROP',
    description: '終端状態ガードの欠落（decideTask）',
    find:
      "      if (TERMINAL_STATUSES.has(request.status)) {\n" +
      '        throw new ConflictError(`request is terminal: ${request.status}`);\n' +
      '      }\n' +
      "      if (request.status !== 'IN_REVIEW') {\n",
    replace: "      if (request.status !== 'IN_REVIEW') {\n",
    testArgs: ['exec', 'vitest', 'run', 'tests/acceptance/approval-engine.acceptance.test.ts', '-t', 'AW-ACC-03']
  },
  {
    id: 'MUT-AW-ASSIGNEE-GUARD-DROP',
    description: 'assignee チェック欠落',
    find:
      "      if (!this.isAdmin(actor) && lockedTask.assigneeUserId !== actor.userId) {\n" +
      "        throw new ForbiddenError('only task assignee can decide');\n" +
      '      }\n',
    replace: '',
    testArgs: ['exec', 'vitest', 'run', 'tests/acceptance/approval-engine.acceptance.test.ts', '-t', 'AW-AUTH-002']
  },
  {
    id: 'MUT-AW-REQUEST-VIEW-GUARD-DROP',
    description: 'request閲覧ガードの欠落',
    find:
      "      if (!assigned) {\n" +
      "        throw new ForbiddenError('request access is denied');\n" +
      '      }\n',
    replace:
      "      if (!assigned) {\n" +
      '        // mutation: allow unauthorized request read\n' +
      '      }\n',
    testArgs: ['exec', 'vitest', 'run', 'tests/acceptance/approval-engine.acceptance.test.ts', '-t', 'AW-AUTH-001']
  },
  {
    id: 'MUT-AW-TENANT-GUARD-DROP',
    description: 'tenant分離ガードの欠落',
    find:
      '    if (actorTenantId !== resourceTenantId) {\n' +
      "      throw new ForbiddenError('cross-tenant access is denied');\n" +
      '    }\n',
    replace:
      '    if (actorTenantId !== resourceTenantId) {\n' +
      '      // mutation: allow cross-tenant access\n' +
      '    }\n',
    testArgs: ['exec', 'vitest', 'run', 'tests/acceptance/approval-engine.acceptance.test.ts', '-t', 'AW-TENANT-001']
  },
  {
    id: 'MUT-AW-WF-PRIORITY-ORDER-BROKEN',
    description: 'workflow priority 比較順の逆転',
    find: '          return bp - ap;\n',
    replace: '          return ap - bp;\n',
    testArgs: ['exec', 'vitest', 'run', 'tests/acceptance/approval-engine.acceptance.test.ts', '-t', 'AW-WF-002']
  },
  {
    id: 'MUT-AW-WF-NO-APPROVER-GUARD-DROP',
    description: 'submit時の approver 未解決ガード欠落',
    find:
      '        if (firstApprovers.length === 0) {\n' +
      '          throw new ValidationError(`no approver resolved for step ${firstStep.stepId}`);\n' +
      '        }\n',
    replace: '',
    testArgs: ['exec', 'vitest', 'run', 'tests/acceptance/approval-engine.acceptance.test.ts', '-t', 'AW-WF-010']
  },
  {
    id: 'MUT-AW-RETURN-TO-REJECT',
    description: 'RETURN 決裁を REJECT 終端に誤変更',
    find: '        this.returnRequest(request, actor, lockedTask.taskId);\n',
    replace: '        this.rejectRequest(request, actor, lockedTask.taskId);\n',
    testArgs: ['exec', 'vitest', 'run', 'tests/acceptance/approval-engine.acceptance.test.ts', '-t', 'AW-REQ-RETURN-01']
  },
  {
    id: 'MUT-AW-RESUBMIT-SKIP-RESET',
    description: 'RETURNED 再提出時の task reset 欠落',
    find: '        this.resetTasksForResubmit(request.requestId);\n',
    replace: "        // mutation: skip reset on resubmit\n",
    testArgs: ['exec', 'vitest', 'run', 'tests/acceptance/approval-engine.acceptance.test.ts', '-t', 'AW-REQ-RETURN-01']
  }
];

function tailLines(value, maxLines = 30) {
  if (!value) {
    return '';
  }
  const lines = value.trim().split('\n');
  return lines.slice(Math.max(0, lines.length - maxLines)).join('\n');
}

mkdirSync(outDir, { recursive: true });
const originalSource = readFileSync(enginePath, 'utf-8');

const startedAt = new Date().toISOString();
const results = [];
let killedCount = 0;

try {
  for (const mutant of mutants) {
    const occurrences = originalSource.split(mutant.find).length - 1;
    if (occurrences !== 1) {
      throw new Error(`${mutant.id}: expected unique mutation target but found ${occurrences}`);
    }

    const mutatedSource = originalSource.replace(mutant.find, mutant.replace);
    writeFileSync(enginePath, mutatedSource, 'utf-8');

    const begin = Date.now();
    const run = spawnSync('pnpm', mutant.testArgs, {
      cwd: projectRoot,
      encoding: 'utf-8',
      env: { ...process.env, NO_COLOR: '1' }
    });
    const durationMs = Date.now() - begin;
    const killed = run.status !== 0;

    if (killed) {
      killedCount += 1;
    }

    results.push({
      mutantId: mutant.id,
      description: mutant.description,
      killed,
      exitCode: run.status,
      durationMs,
      command: `pnpm ${mutant.testArgs.join(' ')}`,
      stdoutTail: tailLines(run.stdout),
      stderrTail: tailLines(run.stderr)
    });

    writeFileSync(enginePath, originalSource, 'utf-8');
  }
} finally {
  writeFileSync(enginePath, originalSource, 'utf-8');
}

const total = mutants.length;
const survived = total - killedCount;
const score = total === 0 ? 1 : Number((killedCount / total).toFixed(4));
const passed = survived === 0;

const summary = {
  status: passed ? 'pass' : 'fail',
  startedAt,
  generatedAt: new Date().toISOString(),
  totalMutants: total,
  killedMutants: killedCount,
  survivedMutants: survived,
  mutationScore: score,
  threshold: 1,
  passed,
  mutants: results
};

writeFileSync(summaryPath, JSON.stringify(summary, null, 2), 'utf-8');
console.log(`mutation quick summary generated at ${summaryPath}`);

if (!passed) {
  process.exit(1);
}
