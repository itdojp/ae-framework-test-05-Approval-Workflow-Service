#!/usr/bin/env node
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const projectRoot = process.cwd();
const runsRoot = resolve(projectRoot, 'artifacts/runs');
const outJsonPath = resolve(runsRoot, 'index.json');
const outMdPath = resolve(runsRoot, 'index.md');

function readJsonSafe(path) {
  if (!existsSync(path)) {
    return null;
  }
  try {
    return JSON.parse(readFileSync(path, 'utf-8'));
  } catch {
    return null;
  }
}

function normalizeTimestamp(value) {
  if (typeof value !== 'string' || value.trim() === '') {
    return null;
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  return date.toISOString();
}

function countFilesRecursively(path) {
  if (!existsSync(path)) {
    return 0;
  }
  let count = 0;
  const stack = [path];
  while (stack.length > 0) {
    const current = stack.pop();
    const entries = readdirSync(current, { withFileTypes: true });
    for (const entry of entries) {
      const full = resolve(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(full);
      } else if (entry.isFile()) {
        count += 1;
      }
    }
  }
  return count;
}

function sumFileBytesRecursively(path) {
  if (!existsSync(path)) {
    return 0;
  }
  let total = 0;
  const stack = [path];
  while (stack.length > 0) {
    const current = stack.pop();
    const entries = readdirSync(current, { withFileTypes: true });
    for (const entry of entries) {
      const full = resolve(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(full);
      } else if (entry.isFile()) {
        total += statSync(full).size;
      }
    }
  }
  return total;
}

function collectRun(runDirName) {
  const runDir = resolve(runsRoot, runDirName);
  const manifestPath = resolve(runDir, 'manifest.json');
  const manifest = readJsonSafe(manifestPath);
  if (!manifest) {
    return null;
  }

  const profile = typeof manifest.profile === 'string' ? manifest.profile : null;
  const createdAt = normalizeTimestamp(manifest.createdAt);
  const logsDir = resolve(runDir, 'logs');
  const snapshotDir =
    typeof manifest.snapshotDir === 'string' && manifest.snapshotDir.trim() !== ''
      ? resolve(projectRoot, manifest.snapshotDir)
      : resolve(runDir, 'snapshots');

  const audit = readJsonSafe(resolve(runDir, 'audit.json'));
  const logFileCount = countFilesRecursively(logsDir);
  const snapshotFileCount = countFilesRecursively(snapshotDir);
  const runSizeBytes = sumFileBytesRecursively(runDir);

  let frameworkGapState = null;
  const gapSnapshot = readJsonSafe(resolve(snapshotDir, 'framework-gaps/status.json'));
  if (gapSnapshot?.issues?.[0]?.state) {
    frameworkGapState = String(gapSnapshot.issues[0].state);
  }

  return {
    runId: runDirName,
    profile,
    createdAt,
    hasAudit: Boolean(audit),
    auditPassed: audit?.passed ?? null,
    auditMissingCount: audit?.missingCount ?? null,
    logFileCount,
    snapshotFileCount,
    runSizeBytes,
    frameworkGapState
  };
}

function summarizeByProfile(runs) {
  const map = {};
  for (const run of runs) {
    const key = run.profile || 'unknown';
    if (!map[key]) {
      map[key] = {
        totalRuns: 0,
        auditedRuns: 0,
        auditPassedRuns: 0,
        auditFailedRuns: 0,
        latestRunId: null,
        latestCreatedAt: null
      };
    }
    const item = map[key];
    item.totalRuns += 1;
    if (run.hasAudit) {
      item.auditedRuns += 1;
      if (run.auditPassed === true) {
        item.auditPassedRuns += 1;
      } else if (run.auditPassed === false) {
        item.auditFailedRuns += 1;
      }
    }
    if (!item.latestCreatedAt || (run.createdAt && run.createdAt > item.latestCreatedAt)) {
      item.latestCreatedAt = run.createdAt;
      item.latestRunId = run.runId;
    }
  }
  return map;
}

function buildMarkdown(summary) {
  const lines = [];
  lines.push('# Run Index');
  lines.push('');
  lines.push(`GeneratedAt: ${summary.generatedAt}`);
  lines.push('');
  lines.push('## Overview');
  lines.push('');
  lines.push(`- totalRuns: ${summary.totalRuns}`);
  lines.push(`- auditedRuns: ${summary.auditedRuns}`);
  lines.push(`- auditPassedRuns: ${summary.auditPassedRuns}`);
  lines.push(`- auditFailedRuns: ${summary.auditFailedRuns}`);
  lines.push('');
  lines.push('## Profile Summary');
  lines.push('');
  lines.push('| Profile | totalRuns | auditedRuns | auditPassedRuns | auditFailedRuns | latestRunId | latestCreatedAt |');
  lines.push('| --- | ---: | ---: | ---: | ---: | --- | --- |');
  for (const [profile, item] of Object.entries(summary.profileSummary)) {
    lines.push(
      `| ${profile} | ${item.totalRuns} | ${item.auditedRuns} | ${item.auditPassedRuns} | ${item.auditFailedRuns} | ${item.latestRunId || ''} | ${item.latestCreatedAt || ''} |`
    );
  }
  lines.push('');
  lines.push('## Latest Runs');
  lines.push('');
  lines.push('| runId | profile | createdAt | auditPassed | auditMissingCount | snapshotFileCount | frameworkGapState |');
  lines.push('| --- | --- | --- | --- | ---: | ---: | --- |');
  for (const run of summary.latestRuns) {
    lines.push(
      `| ${run.runId} | ${run.profile || ''} | ${run.createdAt || ''} | ${run.auditPassed === null ? '' : run.auditPassed} | ${run.auditMissingCount ?? ''} | ${run.snapshotFileCount} | ${run.frameworkGapState || ''} |`
    );
  }
  lines.push('');
  return lines.join('\n');
}

function main() {
  if (!existsSync(runsRoot)) {
    throw new Error('artifacts/runs directory not found');
  }

  const runDirs = readdirSync(runsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);

  const runs = runDirs
    .map((name) => collectRun(name))
    .filter((item) => item !== null)
    .sort((a, b) => {
      const aTime = a.createdAt || '';
      const bTime = b.createdAt || '';
      if (aTime === bTime) {
        return b.runId.localeCompare(a.runId);
      }
      return bTime.localeCompare(aTime);
    });

  const auditedRuns = runs.filter((run) => run.hasAudit).length;
  const auditPassedRuns = runs.filter((run) => run.auditPassed === true).length;
  const auditFailedRuns = runs.filter((run) => run.auditPassed === false).length;

  const summary = {
    generatedAt: new Date().toISOString(),
    sourceDir: 'artifacts/runs',
    totalRuns: runs.length,
    auditedRuns,
    auditPassedRuns,
    auditFailedRuns,
    profileSummary: summarizeByProfile(runs),
    latestRuns: runs.slice(0, 50)
  };

  mkdirSync(runsRoot, { recursive: true });
  writeFileSync(outJsonPath, JSON.stringify(summary, null, 2), 'utf-8');
  writeFileSync(outMdPath, `${buildMarkdown(summary)}\n`, 'utf-8');
  console.log(`run index written: ${outJsonPath}`);
  console.log(`run index written: ${outMdPath}`);
}

main();
