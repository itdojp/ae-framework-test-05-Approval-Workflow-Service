#!/usr/bin/env node
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const projectRoot = process.cwd();
const configPath = resolve(projectRoot, 'configs/framework-gaps/issues.json');
const outDir = resolve(projectRoot, 'artifacts/framework-gaps');
const outPath = resolve(outDir, 'status.json');

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
    return {
      gapId: item.gapId,
      repo: item.repo,
      issueNumber: item.issueNumber,
      localDoc: item.localDoc || null,
      ok: true,
      issueUrl: body.html_url || url,
      state: body.state || null,
      title: body.title || null,
      updatedAt: body.updated_at || null,
      closedAt: body.closed_at || null,
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

  const summary = {
    generatedAt: new Date().toISOString(),
    startedAt,
    sourceConfig: 'configs/framework-gaps/issues.json',
    totalIssues: results.length,
    okIssues: okCount,
    failedIssues: failedCount,
    status: failedCount === 0 ? 'pass' : 'partial',
    issues: results
  };

  mkdirSync(outDir, { recursive: true });
  writeFileSync(outPath, JSON.stringify(summary, null, 2), 'utf-8');
  console.log(`framework gap status written: ${outPath}`);
}

await main();
