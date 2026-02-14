#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const projectRoot = process.cwd();
const aeFrameworkDir = process.env['AE_FRAMEWORK_DIR'];

if (!aeFrameworkDir) {
  throw new Error('AE_FRAMEWORK_DIR is required');
}

const inputPath = resolve(projectRoot, 'configs/conformance/input.json');
const rulesPath = resolve(projectRoot, 'configs/conformance/rules.json');
const contextPath = resolve(projectRoot, 'configs/conformance/context.json');
const ruleIdsPath = resolve(projectRoot, 'configs/conformance/rule-ids.txt');
const outDir = resolve(projectRoot, 'artifacts/conformance');
const negativeDir = resolve(outDir, 'negative');
const summaryPath = resolve(outDir, 'negative-summary.json');

function loadRuleIds(path) {
  return readFileSync(path, 'utf-8')
    .split('\n')
    .map((line) => line.replace(/#.*/, '').trim())
    .filter(Boolean);
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function tailLines(value, maxLines = 20) {
  if (!value) {
    return '';
  }
  const lines = value.trim().split('\n');
  return lines.slice(Math.max(0, lines.length - maxLines)).join('\n');
}

mkdirSync(negativeDir, { recursive: true });

const baseInput = JSON.parse(readFileSync(inputPath, 'utf-8'));
const ruleIds = loadRuleIds(ruleIdsPath);

const scenarios = [
  {
    scenarioId: 'NEG-CONF-001',
    description: 'request.title missing should fail title rule',
    expectedRuleId: 'f5160a23-41fa-4784-a1ca-3a5f335b7ef2',
    mutate: (input) => {
      input.request.title = ' ';
    }
  },
  {
    scenarioId: 'NEG-CONF-002',
    description: 'request.amount over max should fail range rule',
    expectedRuleId: '8872f2a2-b89f-4d6d-9ed4-c4835a19576c',
    mutate: (input) => {
      input.request.amount = 1000001;
    }
  },
  {
    scenarioId: 'NEG-CONF-003',
    description: 'intruder actor should fail visibility rule',
    expectedRuleId: 'c085fa79-adb6-4392-8ace-3d54ced1ba02',
    mutate: (input) => {
      input.actor.userId = 'intruder-01';
      input.actor.roles = [];
    }
  },
  {
    scenarioId: 'NEG-CONF-004',
    description: 'cross-tenant actor should fail tenant isolation rule',
    expectedRuleId: 'c279426c-fb51-4b41-9b7e-4fbada093eba',
    mutate: (input) => {
      input.actor.tenantId = 'tenant-other';
    }
  }
];

function runCommand(args, cwd) {
  return new Promise((resolveRun) => {
    const child = spawn('pnpm', args, {
      cwd,
      env: { ...process.env, NO_COLOR: '1' }
    });
    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on('data', (chunk) => {
      stderr += String(chunk);
    });

    child.on('close', (code) => {
      resolveRun({ code: code ?? 1, stdout, stderr });
    });
  });
}

async function runScenario(scenario) {
  const scenarioInput = clone(baseInput);
  scenario.mutate(scenarioInput);

  const scenarioInputPath = resolve(negativeDir, `${scenario.scenarioId}.input.json`);
  const scenarioOutputPath = resolve(negativeDir, `${scenario.scenarioId}.result.json`);
  writeFileSync(scenarioInputPath, JSON.stringify(scenarioInput, null, 2), 'utf-8');

  const begin = Date.now();
  const run = await runCommand(
    [
      '--dir',
      aeFrameworkDir,
      'exec',
      'tsx',
      'src/cli/index.ts',
      'conformance',
      'verify',
      '--input',
      scenarioInputPath,
      '--rules',
      rulesPath,
      '--context-file',
      contextPath,
      '--rule-ids',
      ruleIds.join(','),
      '--format',
      'json',
      '--output',
      scenarioOutputPath
    ],
    projectRoot
  );
  const durationMs = Date.now() - begin;

  let resultPayload = null;
  let matchedRule = null;
  let scenarioPassed = false;
  try {
    resultPayload = JSON.parse(readFileSync(scenarioOutputPath, 'utf-8'));
    matchedRule = (resultPayload.results || []).find((item) => item.ruleId === scenario.expectedRuleId) || null;
    scenarioPassed =
      matchedRule?.status === 'fail' &&
      resultPayload.summary?.rulesFailed >= 1 &&
      resultPayload.overall === 'fail';
  } catch {
    scenarioPassed = false;
  }

  return {
    scenarioId: scenario.scenarioId,
    description: scenario.description,
    expectedRuleId: scenario.expectedRuleId,
    passed: scenarioPassed,
    overall: resultPayload?.overall || null,
    expectedRuleStatus: matchedRule?.status || null,
    rulesFailed: resultPayload?.summary?.rulesFailed || 0,
    durationMs,
    command: `pnpm --dir ${aeFrameworkDir} exec tsx src/cli/index.ts conformance verify ...`,
    exitCode: run.code,
    stdoutTail: tailLines(run.stdout),
    stderrTail: tailLines(run.stderr)
  };
}

async function runWithConcurrency(items, concurrency, worker) {
  const results = new Array(items.length);
  let index = 0;

  async function loop() {
    while (true) {
      const current = index;
      index += 1;
      if (current >= items.length) {
        return;
      }
      results[current] = await worker(items[current]);
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, items.length) }, () => loop());
  await Promise.all(workers);
  return results;
}

async function main() {
  const startedAt = new Date().toISOString();
  const concurrencyRaw = Number(process.env['CONF_NEG_CONCURRENCY'] || 2);
  const concurrency =
    Number.isFinite(concurrencyRaw) && concurrencyRaw > 0 ? Math.floor(concurrencyRaw) : 2;

  const results = await runWithConcurrency(scenarios, concurrency, runScenario);
  const passedCount = results.filter((item) => item.passed).length;
  const passed = passedCount === scenarios.length;

  const summary = {
    status: passed ? 'pass' : 'fail',
    startedAt,
    generatedAt: new Date().toISOString(),
    concurrency,
    totalScenarios: scenarios.length,
    passedScenarios: passedCount,
    failedScenarios: scenarios.length - passedCount,
    passed,
    scenarios: results
  };

  writeFileSync(summaryPath, JSON.stringify(summary, null, 2), 'utf-8');
  console.log(`conformance negative summary generated at ${summaryPath}`);

  if (!passed) {
    process.exit(1);
  }
}

await main();
