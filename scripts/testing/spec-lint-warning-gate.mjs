#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const projectRoot = process.cwd();

function parseArgs(argv) {
  const args = {
    log: '',
    out: '',
    maxWarnings: 0
  };

  for (let i = 2; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === '--log') {
      args.log = argv[i + 1] || '';
      i += 1;
      continue;
    }
    if (token === '--out') {
      args.out = argv[i + 1] || '';
      i += 1;
      continue;
    }
    if (token === '--max-warnings') {
      const value = Number.parseInt(argv[i + 1] || '', 10);
      args.maxWarnings = Number.isNaN(value) ? 0 : value;
      i += 1;
    }
  }

  return args;
}

function extractWarnings(logText) {
  const matches = [...logText.matchAll(/Warnings:\s*(\d+)/g)];
  if (matches.length === 0) {
    return null;
  }
  const last = matches[matches.length - 1];
  return Number.parseInt(last[1], 10);
}

function main() {
  const args = parseArgs(process.argv);
  if (!args.log) {
    console.error('Usage: node spec-lint-warning-gate.mjs --log <path> [--max-warnings <n>] [--out <path>]');
    process.exit(2);
  }

  const logPath = resolve(projectRoot, args.log);
  const logText = readFileSync(logPath, 'utf-8');
  const warnings = extractWarnings(logText);
  if (warnings === null || Number.isNaN(warnings)) {
    console.error(`Unable to parse warnings count from log: ${logPath}`);
    process.exit(2);
  }

  const passed = warnings <= args.maxWarnings;
  const report = {
    generatedAt: new Date().toISOString(),
    logFile: args.log,
    warnings,
    maxWarnings: args.maxWarnings,
    passed
  };

  if (args.out) {
    const outPath = resolve(projectRoot, args.out);
    writeFileSync(outPath, JSON.stringify(report, null, 2), 'utf-8');
    console.log(`spec lint gate report written: ${outPath}`);
  }

  console.log(`spec lint warnings=${warnings}, max=${args.maxWarnings}, passed=${passed}`);
  if (!passed) {
    process.exit(1);
  }
}

main();
