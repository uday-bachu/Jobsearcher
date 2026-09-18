#!/usr/bin/env node

/**
 * Render one approved, job-specific CV payload into an application bundle.
 * The payload must be authored from cv.md and the archived JD before this
 * command runs; this script enforces the approval and validation gates.
 */

import { copyFileSync, existsSync } from 'fs';
import { mkdirSync } from 'fs';
import { resolve } from 'path';
import { parseArgs } from 'util';
import { spawnSync } from 'child_process';
import { validateFlags } from './lib/cli-flags.mjs';
import { applicationArtifactPaths, ensureApplicationArtifactDirs } from './application-artifacts.mjs';

const KNOWN_FLAGS = [
  '--report', '--company', '--role', '--score', '--selected', '--jd', '--payload',
  '--prepared-date', '--version', '--root', '--template', '--max-pages', '--help', '-h',
];
const VALUE_FLAGS = KNOWN_FLAGS.filter(flag => !['--selected', '--help', '-h'].includes(flag));
const USAGE = `Usage:
  node prepare-tailored-cv.mjs --report N --company NAME --role ROLE --score N --selected --jd JD.md --payload tailored-cv.json [options]

Creates an application-scoped ATS-safe CV HTML and PDF after a selected role
has a verified job description and an evaluation score of 4.0 or higher.

  --report N              report number (required)
  --company NAME          employer name (required)
  --role ROLE             role title (required)
  --score N               evaluation score, minimum 4.0 (required)
  --selected              confirms the candidate selected this role (required)
  --jd JD.md              verified JD archive source (required)
  --payload CV.json       tailored structured CV payload, grounded in cv.md (required)
  --prepared-date DATE    bundle date in YYYY-MM-DD (defaults to today)
  --version N             tailored CV version (default: 1)
  --root DIR              artifact root (default: output)
  --template FILE         resolved CV template path (optional)
  --max-pages N           preferred PDF page count (default: 2)
  --help, -h              show this message`;

function localToday() {
  const date = new Date();
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 10);
}

function runNode(script, args) {
  const result = spawnSync(process.execPath, [resolve(script), ...args], { stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${script} exited with status ${result.status}`);
}

async function main() {
  validateFlags(process.argv.slice(2), KNOWN_FLAGS, USAGE, { valueFlags: VALUE_FLAGS, requireOperand: true });
  const { values } = parseArgs({
    options: {
      report: { type: 'string' }, company: { type: 'string' }, role: { type: 'string' },
      score: { type: 'string' }, selected: { type: 'boolean' }, jd: { type: 'string' },
      payload: { type: 'string' }, 'prepared-date': { type: 'string' }, version: { type: 'string', default: '1' },
      root: { type: 'string' }, template: { type: 'string' }, 'max-pages': { type: 'string', default: '2' },
    },
    strict: true,
  });
  if (!values.report || !values.company || !values.role || !values.score || !values.jd || !values.payload || !values.selected) {
    throw new Error(`missing required input\n\n${USAGE}`);
  }
  const score = Number(values.score);
  if (!Number.isFinite(score) || score < 4) throw new Error('--score must be a number of at least 4.0');
  const maxPages = Number(values['max-pages']);
  if (!Number.isInteger(maxPages) || maxPages < 1) throw new Error('--max-pages must be a positive integer');

  const jdPath = resolve(values.jd);
  const payloadPath = resolve(values.payload);
  if (!existsSync(jdPath)) throw new Error(`JD file not found: ${jdPath}`);
  if (!existsSync(payloadPath)) throw new Error(`CV payload file not found: ${payloadPath}`);

  const paths = applicationArtifactPaths({
    reportNum: values.report,
    company: values.company,
    role: values.role,
    version: values.version,
    root: values.root,
    preparedDate: values['prepared-date'] || localToday(),
  });
  ensureApplicationArtifactDirs(paths);
  copyFileSync(jdPath, paths.jd.current);
  copyFileSync(payloadPath, resolve(paths.cv.tailored.root, 'payload.json'));

  const builderArgs = [resolve('build-cv-html.mjs'), payloadPath, paths.cv.tailored.html];
  if (values.template) builderArgs.push(resolve(values.template));
  runNode(builderArgs.shift(), builderArgs);
  runNode('verify-cv-facts.mjs', [paths.cv.tailored.html]);
  runNode('verify-ats.mjs', [paths.cv.tailored.html]);
  runNode('generate-pdf.mjs', [
    paths.cv.tailored.html,
    paths.cv.tailored.pdf,
    '--format=a4',
    `--report=${values.report}`,
    `--max-pages=${maxPages}`,
  ]);

  console.log(`\nTailored PDF ready: ${paths.cv.tailored.pdf}`);
  console.log(`Application bundle: ${paths.root}`);
}

main().catch((error) => {
  console.error(`prepare-tailored-cv: ${error.message}`);
  process.exitCode = 1;
});