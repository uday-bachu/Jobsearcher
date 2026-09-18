#!/usr/bin/env node

/** Generate fact-checked ATS CV and cover-letter PDFs from one Gemini report. */

import { existsSync, readFileSync, writeFileSync } from 'fs';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';
import { parseArgs } from 'util';
import { spawnSync } from 'child_process';
import { applicationArtifactPaths, ensureApplicationArtifactDirs } from './application-artifacts.mjs';
import { getCareerOpsRoot } from './path-resolver.mjs';
import { generateJson, resolveLlmProvider } from './lib/llm-client.mjs';

const ROOT = dirname(fileURLToPath(import.meta.url));
const DATA_ROOT = getCareerOpsRoot();
const USAGE = 'Usage: node gemini-documents.mjs --report reports/NNN-company-date.md [--provider gemini|openai] [--model MODEL]';

function runNode(script, args) {
  const result = spawnSync(process.execPath, [join(ROOT, script), ...args], { cwd: ROOT, stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${script} exited with status ${result.status}`);
}

function extractReport(reportPath, text) {
  const header = text.match(/^# Evaluation:\s*(.+?)\s+[—-]\s+(.+)$/m);
  const url = text.match(/^\*\*URL:\*\*\s*(https?:\/\/\S+)/m);
  const score = text.match(/^\*\*Score:\*\*\s*([0-5](?:\.\d+)?)\s*(?:\/\s*5)?/mi);
  const reportNum = resolve(reportPath).match(/(?:^|[\\/])(\d+)-/)?.[1];
  if (!header || !url || !score || !reportNum) throw new Error('report must include company, role, URL, score, and a numeric filename prefix');
  return { company: header[1].trim(), role: header[2].trim(), url: url[1], score: Number(score[1]), reportNum };
}

function parseJson(text) {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('Gemini did not return a JSON payload');
  return JSON.parse(text.slice(start, end + 1));
}

async function main() {
  const { values } = parseArgs({ options: { report: { type: 'string' }, provider: { type: 'string' }, model: { type: 'string' }, help: { type: 'boolean', short: 'h' } }, strict: true });
  if (values.help || !values.report) {
    console.log(USAGE);
    return;
  }
  const provider = resolveLlmProvider(values.provider);
  const reportPath = resolve(values.report);
  if (!existsSync(reportPath)) throw new Error(`report not found: ${reportPath}`);
  const reportText = readFileSync(reportPath, 'utf8');
  const report = extractReport(reportPath, reportText);
  if (report.score < 4) throw new Error(`report score ${report.score}/5 is below the 4.0 document threshold`);

  const extracted = spawnSync(process.execPath, [join(ROOT, 'browser-extract.mjs'), report.url, '--mode', 'jd'], { cwd: ROOT, encoding: 'utf8' });
  if (extracted.status !== 0) throw new Error('could not verify the live job description; no documents were generated');
  const jd = JSON.parse(extracted.stdout);
  if (!jd.text || jd.text.length < 200) throw new Error('verified job description was too short; no documents were generated');

  const cvPath = join(DATA_ROOT, 'cv.md');
  const profilePath = join(DATA_ROOT, 'config', 'profile.yml');
  if (!existsSync(cvPath) || !existsSync(profilePath)) throw new Error('cv.md and config/profile.yml are required');
  const prompt = `Create a truthful ATS-safe resume and cover-letter payload for this job. Use ONLY the candidate facts in cv.md and profile.yml. Never invent a skill, metric, employer, degree, job ID, or responsibility. Use JD vocabulary only where it truthfully maps to evidence. Return JSON only with keys cv, cover, changes. cv must satisfy build-cv-html.mjs's documented payload schema. cover must satisfy generate-cover-letter.mjs's payload schema. Include a compact changes string. Use A4 and standard headings; no photos or tables.\n\nREPORT:\n${reportText}\n\nVERIFIED JD:\n${jd.text}\n\nCV:\n${readFileSync(cvPath, 'utf8')}\n\nPROFILE:\n${readFileSync(profilePath, 'utf8')}`;
  const payload = parseJson(await generateJson(prompt, { provider, model: values.model }));
  if (!payload.cv || !payload.cover || typeof payload.changes !== 'string') throw new Error('Gemini response is missing cv, cover, or changes');

  const preparedDate = new Date().toISOString().slice(0, 10);
  const paths = applicationArtifactPaths({ reportNum: report.reportNum, company: report.company, role: report.role, preparedDate });
  ensureApplicationArtifactDirs(paths);
  writeFileSync(paths.jd.current, `Posted: not visible in source\n\n**URL:** ${jd.url || report.url}\n\n${jd.text}\n`);
  const cvPayload = join(paths.cv.tailored.root, 'payload.json');
  const coverPayload = join(paths.root, 'cover-letter-payload.json');
  writeFileSync(cvPayload, `${JSON.stringify(payload.cv, null, 2)}\n`);
  payload.cover.output_path = join(paths.root, 'cover-letter.pdf');
  writeFileSync(coverPayload, `${JSON.stringify(payload.cover, null, 2)}\n`);
  writeFileSync(paths.cv.tailored.changes, `${payload.changes.trim()}\n`);

  runNode('build-cv-html.mjs', [cvPayload, paths.cv.tailored.html]);
  runNode('verify-cv-facts.mjs', [paths.cv.tailored.html]);
  runNode('verify-ats.mjs', [paths.cv.tailored.html]);
  runNode('generate-pdf.mjs', [paths.cv.tailored.html, paths.cv.tailored.pdf, '--format=a4', `--report=${report.reportNum}`]);
  runNode('generate-cover-letter.mjs', ['--payload', coverPayload, '--report', report.reportNum]);
  console.log(JSON.stringify({ company: report.company, role: report.role, score: report.score, jobId: jd.job_id || 'not present', resumePdf: paths.cv.tailored.pdf, coverLetterPdf: join(paths.root, 'cover-letter.pdf'), applyUrl: report.url }, null, 2));
}

main().catch(error => { console.error(`gemini-documents: ${error.message}`); process.exitCode = 1; });