#!/usr/bin/env node

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { spawnSync } from 'child_process';
import { parseArgs } from 'util';
import { getCareerOpsRoot } from './path-resolver.mjs';

const ROOT = dirname(fileURLToPath(import.meta.url));
const DATA_ROOT = getCareerOpsRoot();
const pipelinePath = join(DATA_ROOT, 'data', 'pipeline.md');

function run(script, args, capture = false) {
  return spawnSync(process.execPath, [join(ROOT, script), ...args], { cwd: ROOT, encoding: capture ? 'utf8' : undefined, stdio: capture ? undefined : 'inherit' });
}

function main() {
  const { values } = parseArgs({ options: { limit: { type: 'string', default: '3' }, model: { type: 'string' }, help: { type: 'boolean', short: 'h' } }, strict: true });
  if (values.help) { console.log('Usage: node batch-evaluate-openai.mjs [--limit N] [--model MODEL]'); return; }
  const limit = Number(values.limit);
  if (!Number.isInteger(limit) || limit < 1 || limit > 10) throw new Error('--limit must be an integer from 1 to 10');
  if (!existsSync(pipelinePath)) throw new Error(`pipeline not found: ${pipelinePath}`);
  const lines = readFileSync(pipelinePath, 'utf8').split('\n');
  const pending = lines.map((line, index) => ({ line, index })).filter(item => item.line.startsWith('- [ ] ')).slice(0, limit);
  const jdsPath = join(DATA_ROOT, 'jds');
  mkdirSync(jdsPath, { recursive: true });
  for (const item of pending) {
    const url = item.line.slice(6).split('|')[0].trim();
    const extracted = run('browser-extract.mjs', [url, '--mode', 'jd'], true);
    if (extracted.status !== 0) { console.error(`Could not extract JD: ${url}`); continue; }
    const jd = JSON.parse(extracted.stdout);
    if (!jd.text || jd.text.length < 200) { console.error(`JD was too short: ${url}`); continue; }
    const jdFile = join(jdsPath, `workflow-${Date.now()}-${item.index}.md`);
    writeFileSync(jdFile, `Posted: not visible in source\n\n**URL:** ${jd.url || url}\n\n${jd.text}\n`);
    const result = run('openai-eval.mjs', ['--posting-url', url, '--file', jdFile, ...(values.model ? ['--model', values.model] : [])]);
    if (result.status === 0) lines[item.index] = item.line.replace('- [ ]', '- [x]');
  }
  writeFileSync(pipelinePath, lines.join('\n'));
}

try { main(); } catch (error) { console.error(`batch-evaluate-openai: ${error.message}`); process.exitCode = 1; }