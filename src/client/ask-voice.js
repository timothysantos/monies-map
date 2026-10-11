// Voice input for the Ask composer (design.md "Ask page", docs/flows/ask-flow.md
// "Voice input"). Hold the mic to talk, or tap to start and tap to stop; the
// words fill the message box and the person checks and sends them. Nothing
// here ever sends the message.
//
// Two paths, chosen once per page:
// 1. "speech": the browser's own speech recognition (SpeechRecognition or
//    webkitSpeechRecognition, which iPhone Safari has), en-SG with an en-US
//    fallback, interim words shown as they arrive. Nothing goes to our
//    servers.
// 2. "record": only when the browser has no speech recognition. A clip of at
//    most 30 s is recorded (MediaRecorder, 32 kbit/s) and written down by
//    POST /api/ai-assist/transcribe (Workers AI, the shared daily
//    allowance). A GET on the same route first says whether that is
//    available, before the microphone is asked for; when it is not, the mic
//    is hidden with one calm note.
//
// The controller is plain JavaScript (no React) so its states are unit
// tested: idle → starting → listening → (transcribing →) idle, or hidden.
// Callbacks: onChange(state), onTranscript(text, { final }) with the whole
// text so far, onNote(key) for a calm note (keys in askCopy.voice.notes).

export const VOICE_HOLD_MS = 350;
export const VOICE_MAX_RECORD_MS = 30_000;
export const VOICE_LANGS = ["en-SG", "en-US"];
export const TRANSCRIBE_ENDPOINT = "/api/ai-assist/transcribe";
// Shorter than this holds no words worth sending.
const MIN_RECORD_MS = 400;
const RECORD_BITS_PER_SECOND = 32_000;
// iPhone Safari records MP4/AAC; Chrome and Firefox record WebM or Ogg Opus.
const RECORD_TYPES = ["audio/webm;codecs=opus", "audio/mp4", "audio/ogg;codecs=opus", "audio/webm"];

export function detectVoiceSupport(win) {
  const candidate = win?.SpeechRecognition ?? win?.webkitSpeechRecognition ?? null;
  return {
    Recognition: typeof candidate === "function" ? candidate : null,
    canRecord: typeof win?.MediaRecorder === "function" && typeof win?.navigator?.mediaDevices?.getUserMedia === "function"
  };
}

// The spoken words after whatever was already typed.
export function joinSpokenText(base, spoken) {
  const before = String(base ?? "").trim();
  const words = String(spoken ?? "").trim();
  return [before, words].filter(Boolean).join(" ");
}

// Hold or tap on one button. down() on press, up() on release, cancel() when
// the browser takes the pointer away (a permission sheet, a scroll). A press
// that started listening and was held past VOICE_HOLD_MS stops on release;
// a shorter one (or one still waiting for permission) keeps listening until
// the next press, which stops on its release.
export function createPressGesture({ holdMs = VOICE_HOLD_MS, now = () => Date.now() } = {}) {
  let press = null;
  return {
    down(active) {
      press = { at: now(), started: !active };
      return active ? "none" : "start";
    },
    up(listening) {
      const current = press;
      press = null;
      if (!current) {
        return "none";
      }
      if (!current.started) {
        return "stop";
      }
      return listening && now() - current.at >= holdMs ? "stop" : "none";
    },
    cancel(listening) {
      const current = press;
      press = null;
      return current?.started && listening ? "stop" : "none";
    }
  };
}

function transcriptOf(results) {
  let text = "";
  for (let index = 0; index < (results?.length ?? 0); index += 1) {
    text += results[index]?.[0]?.transcript ?? "";
  }
  return text.replace(/\s+/g, " ").trim();
}

function pickRecordType(MediaRecorder) {
  if (typeof MediaRecorder?.isTypeSupported !== "function") {
    return "";
  }
  return RECORD_TYPES.find((type) => MediaRecorder.isTypeSupported(type)) ?? "";
}

/**
 * @param {{
 *   win?: any,
 *   fetchImpl?: (url: string, init?: RequestInit) => Promise<any>,
 *   onChange?: (state: { status: string, path: string, note: string }) => void,
 *   onTranscript?: (text: string, meta: { final: boolean }) => void,
 *   onNote?: (key: string) => void,
 *   now?: () => number,
 *   setTimer?: (fn: () => void, ms: number) => any,
 *   clearTimer?: (id: any) => void
 * }} [options]
 */
