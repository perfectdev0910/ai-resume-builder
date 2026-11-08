#!/usr/bin/env node
/**
 * job-runner — turns jobs collected by the AI Resume Builder extension into tailored
 * resumes plus an Excel report.
 *
 *   node run.js --input collected-jobs.json [options]
 *
 * Options
 *   --input <file>     JSON exported from the extension ("Export JSON"). Required.
 *   --out <dir>        Output directory (default: ./output)
 *   --api <url>        API base (default: $API_URL or the production server)
 *   --email / --password    Credentials (or $JOB_RUNNER_EMAIL / $JOB_RUNNER_PASSWORD)
 *   --token <jwt>      Use an existing token instead of logging in
 *   --limit <n>        Only process the first N jobs that still need a resume
 *   --range <key>      Only jobs collected under this range (past_24h | past_3d | past_week)
 *   --min-match <n>    Skip jobs whose Jobright match score is below n
 *   --concurrency <n>  Parallel generations (default 2 — generation is LLM-bound)
 *   --no-download      Don't download the resume/cover-letter files, just record links
 *   --template <id>    Document style: classic | modern | minimal | executive | bold | compact
 *   --dry-run          Show what would happen without calling the API
 *
 * State lives in <out>/state.json so re-running only processes what failed or is new.
 */
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const readline = require('readline');
const ExcelJS = require('exceljs');

const DEFAULT_API = process.env.API_URL || 'https://ai-resume-builder-api-8aj2.onrender.com';

/* ------------------------------------------------------------------ */
/* args                                                                */
/* ------------------------------------------------------------------ */
function parseArgs(argv) {
  const args = { concurrency: 2, out: path.resolve('output'), api: DEFAULT_API, download: true };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    switch (a) {
      case '--input': case '-i': args.input = next(); break;
      case '--out': case '-o': args.out = path.resolve(next()); break;
      case '--api': args.api = next(); break;
      case '--email': args.email = next(); break;
      case '--password': args.password = next(); break;
      case '--token': args.token = next(); break;
      case '--limit': args.limit = Number(next()); break;
      case '--range': args.range = next(); break;
      case '--min-match': args.minMatch = Number(next()); break;
      case '--concurrency': case '-c': args.concurrency = Math.max(1, Number(next()) || 2); break;
      case '--template': args.template = next(); break;
      case '--no-download': args.download = false; break;
      case '--dry-run': args.dryRun = true; break;
      case '--help': case '-h': args.help = true; break;
      default:
        if (!args.input && !a.startsWith('-')) args.input = a;
        else console.warn(`Ignoring unknown option: ${a}`);
    }
  }
  return args;
}

function usage() {
  console.log(fs.readFileSync(__filename, 'utf8').split('*/')[0].replace(/^#!.*\n/, '').replace(/^\/\*\*?/, '').replace(/^ \* ?/gm, ''));
}

/* ------------------------------------------------------------------ */
/* helpers                                                             */
/* ------------------------------------------------------------------ */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function sanitize(name) {
  return String(name || 'file').replace(/[^\w\s.-]/g, '').replace(/\s+/g, '_').slice(0, 80) || 'file';
}

function prettyCompanyName(name) {
  const trimmed = String(name || '').trim();
  if (!trimmed) return '';
  if (trimmed !== trimmed.toLowerCase() && trimmed !== trimmed.toUpperCase()) return trimmed;
  return trimmed.replace(/\S+/g, (w) => (w.length <= 4 && w === w.toUpperCase() ? w : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()));
}

function ask(question, { silent = false } = {}) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    if (silent) {
      const onData = (char) => {
        if (['\n', '\r', ''].includes(String(char))) process.stdin.removeListener('data', onData);
        else readline.moveCursor(process.stdout, -1, 0), process.stdout.write('*');
      };
      process.stdin.on('data', onData);
    }
    rl.question(question, (answer) => { rl.close(); if (silent) process.stdout.write('\n'); resolve(answer.trim()); });
  });
}

