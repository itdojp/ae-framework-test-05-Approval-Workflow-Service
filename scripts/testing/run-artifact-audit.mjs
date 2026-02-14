#!/usr/bin/env node
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const projectRoot = process.cwd();

function parseArgs(argv) {
  const args = { runId: '', profile: '' };
  for (let i = 2; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === '--run-id') {
      args.runId = argv[i + 1] || '';
      i += 1;
      continue;
    }
    if (token === '--profile') {
      args.profile = argv[i + 1] || '';
      i += 1;
    }
  }
  return args;
}

function requiredSnapshotPaths(profile, runId) {
  const commonSpec = [
    'snapshots/.ae/ae-ir.json',
    'snapshots/contracts/contracts-summary.json',
    'snapshots/domain/replay-fixtures.sample.json',
    'snapshots/simulation/deterministic-summary.json'
  ];

  const verifyLite = ['snapshots/verify-lite/summary.json'];
  const prGateExtras = [
    'snapshots/conformance/result.json',
    'snapshots/conformance/negative-summary.json',
    'snapshots/conformance/negative/NEG-CONF-001.result.json',
    'snapshots/conformance/negative/NEG-CONF-002.result.json',
    'snapshots/conformance/negative/NEG-CONF-003.result.json',
    'snapshots/conformance/negative/NEG-CONF-004.result.json',
    'snapshots/mbt/summary.json',
    'snapshots/properties/summary.json'
  ];
  const nightlyExtras = [
    `snapshots/formal/${runId}-tla-summary.json`,
    `snapshots/formal/${runId}-csp-summary.json`,
    'snapshots/hermetic-reports/formal/tla-summary.json',
    'snapshots/hermetic-reports/formal/csp-summary.json',
    'snapshots/mutation/summary.json',
    'snapshots/trends/summary.json',
    'snapshots/framework-gaps/status.json'
  ];

  switch (profile) {
    case 'dev-fast':
      return [...commonSpec, ...verifyLite];
    case 'pr-gate':
      return [...commonSpec, ...verifyLite, ...prGateExtras];
    case 'nightly-deep':
      return [...nightlyExtras];
    case 'full':
      return [...commonSpec, ...verifyLite, ...prGateExtras, ...nightlyExtras];
    default:
      return [];
  }
}

function main() {
  const { runId, profile } = parseArgs(process.argv);
  if (!runId || !profile) {
    console.error('Usage: node run-artifact-audit.mjs --run-id <run-id> --profile <profile>');
    process.exit(2);
  }

  const runDir = resolve(projectRoot, 'artifacts/runs', runId);
  const logDir = resolve(runDir, 'logs');
  const manifestPath = resolve(runDir, 'manifest.json');
  const auditPath = resolve(runDir, 'audit.json');
  const requiredFiles = requiredSnapshotPaths(profile, runId).map((relativePath) =>
    resolve(runDir, relativePath)
  );

  const missing = [];
  if (!existsSync(manifestPath)) {
    missing.push('manifest.json');
  }
  if (!existsSync(logDir)) {
    missing.push('logs/');
  }

  for (const absolutePath of requiredFiles) {
    if (!existsSync(absolutePath)) {
      missing.push(absolutePath.replace(`${runDir}/`, ''));
    }
  }

  const logFiles =
    existsSync(logDir) && readdirSync(logDir, { withFileTypes: true }).some((entry) => entry.isFile());
  if (!logFiles) {
    missing.push('logs/* (no log files)');
  }

  const passed = missing.length === 0;
  const report = {
    runId,
    profile,
    generatedAt: new Date().toISOString(),
    runDir: `artifacts/runs/${runId}`,
    requiredCount: requiredFiles.length + 2,
    missingCount: missing.length,
    passed,
    missing
  };

  mkdirSync(runDir, { recursive: true });
  writeFileSync(auditPath, JSON.stringify(report, null, 2), 'utf-8');
  console.log(`artifact audit written: ${auditPath}`);

  if (!passed) {
    console.error(`artifact audit failed: ${missing.length} missing entries`);
    process.exit(1);
  }
}

main();