export function createVoiceController({
  win = typeof window === "undefined" ? undefined : window,
  fetchImpl = (...args) => fetch(...args),
  onChange = () => {},
  onTranscript = () => {},
  onNote = () => {},
  now = () => Date.now(),
  setTimer = (fn, ms) => setTimeout(fn, ms),
  clearTimer = (id) => clearTimeout(id)
} = {}) {
  const support = detectVoiceSupport(win);
  let state = {
    status: support.Recognition || support.canRecord ? "idle" : "hidden",
    path: support.Recognition ? "speech" : support.canRecord ? "record" : "none",
    note: ""
  };
  // Each start is a session; events from an older one are ignored.
  let session = 0;
  let langIndex = 0;
  let recognition = null;
  // Whether the transcribe route is on: null until asked once.
  let recordAvailable = null;
  let recorder = null;
  let stream = null;
  let stopTimer = null;
  let stopWhenStarted = false;

  function set(patch) {
    state = { ...state, ...patch };
    onChange(state);
  }

  function note(key, patch = {}) {
    set({ status: "idle", ...patch, note: key });
    onNote(key);
  }

  function hide() {
    set({ status: "hidden", path: "none", note: "unavailable" });
    onNote("unavailable");
  }

  function releaseMicrophone() {
    stream?.getTracks?.().forEach((track) => track.stop());
    stream = null;
    if (stopTimer !== null) {
      clearTimer(stopTimer);
      stopTimer = null;
    }
  }

  function startSpeech(current) {
    const rec = new support.Recognition();
    recognition = rec;
    rec.lang = VOICE_LANGS[langIndex];
    rec.interimResults = true;
    rec.continuous = true;
    rec.maxAlternatives = 1;
    let text = "";
    let failure = "";
    let retryLanguage = false;
    let useRecorder = false;
    const live = () => current === session && recognition === rec;
    const markListening = () => {
      if (live() && state.status === "starting") {
        set({ status: "listening" });
      }
    };
    rec.onstart = markListening;
    rec.onaudiostart = markListening;
    rec.onresult = (event) => {
      if (!live()) return;
      markListening();
      text = transcriptOf(event.results);
      onTranscript(text, { final: false });
    };
    rec.onerror = (event) => {
      if (!live()) return;
      const error = event?.error ?? "";
      if (error === "aborted") return;
      if (error === "language-not-supported" && langIndex < VOICE_LANGS.length - 1) {
        langIndex += 1;
        retryLanguage = true;
      } else if (error === "not-allowed") {
        failure = "denied";
      } else if (error === "service-not-allowed") {
        // The browser has recognition but will not run it here (an iPhone
        // with Siri and Dictation off, some home-screen apps).
        if (support.canRecord) useRecorder = true;
        else failure = "unavailable";
      } else if (error === "no-speech") {
        failure = "noSpeech";
      } else {
        failure = "failed";
      }
    };
    rec.onend = () => {
      if (!live()) return;
      recognition = null;
      if (retryLanguage) {
        startSpeech(current);
        return;
      }
      if (useRecorder) {
        state = { ...state, path: "record" };
        void startRecording(current);
        return;
      }
      if (text) {
        onTranscript(text, { final: true });
      }
      if (failure === "unavailable" && !text) {
        hide();
      } else if (failure && !text) {
        note(failure);
      } else {
        set({ status: "idle" });
      }
    };
    try {
      rec.start();
      return true;
    } catch {
      // No user activation yet (a press on a touch screen); the page tries
      // again on the tap that follows.
      recognition = null;
      set({ status: "idle" });
      return false;
    }
  }

  async function isRecordAvailable() {
    if (recordAvailable !== null) {
      return recordAvailable;
    }
    const response = await fetchImpl(TRANSCRIBE_ENDPOINT, { method: "GET" });
    const body = response.ok ? await response.json().catch(() => null) : null;
    if (!body || typeof body.available !== "boolean") {
      throw new Error("unknown");
    }
    recordAvailable = body.available;
    return recordAvailable;
  }

  async function startRecording(current) {
    set({ status: "starting", note: "" });
    let available;
    try {
      available = await isRecordAvailable();
    } catch {
      if (current === session) note("failed");
      return;
    }
    if (current !== session) return;
    if (!available) {
      hide();
      return;
    }
    let granted;
    try {
      granted = await win.navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (error) {
      if (current === session) note(error?.name === "NotAllowedError" || error?.name === "SecurityError" ? "denied" : "failed");
      return;
    }
    if (current !== session) {
      granted?.getTracks?.().forEach((track) => track.stop());
      return;
    }
    stream = granted;
    const mimeType = pickRecordType(win.MediaRecorder);
    let rec;
    try {
      rec = new win.MediaRecorder(stream, { ...(mimeType ? { mimeType } : {}), audioBitsPerSecond: RECORD_BITS_PER_SECOND });
    } catch {
      releaseMicrophone();
      note("failed");
      return;
    }
    recorder = rec;
    const chunks = [];
    let startedAt = now();
    rec.ondataavailable = (event) => {
      if (event?.data?.size) chunks.push(event.data);
    };
    rec.onstop = () => {
      releaseMicrophone();
      if (current !== session || recorder !== rec) return;
      recorder = null;
      const durationMs = Math.min(now() - startedAt, VOICE_MAX_RECORD_MS);
      const clip = new Blob(chunks, { type: rec.mimeType || mimeType || "audio/webm" });
      if (!clip.size || durationMs < MIN_RECORD_MS) {
        note("noSpeech");
        return;
      }
      void transcribe(current, clip, durationMs);
    };
    rec.start();
    startedAt = now();
    stopTimer = setTimer(() => stop(), VOICE_MAX_RECORD_MS);
    set({ status: "listening" });
    if (stopWhenStarted) {
      stopWhenStarted = false;
      stop();
    }
  }

  async function transcribe(current, clip, durationMs) {
    set({ status: "transcribing" });
    const form = new FormData();
    form.append("audio", clip, "voice");
    form.append("durationMs", String(Math.round(durationMs)));
    let response;
    let body = null;
    try {
      response = await fetchImpl(TRANSCRIBE_ENDPOINT, { method: "POST", body: form });
      body = await response.json().catch(() => null);
    } catch {
      if (current === session) note("failed");
      return;
    }
    if (current !== session) return;
    if (response.status === 413) {
      note("tooLong");
    } else if (!response.ok || !body) {
      note("failed");
    } else if (body.available && typeof body.text === "string" && body.text.trim()) {
      onTranscript(body.text.trim(), { final: true });
      set({ status: "idle" });
    } else if (body.code === "off") {
      recordAvailable = false;
      hide();
    } else if (body.code === "allowance") {
      note("allowance");
    } else {
      note("failed");
    }
  }

  // Starts listening. Returns false when nothing started (hidden, busy, or
  // the browser wants a tap first).
  function start() {
    if (state.status !== "idle") {
      return false;
    }
    session += 1;
    stopWhenStarted = false;
    if (state.path === "speech") {
      set({ status: "starting", note: "" });
      return startSpeech(session);
    }
    void startRecording(session);
    return true;
  }

  // Stops listening and keeps the words (the recording is written down).
  function stop() {
    if (state.status === "starting" && state.path === "record" && !recorder) {
      // Still asking for the microphone: stop as soon as it starts.
      stopWhenStarted = true;
      return;
    }
    if (recognition) {
      recognition.stop();
    } else if (recorder && recorder.state === "recording") {
      recorder.stop();
    }
  }

  // Drops whatever is in progress (send pressed, page left): no more words.
  function cancel() {
    session += 1;
    const rec = recognition;
    recognition = null;
    rec?.abort?.();
    const recording = recorder;
    recorder = null;
    if (recording && recording.state === "recording") {
      recording.stop();
    }
    releaseMicrophone();
    stopWhenStarted = false;
    if (state.status !== "hidden" && state.status !== "idle") {
      set({ status: "idle" });
    }
  }

  return {
    getState: () => state,
    start,
    stop,
    cancel,
    dispose: cancel
  };
}
