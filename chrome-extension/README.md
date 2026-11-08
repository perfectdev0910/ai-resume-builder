# AI Resume Builder — Chrome extension

Two things live here:

1. **Single job** — scrape the job description of the page you are on and generate one resume
   (the original flow).
2. **Bulk** — collect jobs from a job board automatically, then generate a tailored resume and
   cover letter for each one and write an Excel report. Everything happens inside the extension;
   no other tools are needed.

## Bulk flow

1. Open the job board (logged in, with your date filter set: Past 24 hours / 3 days / week).
2. Click the extension icon → **Collect jobs**.
3. Enter **Target** (how many jobs you want), pick the range, and press **▶ Start auto-collect**.

   The extension then opens each job in the tab, waits for the description, and:
   - ignores **LinkedIn Easy Apply** jobs,
   - skips companies you applied to in the last 30 days (the same check the Generate page uses),
   - skips anything already collected,
   - marks each job **Applied** on the board once its description is captured,
   - scrolls / pages for more until your target is reached.

   Progress shows live and keeps running while the popup is closed. **Stop** ends it any time.
   Each behaviour has a checkbox if you want it off, and **Collect only what is on screen** does
   a single manual pass instead.

4. Scroll down to **Generate resumes & Excel**, pick a document style, and press the button.

   For every collected job the extension calls your app, downloads the resume and cover letter
   (PDF + DOCX) into `Downloads/AI-Resume-Builder/batch-<date>/`, and writes `jobs.xlsx` in the
   same folder. This also continues while the popup is closed; **Stop** pauses it and pressing
   the button again resumes where it left off.

### The Excel

One row per job: Status · Company · Role · Match % · Posted · Location · Salary · JD link ·
Resume PDF · Resume DOCX · Cover letter PDF · Cover letter DOCX · Application · Collected ·
Generated · Range · Error. The JD link and each file cell are clickable (files open from disk).

**Retry failed** re-runs only the rows that failed. **Download Excel again** rewrites the report
without regenerating anything. **Clear** forgets the collected jobs (and with them the memory of
what was already collected).

Jobs without a captured description, or with no company name detected, are marked `skipped` with
the reason in the Error column rather than generated.

### Notes

- The `job-runner/` folder at the repo root does the same generation from an exported JSON file
  if you would rather run it from a terminal. **Export JSON** in the popup produces that file.
- Many job boards, Jobright included, prohibit automated extraction in their terms of service.
  Everything here runs in your own logged-in session at human pace, but the account risk is yours.