class Api {
  constructor(base, token) {
    this.base = String(base).replace(/\/+$/, '').replace(/\/api$/i, '');
    this.token = token || null;
  }
  url(p) { return `${this.base}/api${p}`; }
  headers(extra = {}) { return { ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}), ...extra }; }

  async json(p, options = {}) {
    const res = await fetch(this.url(p), { ...options, headers: this.headers({ 'Content-Type': 'application/json', ...(options.headers || {}) }) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(data.error || data.message || `Request failed (${res.status})`);
      err.status = res.status;
      err.data = data;
      throw err;
    }
    return data;
  }

  async login(email, password) {
    const data = await this.json('/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) });
    if (!data.token) throw new Error(data.message || 'Login failed');
    this.token = data.token;
    return data.user;
  }

  generate(body) {
    // Generation is slow (two LLM calls + document rendering): allow a long timeout.
    return this.json('/cv/generate', { method: 'POST', body: JSON.stringify(body), signal: AbortSignal.timeout(300000) });
  }

  async download(p, destination) {
    const res = await fetch(this.url(p), { headers: this.headers() });
    if (!res.ok) throw new Error(`Download failed (${res.status})`);
    await fsp.writeFile(destination, Buffer.from(await res.arrayBuffer()));
    return destination;
  }
}

/* ------------------------------------------------------------------ */
/* state                                                               */
/* ------------------------------------------------------------------ */
async function loadState(file) {
  try { return JSON.parse(await fsp.readFile(file, 'utf8')); } catch { return { jobs: {} }; }
}
async function saveState(file, state) {
  await fsp.writeFile(file, JSON.stringify(state, null, 2));
}

/* ------------------------------------------------------------------ */
/* excel                                                               */
/* ------------------------------------------------------------------ */
async function writeExcel(file, rows) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'AI Resume Builder — job-runner';
  wb.created = new Date();
  const ws = wb.addWorksheet('Jobs', { views: [{ state: 'frozen', ySplit: 1 }] });

  ws.columns = [
    { header: 'Status', key: 'status', width: 12 },
    { header: 'Company', key: 'company', width: 26 },
    { header: 'Role', key: 'role', width: 34 },
    { header: 'Match %', key: 'match', width: 9 },
    { header: 'Posted', key: 'posted', width: 14 },
    { header: 'Location', key: 'location', width: 20 },
    { header: 'Salary', key: 'salary', width: 18 },
    { header: 'JD link', key: 'link', width: 46 },
    { header: 'Resume PDF', key: 'resumePdf', width: 30 },
    { header: 'Resume DOCX', key: 'resumeDocx', width: 30 },
    { header: 'Cover letter PDF', key: 'coverPdf', width: 30 },
    { header: 'Cover letter DOCX', key: 'coverDocx', width: 30 },
    { header: 'Application', key: 'application', width: 32 },
    { header: 'Collected', key: 'collectedAt', width: 20 },
    { header: 'Generated', key: 'generatedAt', width: 20 },
    { header: 'Range', key: 'range', width: 11 },
    { header: 'Error', key: 'error', width: 50 }
  ];
  ws.getRow(1).font = { bold: true };
  ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEFF1F5' } };
  ws.autoFilter = { from: 'A1', to: 'Q1' };

  const link = (cell, target, text) => {
    if (!target) return;
    cell.value = { text: text || target, hyperlink: target };
    cell.font = { color: { argb: 'FF1D4ED8' }, underline: true };
  };

  for (const row of rows) {
    const r = ws.addRow({
      status: row.status,
      company: row.company,
      role: row.role,
      match: row.match ?? '',
      posted: row.posted,
      location: row.location,
      salary: row.salary,
      collectedAt: row.collectedAt,
      generatedAt: row.generatedAt,
      range: row.range,
      error: row.error
    });
    link(r.getCell('link'), row.link, row.link);
    link(r.getCell('resumePdf'), row.resumePdf, row.resumePdf ? path.basename(row.resumePdf) : '');
    link(r.getCell('resumeDocx'), row.resumeDocx, row.resumeDocx ? path.basename(row.resumeDocx) : '');
    link(r.getCell('coverPdf'), row.coverPdf, row.coverPdf ? path.basename(row.coverPdf) : '');
    link(r.getCell('coverDocx'), row.coverDocx, row.coverDocx ? path.basename(row.coverDocx) : '');
    link(r.getCell('application'), row.applicationUrl, row.applicationId ? `#${row.applicationId} in app` : '');
    const colour = row.status === 'generated' ? 'FFECFDF5' : row.status === 'failed' ? 'FFFEF2F2' : row.status === 'skipped' ? 'FFF9FAFB' : 'FFFFFBEB';
    r.getCell('status').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: colour } };
  }

  await wb.xlsx.writeFile(file);
}

