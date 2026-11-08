/**
 * Voice engine: captures the meeting tab's audio (remote participants only — your own mic is
 * not part of tab output), detects speech with a simple energy VAD, and transcribes each
 * utterance locally with Whisper (stt-worker.js). Emits interviewer text + detected questions.
 */
const VoiceEngine = (() => {
  const SAMPLE_RATE = 16000;
  const FRAME = 1600;                 // 100 ms blocks from the worklet
  const SPEECH_RMS = 0.012;           // energy threshold (tab audio is normalised, so this is stable)
  const SILENCE_END_MS = 700;         // pause that ends an utterance
  const MIN_UTTERANCE_MS = 500;
  const MAX_UTTERANCE_MS = 12000;     // force a cut so long monologues still get transcribed
  const INTERIM_EVERY_MS = 3500;      // partial transcript while someone keeps talking
  const PRE_ROLL_FRAMES = 3;          // keep 300 ms before speech starts

  let audioContext = null;
  let stream = null;
  let recorder = null;
  let chunks = [];
  let recordingStartedAt = 0;
  let worker = null;
  let ready = false;
  let handlers = {};
  let nextId = 1;
  const pending = new Map();

  // VAD state
  let speaking = false;
  let silenceMs = 0;
  let speechMs = 0;
  let sinceInterimMs = 0;
  let segment = [];
  let preRoll = [];
  let noiseFloor = 0.004;

  const emit = (name, payload) => { try { handlers[name]?.(payload); } catch {} };

  function rms(frame) {
    let s = 0;
    for (let i = 0; i < frame.length; i++) s += frame[i] * frame[i];
    return Math.sqrt(s / frame.length);
  }

  function concat(frames) {
    const len = frames.reduce((n, f) => n + f.length, 0);
    const out = new Float32Array(len);
    let o = 0;
    for (const f of frames) { out.set(f, o); o += f.length; }
    return out;
  }

  function ensureWorker() {
    if (worker) return worker;
    worker = new Worker(chrome.runtime.getURL('stt-worker.js'), { type: 'module' });
    worker.onmessage = (e) => {
      const m = e.data;
      if (m.type === 'progress') emit('progress', m);
      else if (m.type === 'ready') { ready = true; emit('ready', m); }
      else if (m.type === 'log') emit('log', m);
      else if (m.type === 'result') { const p = pending.get(m.id); pending.delete(m.id); p?.resolve(m); }
      else if (m.type === 'error') { const p = pending.get(m.id); pending.delete(m.id); if (p) p.reject(new Error(m.error)); else emit('error', m); }
    };
    worker.onerror = (e) => emit('error', { error: e.message || 'Speech worker crashed' });
    return worker;
  }

  function transcribe(audio, final) {
    return new Promise((resolve, reject) => {
      const id = nextId++;
      pending.set(id, { resolve, reject });
      ensureWorker().postMessage({ type: 'transcribe', id, audio, final }, [audio.buffer]);
    });
  }

  // Serialise transcriptions so results arrive in order; interim results are dropped if a
  // newer one is already queued.
  let queue = Promise.resolve();
  let lastInterimId = 0;
  function enqueue(frames, final) {
    const audio = concat(frames);
    const myInterim = final ? 0 : ++lastInterimId;
    queue = queue.then(async () => {
      if (!final && myInterim !== lastInterimId) return; // superseded
      try {
        const r = await transcribe(audio, final);
        if (r.text && !/^[\s.]*$/.test(r.text)) emit('transcript', { text: r.text, final, ms: r.ms });
      } catch (err) {
        emit('error', { error: err.message });
      }
    });
  }

  function onFrame(frame) {
    const level = rms(frame);
    // Track the noise floor slowly while nobody is speaking.
    if (!speaking) noiseFloor = noiseFloor * 0.98 + level * 0.02;
    const threshold = Math.max(SPEECH_RMS, noiseFloor * 3);
    const isSpeech = level > threshold;
    emit('level', { level, speaking });

    if (!speaking) {
      preRoll.push(frame);
      if (preRoll.length > PRE_ROLL_FRAMES) preRoll.shift();
      if (isSpeech) {
        speaking = true;
        segment = [...preRoll, frame];
        preRoll = [];
        speechMs = 100;
        silenceMs = 0;
        sinceInterimMs = 0;
        emit('speech-start');
      }
      return;
    }

    segment.push(frame);
    speechMs += 100;
    sinceInterimMs += 100;
    silenceMs = isSpeech ? 0 : silenceMs + 100;

    if (silenceMs >= SILENCE_END_MS || speechMs >= MAX_UTTERANCE_MS) {
      const frames = segment;
      speaking = false;
      segment = [];
      emit('speech-end');
      if (speechMs - silenceMs >= MIN_UTTERANCE_MS) enqueue(frames, true);
      speechMs = 0;
      silenceMs = 0;
    } else if (sinceInterimMs >= INTERIM_EVERY_MS) {
      sinceInterimMs = 0;
      enqueue(segment.slice(), false);
    }
  }

  async function start(tabId, opts = {}) {
    handlers = opts.handlers || {};
    ensureWorker();
    if (!ready) worker.postMessage({ type: 'load', model: opts.model || 'fast' });

    const streamId = await chrome.tabCapture.getMediaStreamId({ targetTabId: tabId });
    stream = await navigator.mediaDevices.getUserMedia({
      audio: { mandatory: { chromeMediaSource: 'tab', chromeMediaSourceId: streamId } },
      video: false
    });

    audioContext = new AudioContext();
    await audioContext.audioWorklet.addModule(chrome.runtime.getURL('pcm-worklet.js'));
    const source = audioContext.createMediaStreamSource(stream);
    const node = new AudioWorkletNode(audioContext, 'pcm-worklet');
    node.port.onmessage = (e) => onFrame(e.data);
    source.connect(node);
    // Capturing a tab mutes it for the user unless the audio is played back — keep hearing the call.
    source.connect(audioContext.destination);
    await audioContext.resume();
    stream.getAudioTracks()[0]?.addEventListener('ended', () => { emit('ended'); stop(); });

    // Full recording of the interviewer side, uploaded to the app when the interview ends.
    chunks = [];
    const mime = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus'].find((m) => MediaRecorder.isTypeSupported(m)) || '';
    try {
      recorder = new MediaRecorder(stream, mime ? { mimeType: mime, audioBitsPerSecond: 48000 } : undefined);
      recorder.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
      recorder.start(5000);
      recordingStartedAt = Date.now();
    } catch (err) {
      recorder = null;
      emit('log', { message: 'Recording unavailable: ' + err.message });
    }
  }

  // Stops the recorder and returns { blob, durationSec } (blob is null if nothing was recorded).
  function finishRecording() {
    return new Promise((resolve) => {
      const done = () => {
        const type = recorder?.mimeType || chunks[0]?.type || 'audio/webm';
        const blob = chunks.length ? new Blob(chunks, { type }) : null;
        const durationSec = recordingStartedAt ? Math.round((Date.now() - recordingStartedAt) / 1000) : 0;
        chunks = [];
        recorder = null;
        recordingStartedAt = 0;
        resolve({ blob, durationSec });
      };
      if (recorder && recorder.state !== 'inactive') {
        recorder.onstop = done;
        try { recorder.stop(); } catch { done(); }
      } else {
        done();
      }
    });
  }

  function elapsedSec() {
    return recordingStartedAt ? Math.round((Date.now() - recordingStartedAt) / 1000) : 0;
  }

  function stop() {
    try { if (recorder && recorder.state !== 'inactive') recorder.stop(); } catch {}
    try { stream?.getTracks().forEach((t) => t.stop()); } catch {}
    try { audioContext?.close(); } catch {}
    stream = null;
    audioContext = null;
    speaking = false;
    segment = [];
    preRoll = [];
  }

  function preload(model = 'fast') {
    ensureWorker();
    if (!ready) worker.postMessage({ type: 'load', model });
  }

  return { start, stop, preload, finishRecording, elapsedSec, isReady: () => ready };
})();
