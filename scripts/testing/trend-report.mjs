#!/usr/bin/env node
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const projectRoot = process.cwd();
const runsRoot = resolve(projectRoot, 'artifacts/runs');
const outDir = resolve(projectRoot, 'artifacts/trends');
const outPath = resolve(outDir, 'summary.json');

function toInt(value, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return Math.floor(parsed);
}

function normalizeTimestamp(value) {
  if (typeof value !== 'string' || value.trim() === '') {
    return null;
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }
  return parsed.toISOString();
}

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

function listDirectories(path) {
  if (!existsSync(path)) {
    return [];
  }
  return readdirSync(path, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);
}

function getSnapshotRoot(runDir, manifest) {
  if (typeof manifest?.snapshotDir === 'string' && manifest.snapshotDir.trim() !== '') {
    return resolve(projectRoot, manifest.snapshotDir);
  }
  return resolve(runDir, 'snapshots');
}

function getFormalSummary(snapshotRoot, suffix) {
  const formalDir = resolve(snapshotRoot, 'formal');
  if (existsSync(formalDir)) {
    const target = readdirSync(formalDir)
      .filter((name) => name.endsWith(`${suffix}-summary.json`))
      .map((name) => {
        const path = resolve(formalDir, name);
        return { path, mtime: statSync(path).mtimeMs };
      })
      .sort((a, b) => b.mtime - a.mtime)[0];
    if (target) {
      return readJsonSafe(target.path);
    }
  }
  return readJsonSafe(resolve(snapshotRoot, `hermetic-reports/formal/${suffix}-summary.json`));
}

function collectChecks(metrics) {
  const checks = [];
  if (metrics.verifyLite.available) {
    checks.push({ name: 'verify-lite', passed: metrics.verifyLite.passed === true });
  }
  if (metrics.conformance.available) {
    checks.push({ name: 'conformance', passed: metrics.conformance.overall === 'pass' });
  }
  if (metrics.conformanceNegative.available) {
    checks.push({ name: 'conformance-negative', passed: metrics.conformanceNegative.passed === true });
  }
  if (metrics.mbt.available) {
    checks.push({ name: 'mbt', passed: metrics.mbt.passed === true });
  }
  if (metrics.property.available) {
    checks.push({ name: 'property', passed: metrics.property.passed === true });
  }
  if (metrics.mutation.available) {
    checks.push({ name: 'mutation', passed: metrics.mutation.passed === true });
  }
  return checks;
}

function compactRunEntry(entry) {
  return {
    runId: entry.runId,
    profile: entry.profile,
    createdAt: entry.createdAt,
    hasSnapshots: entry.hasSnapshots,
    runPassed: entry.runPassed,
    checks: entry.checks,
    highlights: {
      mutationScore: entry.metrics.mutation.mutationScore,
      verifyLiteDurationMs: entry.metrics.verifyLite.durationMs,
      conformanceOverall: entry.metrics.conformance.overall,
      conformanceNegativePassed: entry.metrics.conformanceNegative.passed,
      formal: {
        tlaStatus: entry.metrics.formal.tla.status,
        cspStatus: entry.metrics.formal.csp.status
      }
    }
  };
}

function summarizeProfile(entries, profile) {
  const profileRuns = entries.filter((entry) => entry.profile === profile);
  const latest = profileRuns[0] || null;
  const evaluated = profileRuns.filter((entry) => entry.runPassed !== null);
  const passed = evaluated.filter((entry) => entry.runPassed === true).length;

  const mutationTrend = profileRuns
    .filter((entry) => typeof entry.metrics.mutation.mutationScore === 'number')
    .slice(0, 20)
    .map((entry) => ({
      runId: entry.runId,
      createdAt: entry.createdAt,
      mutationScore: entry.metrics.mutation.mutationScore
    }));

  const verifyLiteDurationTrend = profileRuns
    .filter((entry) => typeof entry.metrics.verifyLite.durationMs === 'number')
    .slice(0, 20)
    .map((entry) => ({
      runId: entry.runId,
      createdAt: entry.createdAt,
      durationMs: entry.metrics.verifyLite.durationMs
    }));

  return {
    totalRuns: profileRuns.length,
    runsWithSnapshots: profileRuns.filter((entry) => entry.hasSnapshots).length,
    evaluatedRuns: evaluated.length,
    passedRuns: passed,
    passRate: evaluated.length === 0 ? null : Number((passed / evaluated.length).toFixed(4)),
    latestRun: latest ? compactRunEntry(latest) : null,
    trends: {
      mutationScore: mutationTrend,
      verifyLiteDurationMs: verifyLiteDurationTrend
    }
  };
}