/* ------------------------------------------------------------------ */
/* main                                                                */
/* ------------------------------------------------------------------ */
async function main() {
  const args = parseArgs(process.argv);
  if (args.help || !args.input) { usage(); process.exit(args.help ? 0 : 1); }

  const raw = JSON.parse(await fsp.readFile(path.resolve(args.input), 'utf8'));
  let jobs = Array.isArray(raw) ? raw : raw.jobs || [];
  if (!jobs.length) { console.error('No jobs in the input file.'); process.exit(1); }

  if (args.range) jobs = jobs.filter((j) => j.range === args.range);
  if (Number.isFinite(args.minMatch)) jobs = jobs.filter((j) => (j.matchScore ?? 0) >= args.minMatch);

  await fsp.mkdir(args.out, { recursive: true });
  const filesDir = path.join(args.out, 'files');
  if (args.download) await fsp.mkdir(filesDir, { recursive: true });
  const stateFile = path.join(args.out, 'state.json');
  const state = await loadState(stateFile);

  const key = (j) => j.jobId || j.url;
  const pending = jobs.filter((j) => state.jobs[key(j)]?.status !== 'generated');
  const todo = args.limit ? pending.slice(0, args.limit) : pending;

  console.log(`${jobs.length} job(s) in input · ${jobs.length - pending.length} already generated · ${todo.length} to process`);
  if (args.dryRun) {
    for (const j of todo) console.log(`  would generate: ${prettyCompanyName(j.company) || '(no company)'} — ${j.title || '(no title)'} ${j.jd ? '' : '[NO JD — will be skipped]'}`);
    return;
  }

  const api = new Api(args.api, args.token || process.env.JOB_RUNNER_TOKEN);
  if (!api.token) {
    const email = args.email || process.env.JOB_RUNNER_EMAIL || await ask('Email: ');
    const password = args.password || process.env.JOB_RUNNER_PASSWORD || await ask('Password: ', { silent: true });
    const user = await api.login(email, password);
    console.log(`Signed in as ${user?.email || email}`);
  }

  let done = 0;
  let generated = 0;
  let failed = 0;
  let skipped = 0;

  async function processJob(job) {
    const k = key(job);
    const company = prettyCompanyName(job.company);
    const label = `${company || '(no company)'} — ${job.title || '(no title)'}`;
    const record = state.jobs[k] || {};

    if (!job.jd || job.jd.length < 200) {
      state.jobs[k] = { ...record, ...snapshot(job), status: 'skipped', error: 'No job description captured — open the job in the browser and collect again.' };
      skipped++;
      console.log(`  [skip] ${label} — no description`);
      return;
    }
    if (!company) {
      state.jobs[k] = { ...record, ...snapshot(job), status: 'skipped', error: 'No company name detected — add it to the JSON and re-run.' };
      skipped++;
      console.log(`  [skip] ${label} — no company`);
      return;
    }

    try {
      const data = await api.generate({
        jobDescription: job.jd,
        jdLink: job.url,
        companyName: company,
        force: true,                       // the collector already de-duplicates
        ...(args.template ? { template: args.template } : {})
      });
      const app = data.application || {};
      const entry = {
        ...snapshot(job),
        status: 'generated',
        error: '',
        generatedAt: new Date().toISOString(),
        applicationId: app.id || null,
        role: app.jobTitle || job.title || '',
        company: app.companyName || company
      };

      if (args.download && app.id) {
        const base = `${sanitize(entry.company)}_${sanitize(entry.role)}_${app.id}`;
        const targets = [
          ['resumePdf', `/cv/download/pdf/${app.id}`, `${base}_resume.pdf`],
          ['resumeDocx', `/cv/download/docx/${app.id}`, `${base}_resume.docx`],
          ['coverPdf', `/cv/download/cover-letter/pdf/${app.id}`, `${base}_cover.pdf`],
          ['coverDocx', `/cv/download/cover-letter/docx/${app.id}`, `${base}_cover.docx`]
        ];
        for (const [field, route, filename] of targets) {
          try { entry[field] = await api.download(route, path.join(filesDir, filename)); }
          catch { /* cover letter may not exist; leave the cell blank */ }
        }
      }

      state.jobs[k] = entry;
      generated++;
      console.log(`  [ok]   ${label}${app.id ? ` → application #${app.id}` : ''}`);
    } catch (error) {
      state.jobs[k] = { ...record, ...snapshot(job), status: 'failed', error: error.message };
      failed++;
      console.log(`  [fail] ${label} — ${error.message}`);
      if (error.status === 401) throw error;    // token problem: stop early
    } finally {
      done++;
      if (done % 5 === 0) await saveState(stateFile, state);
    }
  }

  function snapshot(job) {
    return {
      link: job.url,
      company: prettyCompanyName(job.company),
      role: job.title || '',
      match: job.matchScore ?? '',
      posted: job.posted || '',
      location: job.location || '',
      salary: job.salary || '',
      range: job.range || '',
      collectedAt: job.collectedAt || ''
    };
  }

  // Bounded parallelism: generation is LLM-bound, so a couple at a time is plenty.
  let cursor = 0;
  const workers = Array.from({ length: Math.min(args.concurrency, todo.length) }, async () => {
    while (cursor < todo.length) {
      const job = todo[cursor++];
      await processJob(job);
      await sleep(250);                    // be gentle with the API
    }
  });
  try {
    await Promise.all(workers);
  } finally {
    await saveState(stateFile, state);
  }

  // Excel includes every job in the input, with whatever state it is in.
  const appBase = api.base.replace(/-api(-\w+)?\.onrender\.com/, '.vercel.app');
  const rows = jobs.map((j) => {
    const entry = state.jobs[key(j)] || { ...snapshot(j), status: 'pending', error: '' };
    return { ...entry, applicationUrl: entry.applicationId ? `${appBase}/history` : '' };
  });
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
  const excel = path.join(args.out, `jobs-${stamp}.xlsx`);
  await writeExcel(excel, rows);

  console.log(`\n${generated} generated · ${failed} failed · ${skipped} skipped`);
  console.log(`Excel: ${excel}`);
  if (args.download) console.log(`Files: ${filesDir}`);
  if (failed) console.log('Re-run the same command to retry the failures (already-generated jobs are skipped).');
}

main().catch((error) => {
  console.error(`\n${error.message}`);
  process.exit(1);
});
