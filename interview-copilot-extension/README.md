# Interview Copilot (Chrome extension)

Hears the interviewer's questions during any browser-based meeting (Google Meet, Zoom web,
Microsoft Teams web, Webex, and others) and streams a senior-level spoken answer, grounded in your resume and the job description of the
application you pick. ChatGPT-style side panel; answers appear word by word.

## How it works
- **Voice mode (default)**: the extension captures the meeting tab's audio and transcribes it
  **locally** with Whisper (transformers.js — WebGPU when available, otherwise CPU/WASM). Nothing
  leaves your machine except the final question text sent to your own backend. Tab audio only
  contains the *other* participants, so your own voice is never mistaken for the interviewer.
  The speech model (~40 MB) is downloaded once and cached.
- **Captions mode** (menu → Source): reads the platform's live captions from the page instead.
  Google Meet, Zoom, Teams and Webex have dedicated readers; any other site uses a generic reader.
  Useful on machines too slow for local transcription.
- When another participant finishes a sentence that looks like a question, it is sent to the
  backend `POST /api/interview/answer`, which streams the answer from DeepSeek (fast model,
  thinking off, compact prompt) over Server-Sent Events.
- Context = your profile (from the dashboard) + the JD of the application you select in the
  panel's dropdown. Recent Q&A turns are sent back for continuity.
- Your own captions are ignored (set your meeting name under ⋯ if it isn't recognised).

## Install (unpacked)
1. Chrome → `chrome://extensions` → enable **Developer mode** → **Load unpacked** → pick this folder.
2. Copy the extension ID shown on the card and add it to the backend's `CHROME_EXTENSION_IDS`
   env var (comma-separated) so CORS allows it in production.
3. Click the toolbar icon → the side panel opens. Sign in with your AI Resume Builder account
   (the API URL defaults to the production server; change it under "API server" if needed).

## Interview sessions (recording, transcript, summary)
- Pick the **interview** (calendar event) in the dropdown — the nearest upcoming one is preselected.
  The ℹ button shows the meeting brief: your note, previous rounds with their summaries, JD and
  resume downloads.
- While listening, the interviewer's audio is recorded and transcribed. Each detected question is
  answered using everything the interviewer said since the previous question as context.
- Press **End interview** (or stop listening): the recording, transcript and detected Q&A are
  uploaded to the app and a meeting summary is generated. It appears in the panel and on the
  Interviews page (event detail → Recording & summary), and is used to brief the next round.

## Using it
1. Join the meeting in a Chrome tab.
2. With the meeting tab active, press **Ctrl+Shift+Y** (Mac: Cmd+Shift+Y) — this opens the panel
   and starts listening. (Clicking the toolbar icon while on the meeting tab, then **Listen**, does
   the same.) Chrome only allows capturing a tab you invoked the extension on, so do this from the
   meeting tab itself. In the panel choose the application (company/role) to answer from.
3. Questions from the interviewer appear on the right; the suggested answer streams in below.
   Use **Copy**, **Shorter** or **Regenerate**, or type any question in the box at the bottom.
4. Toggle **Auto-answer** off (⋯ menu) if you'd rather review the detected question before
   answering.

## Notes
- Voice mode speed depends on your machine: with a GPU (WebGPU) transcription is well under a
  second per sentence; on CPU-only machines it can take several seconds — switch to Captions mode
  there.
- Chrome asks for permission to capture the tab the first time; the panel must be opened from the
  toolbar icon while the meeting tab is active (that grants the capture permission).
- Caption DOM selectors are best-effort per platform and may need updating when Google/Zoom/
  Microsoft change their UI; the generic reader and manual typing still work.
- Desktop apps (Zoom/Teams clients, phone calls) have no web page to read — type the question instead.
- Backend files this extension relies on: `backend/src/routes/interview.js`,
  `streamChat` in `backend/src/services/openai.js`.
