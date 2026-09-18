// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */

import { execFile } from 'child_process';
import { fileURLToPath } from 'url';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);
const EXTRACTOR_PATH = fileURLToPath(new URL('../browser-extract.mjs', import.meta.url));
const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_BUFFER_BYTES = 2_000_000;

function careersUrl(entry) {
  const raw = String(entry.careers_url || '').trim();
  const url = new URL(raw);
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new Error('career-page: careers_url must be http(s)');
  }
  return url.href;
}

export function isDirectPosting(job, listingUrl) {
  let url;
  let listing;
  try {
    url = new URL(job.url);
    listing = new URL(listingUrl);
  } catch {
    return false;
  }

  const path = url.pathname.toLowerCase();
  const title = String(job.title || '').toLowerCase();
  if (url.href === listing.href
    || /\/(?:career|salaries?)(?:\/|$)/.test(path)
    || /\/q-[^/]*-jobs\.html$/.test(path)
    || /\b(?:jobs?|salaries)\s+(?:in|for)\b|\bsalaries\b/.test(title)) {
    return false;
  }

  return /\/(?:jobs?\/|rc\/clk$)/.test(path)
    || url.searchParams.has('jk')
    || url.searchParams.has('jobId')
    || url.searchParams.has('job_id');
}

/** @type {Provider} */
export default {
  id: 'career-page',

  async fetch(entry, ctx) {
    const url = careersUrl(entry);
    const timeout = Number(entry.timeout_ms || DEFAULT_TIMEOUT_MS);
    const max = Number(entry.max_jobs || 200);
    const { stdout } = await execFileAsync(process.execPath, [
      EXTRACTOR_PATH,
      url,
      '--mode', 'listing',
      '--max', String(Number.isInteger(max) && max >= 0 ? max : 200),
      '--timeout', String(Number.isFinite(timeout) && timeout > 0 ? timeout : DEFAULT_TIMEOUT_MS),
    ], {
      timeout: timeout + 5_000,
      maxBuffer: MAX_BUFFER_BYTES,
      windowsHide: true,
    });

    let payload;
    try {
      payload = JSON.parse(stdout);
    } catch {
      throw new Error('career-page: browser extractor returned invalid JSON');
    }

    if (!Array.isArray(payload?.jobs)) {
      throw new Error('career-page: browser extractor returned no jobs array');
    }

    return payload.jobs
      .filter((job) => job && typeof job.title === 'string' && typeof job.url === 'string')
      .map((job) => ({
        title: job.title.trim(),
        url: job.url.trim(),
        company: entry.name || '',
        location: '',
      }))
      .filter((job) => job.title && /^https?:\/\//i.test(job.url) && isDirectPosting(job, url));
  },
};