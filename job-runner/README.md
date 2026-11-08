# job-runner

Turns jobs you collected with the **AI Resume Builder** extension into tailored resumes and
cover letters, and writes an Excel report.

You browse the job board yourself (with whatever date filter you want — Past 24 hours / 3 days /
week); the extension reads the job cards already on your screen and de-duplicates them. This tool
then generates documents for each one through your own app.

## 1 · Collect the jobs (in the browser)

1. Open the job board, log in as usual, and set your date filter (Past 24 hours / 3 days / week).
2. Click the **AI Resume Builder** extension icon → **Collect jobs**.
3. Enter how many jobs you want in **Target**, pick the matching range, and press
   **▶ Start auto-collect**.

That is all you do. The extension then, in your own visible tab:

- opens each job in turn and waits for its description to render,
- skips LinkedIn **Easy Apply** jobs, companies you already applied to in the last 30 days
  (same check the Generate page uses), and anything already collected,
- captures the description and marks the job **Applied** on the board,
- scrolls / pages for more when the visible cards run out,
- stops at your target.

Progress shows live in the popup (`Collecting… 7 / 25 · 11 opened`) and keeps running while the
popup is closed — reopen it any time to check. **Stop** ends it immediately. Each of the three
behaviours above has a checkbox if you want it off, and **Collect only what is on screen** is
still there for a manual pass.

4. When it finishes, press **Export JSON** and save the file.

## 2 · Generate resumes + Excel

```bash
cd job-runner
npm install                       # once
node run.js --input ~/Downloads/collected-jobs-2026-09-22.json
```

You'll be asked for your AI Resume Builder email and password (or pass `--email/--password`, or
set `JOB_RUNNER_EMAIL` / `JOB_RUNNER_PASSWORD`, or reuse a token with `--token`).

### Options

| Option | Meaning |
|---|---|
| `--input <file>` | The JSON exported from the extension (required) |
| `--out <dir>` | Output directory (default `./output`) |
| `--api <url>` | API base (default `$API_URL` or the production server) |
| `--limit <n>` | Only process the first N jobs that still need a resume |
| `--range past_24h\|past_3d\|past_week` | Only jobs collected under that range |
| `--min-match <n>` | Skip jobs below that match score |
| `--concurrency <n>` | Parallel generations (default 2) |
| `--template <id>` | Document style: classic, modern, minimal, executive, bold, compact |
| `--no-download` | Don't download files, just record the application ids |
| `--dry-run` | Show what would be generated and stop |

### Output

```
output/
  jobs-2026-09-22-14-05-11.xlsx     ← report (one row per job)
  files/                            ← resume + cover letter, PDF and DOCX per job
  state.json                        ← what already succeeded (re-runs skip it)
```

Excel columns: Status, Company, Role, Match %, Posted, Location, Salary, JD link, Resume PDF,
Resume DOCX, Cover letter PDF, Cover letter DOCX, Application, Collected, Generated, Range, Error.
Rows are colour-coded by status and the header row is filtered, so you can sort by match score or
show only failures.

Re-running the same command retries failures and picks up newly collected jobs; jobs already
generated are skipped.

### Why a job might be skipped

- **No job description captured** — open that job in the browser and collect again.
- **No company name detected** — add `"company"` to the entry in the JSON and re-run.

## Note on job boards

This collects only what your browser has already rendered while you browse — it does not log in,
paginate, or call site APIs on your behalf. Check the terms of service of any site you use it on;
bulk automated extraction is prohibited by many job boards, including Jobright.
