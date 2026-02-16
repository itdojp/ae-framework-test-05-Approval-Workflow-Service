#!/usr/bin/env node
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';

const projectRoot = process.cwd();

function parseArgs(argv) {
  const args = {
    expectedRefFile: '',
    actualDir: '',
    out: ''
  };

  for (let i = 2; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === '--expected-ref-file') {
      args.expectedRefFile = argv[i + 1] || '';
      i += 1;
      continue;
    }
    if (token === '--actual-dir') {
      args.actualDir = argv[i + 1] || '';
      i += 1;
      continue;
    }
    if (token === '--out') {
      args.out = argv[i + 1] || '';
      i += 1;
    }
  }

  return args;
}

function loadExpectedRef(filePath) {
  if (!existsSync(filePath)) {
    throw new Error(`expected ref file not found: ${filePath}`);
  }
  const value = readFileSync(filePath, 'utf-8').trim();
  if (!/^[0-9a-f]{40}$/i.test(value)) {
    throw new Error(`invalid expected ref format in ${filePath}`);
  }
  return value.toLowerCase();
}

function readActualRef(repoDir) {
  try {
    return execFileSync('git', ['-C', repoDir, 'rev-parse', 'HEAD'], {
      encoding: 'utf-8'
    }).trim().toLowerCase();
  } catch (error) {
    throw new Error(
      `failed to resolve actual ref from ${repoDir}: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

function main() {
  const args = parseArgs(process.argv);
  if (!args.expectedRefFile || !args.actualDir) {
    console.error(
      'Usage: node ae-framework-ref-guard.mjs --expected-ref-file <path> --actual-dir <path> [--out <path>]'
    );
    process.exit(2);
  }

  const expectedRefPath = resolve(projectRoot, args.expectedRefFile);
  const actualDirPath = resolve(projectRoot, args.actualDir);
  const expectedRef = loadExpectedRef(expectedRefPath);
  const actualRef = readActualRef(actualDirPath);
  const passed = expectedRef === actualRef;

  const report = {
    generatedAt: new Date().toISOString(),
    expectedRefFile: args.expectedRefFile,
    expectedRef,
    actualDir: args.actualDir,
    actualRef,
    passed
  };

  if (args.out) {
    const outPath = resolve(projectRoot, args.out);
    writeFileSync(outPath, JSON.stringify(report, null, 2), 'utf-8');
    console.log(`ae-framework ref guard report written: ${outPath}`);
  }

  console.log(`ae-framework ref guard expected=${expectedRef} actual=${actualRef} passed=${passed}`);
  if (!passed) {
    process.exit(1);
  }
}

main();
