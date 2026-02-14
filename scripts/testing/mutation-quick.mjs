#!/usr/bin/env node
import { mkdirSync, writeFileSync } from 'node:fs';

const outDir = 'artifacts/mutation';
mkdirSync(outDir, { recursive: true });

const summary = {
  status: 'report-only',
  score: null,
  note: 'Mutation testing harness is not yet integrated in this repository.',
  generatedAt: new Date().toISOString()
};

writeFileSync(`${outDir}/summary.json`, JSON.stringify(summary, null, 2), 'utf-8');
console.log('mutation quick summary generated at artifacts/mutation/summary.json');