function collectRunEntry(runId) {
  const runDir = resolve(runsRoot, runId);
  const manifestPath = resolve(runDir, 'manifest.json');
  const manifest = readJsonSafe(manifestPath);
  if (!manifest) {
    return null;
  }

  const profile = typeof manifest.profile === 'string' ? manifest.profile.trim() : '';
  if (profile === '') {
    return null;
  }

  const createdAt = normalizeTimestamp(manifest.createdAt);
  if (!createdAt) {
    return null;
  }

  const snapshotRoot = getSnapshotRoot(runDir, manifest);
  const hasSnapshots = existsSync(snapshotRoot);

  const verifyLite = readJsonSafe(resolve(snapshotRoot, 'verify-lite/summary.json'));
  const conformance = readJsonSafe(resolve(snapshotRoot, 'conformance/result.json'));
  const conformanceNegative = readJsonSafe(resolve(snapshotRoot, 'conformance/negative-summary.json'));
  const mbt = readJsonSafe(resolve(snapshotRoot, 'mbt/summary.json'));
  const property = readJsonSafe(resolve(snapshotRoot, 'properties/summary.json'));
  const mutation = readJsonSafe(resolve(snapshotRoot, 'mutation/summary.json'));
  const tlaSummary = getFormalSummary(snapshotRoot, 'tla');
  const cspSummary = getFormalSummary(snapshotRoot, 'csp');

  const metrics = {
    verifyLite: {
      available: Boolean(verifyLite),
      passed: verifyLite?.passed ?? null,
      durationMs: verifyLite?.durationMs ?? null
    },
    conformance: {
      available: Boolean(conformance),
      overall: conformance?.overall ?? null,
      rulesFailed: conformance?.summary?.rulesFailed ?? null
    },
    conformanceNegative: {
      available: Boolean(conformanceNegative),
      passed: conformanceNegative?.passed ?? null,
      totalScenarios: conformanceNegative?.totalScenarios ?? null,
      failedScenarios: conformanceNegative?.failedScenarios ?? null
    },
    mbt: {
      available: Boolean(mbt),
      passed: mbt?.passed ?? null
    },
    property: {
      available: Boolean(property),
      passed: property?.passed ?? null,
      runs: property?.runs ?? null
    },
    mutation: {
      available: Boolean(mutation),
      passed: mutation?.passed ?? null,
      mutationScore: mutation?.mutationScore ?? null,
      totalMutants: mutation?.totalMutants ?? null,
      survivedMutants: mutation?.survivedMutants ?? null
    },
    formal: {
      tla: {
        available: Boolean(tlaSummary),
        status: tlaSummary?.status ?? null,
        ran: tlaSummary?.ran ?? null,
        ok: tlaSummary?.ok ?? null
      },
      csp: {
        available: Boolean(cspSummary),
        status: cspSummary?.status ?? null,
        ran: cspSummary?.ran ?? null,
        ok: cspSummary?.ok ?? null
      }
    }
  };

  const checks = collectChecks(metrics);
  const runPassed = checks.length > 0 ? checks.every((check) => check.passed) : null;

  return {
    runId,
    profile,
    createdAt,
    hasSnapshots,
    runPassed,
    checks,
    metrics
  };
}

function main() {
  const maxRuns = toInt(process.env['TREND_MAX_RUNS'], 200);
  const runIds = listDirectories(runsRoot);
  const entries = runIds
    .map(collectRunEntry)
    .filter((entry) => entry !== null)
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, maxRuns);

  const profiles = [...new Set(entries.map((entry) => entry.profile))];
  const profileSummary = Object.fromEntries(
    profiles.map((profile) => [profile, summarizeProfile(entries, profile)])
  );

  const summary = {
    generatedAt: new Date().toISOString(),
    sourceDir: 'artifacts/runs',
    maxRuns,
    totalRunsScanned: entries.length,
    profiles: profileSummary,
    latestRuns: entries.slice(0, 30).map(compactRunEntry)
  };

  mkdirSync(outDir, { recursive: true });
  writeFileSync(outPath, JSON.stringify(summary, null, 2), 'utf-8');
  console.log(`trend summary generated at ${outPath}`);
}

main();
