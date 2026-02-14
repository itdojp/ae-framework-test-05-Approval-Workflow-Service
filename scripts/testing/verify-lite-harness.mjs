#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const projectRoot = process.cwd();
const outDir = resolve(projectRoot, 'artifacts/verify-lite');
const summaryPath = resolve(outDir, 'summary.json');

function tailLines(value, maxLines = 30) {
  if (!value) {
    return '';
  }
  const lines = value.trim().split('\n');
  return lines.slice(Math.max(0, lines.length - maxLines)).join('\n');
}

mkdirSync(outDir, { recursive: true });

const startedAt = new Date().toISOString();
const begin = Date.now();
const run = spawnSync('pnpm', ['run', 'verify:lite'], {
  cwd: projectRoot,
  encoding: 'utf-8',
  env: { ...process.env, NO_COLOR: '1' }
});
const durationMs = Date.now() - begin;

const passed = run.status === 0;
const summary = {
  status: passed ? 'pass' : 'fail',
  startedAt,
  generatedAt: new Date().toISOString(),
  durationMs,
  command: 'pnpm run verify:lite',
  exitCode: run.status,
  passed,
  stdoutTail: tailLines(run.stdout),
  stderrTail: tailLines(run.stderr)
};

writeFileSync(summaryPath, JSON.stringify(summary, null, 2), 'utf-8');
console.log(`verify-lite summary generated at ${summaryPath}`);

if (!passed) {
  process.exit(1);
}
