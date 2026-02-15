#!/usr/bin/env node
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const projectRoot = process.cwd();
const configPath = resolve(projectRoot, 'configs/framework-gaps/issues.json');
const outDir = resolve(projectRoot, 'artifacts/framework-gaps');
const outPath = resolve(outDir, 'status.json');

function toIsoOrNull(value) {
  if (typeof value !== 'string' || value.trim() === '') {
    return null;
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  return date.toISOString();
}

function ageDaysFrom(isoString) {
  if (!isoString) {
    return null;
  }
  const now = Date.now();
  const target = new Date(isoString).getTime();
  if (Number.isNaN(target)) {
    return null;
  }
  return Math.floor((now - target) / (24 * 60 * 60 * 1000));
}

function loadConfig(path) {
  const payload = JSON.parse(readFileSync(path, 'utf-8'));
  if (!Array.isArray(payload)) {
    throw new Error('configs/framework-gaps/issues.json must be an array');
  }
  return payload;
}

function tokenFromEnv() {
  return process.env['GITHUB_TOKEN'] || process.env['GH_TOKEN'] || '';
}

function normalizeTrackingMode(value) {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : 'default';
}

async function fetchIssue(item) {
  const url = `https://api.github.com/repos/${item.repo}/issues/${item.issueNumber}`;
  const headers = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'approval-workflow-service-gap-monitor'
  };
  const token = tokenFromEnv();
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  try {
    const response = await fetch(url, { headers });
    if (!response.ok) {
      return {
        gapId: item.gapId,
        repo: item.repo,
        issueNumber: item.issueNumber,
        localDoc: item.localDoc || null,
        ok: false,
        statusCode: response.status,
        error: `HTTP ${response.status}`
      };
    }

    const body = await response.json();
    const state = body.state || null;
    const updatedAt = toIsoOrNull(body.updated_at || null);
    const closedAt = toIsoOrNull(body.closed_at || null);
    const trackingMode = normalizeTrackingMode(item.trackingMode);
    const frameworkRef =
      typeof item.frameworkRef === 'string' && item.frameworkRef.trim() !== ''
        ? item.frameworkRef
        : null;
    const expectedSpecLintWarnings =
      Number.isInteger(item.expectedSpecLintWarnings) && item.expectedSpecLintWarnings >= 0
        ? item.expectedSpecLintWarnings
        : null;

    const revalidatedAtRunId =
      typeof item.revalidatedAtRunId === 'string' && item.revalidatedAtRunId.trim() !== ''
        ? item.revalidatedAtRunId
        : null;
    const revalidatedAt = toIsoOrNull(item.revalidatedAt || null);

    const revalidationRequired =
      trackingMode === 'fixed_ref'
        ? false
        : state === 'closed' && !revalidatedAtRunId;

    const recommendedAction =
      trackingMode === 'fixed_ref'
        ? 'hold_fixed_ref'
        : revalidationRequired
          ? 'revalidate'
          : state === 'closed'
            ? 'archive'
            : 'track';

    return {
      gapId: item.gapId,
      repo: item.repo,
      issueNumber: item.issueNumber,
      localDoc: item.localDoc || null,
      trackingMode,
      frameworkRef,
      expectedSpecLintWarnings,
      revalidatedAtRunId,
      revalidatedAt,
      resolutionNote: typeof item.resolutionNote === 'string' ? item.resolutionNote : null,
      ok: true,
      issueUrl: body.html_url || url,
      state,
      title: body.title || null,
      updatedAt,
      closedAt,
      ageDaysSinceUpdated: ageDaysFrom(updatedAt),
      ageDaysSinceClosed: ageDaysFrom(closedAt),
      revalidationRequired,
      recommendedAction,
      labels: Array.isArray(body.labels) ? body.labels.map((label) => label.name).filter(Boolean) : []
    };
  } catch (error) {
    return {
      gapId: item.gapId,
      repo: item.repo,
      issueNumber: item.issueNumber,
      localDoc: item.localDoc || null,
      ok: false,
      statusCode: null,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

async function main() {
  const startedAt = new Date().toISOString();
  const config = loadConfig(configPath);
  const results = await Promise.all(config.map((item) => fetchIssue(item)));
  const okCount = results.filter((item) => item.ok).length;
  const failedCount = results.length - okCount;
  const closedCount = results.filter((item) => item.ok && item.state === 'closed').length;
  const revalidationRequiredCount = results.filter(
    (item) => item.ok && item.revalidationRequired === true
  ).length;

  const summary = {
    generatedAt: new Date().toISOString(),
    startedAt,
    sourceConfig: 'configs/framework-gaps/issues.json',
    totalIssues: results.length,
    okIssues: okCount,
    failedIssues: failedCount,
    closedIssues: closedCount,
    revalidationRequiredIssues: revalidationRequiredCount,
    status:
      failedCount > 0 ? 'partial' : revalidationRequiredCount > 0 ? 'action_required' : 'pass',
    issues: results
  };

  mkdirSync(outDir, { recursive: true });
  writeFileSync(outPath, JSON.stringify(summary, null, 2), 'utf-8');
  console.log(`framework gap status written: ${outPath}`);
}

await main();
