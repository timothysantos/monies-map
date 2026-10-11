// The Ask composer's voice input (src/client/ask-voice.js): the controller's
// states with the browser's speech recognition (idle → listening → words →
// idle; permission denied; language fallback), the recorded-clip fallback
// when the browser has none (unsupported → fallback; fallback unavailable →
// hidden; allowance used; too long), the hold-or-tap gesture, and how the
// words join what is already typed. Nothing here ever sends the message.
import assert from "node:assert/strict";
import test from "node:test";

import {
  VOICE_HOLD_MS,
  VOICE_MAX_RECORD_MS,
  TRANSCRIBE_ENDPOINT,
  createPressGesture,
  createVoiceController,
  detectVoiceSupport,
  joinSpokenText
} from "../src/client/ask-voice.js";

// A stand-in for SpeechRecognition / webkitSpeechRecognition. The test
// drives its events the way a browser would.
function fakeRecognitionClass({ throwOnStart = null } = {}) {
  const instances = [];
  class FakeRecognition {
    constructor() {
      this.started = false;
      this.stopped = false;
      this.aborted = false;
      instances.push(this);
    }
    start() {
      if (throwOnStart) {
        throw throwOnStart;
      }
      this.started = true;
    }
    stop() { this.stopped = true; }
    abort() { this.aborted = true; }
    // Test helpers.
    emitStart() { this.onstart?.({}); }
    emitResults(results) {
      this.onresult?.({
        resultIndex: 0,
        results: results.map(([transcript, isFinal]) => Object.assign([{ transcript }], { isFinal }))
      });
    }
    emitError(error) { this.onerror?.({ error }); }
    emitEnd() { this.onend?.({}); }
  }
  return { FakeRecognition, instances };
}

function fakeMediaRecorder() {
  const recorders = [];
  class FakeMediaRecorder {
    static isTypeSupported(type) { return type === "audio/mp4"; }
    constructor(stream, options) {
      this.stream = stream;
      this.options = options;
      this.mimeType = options.mimeType ?? "";
      this.state = "inactive";
      recorders.push(this);
    }
    start() { this.state = "recording"; }
    stop() {
      this.state = "inactive";
      this.ondataavailable?.({ data: new Blob([new Uint8Array(this.clipBytes ?? 3000)], { type: this.mimeType }) });
      this.onstop?.({});
    }
  }
  return { FakeMediaRecorder, recorders };
}

function fakeStream() {
  const track = { stopped: false, stop() { this.stopped = true; } };
  return { track, getTracks: () => [track] };
}

function recordingWindow({ getUserMedia } = {}) {
  const { FakeMediaRecorder, recorders } = fakeMediaRecorder();
  const stream = fakeStream();
  return {
    recorders,
    stream,
    win: {
      MediaRecorder: FakeMediaRecorder,
      navigator: { mediaDevices: { getUserMedia: getUserMedia ?? (async () => stream) } }
    }
  };
}

function jsonResponse(status, body) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

function fakeFetch(responses) {
  const calls = [];
  const impl = async (url, init = {}) => {
    calls.push({ url, init });
    const next = responses.shift();
    if (next instanceof Error) {
      throw next;
    }
    return next;
  };
  return { impl, calls };
}

function harness(options) {
  const states = [];
  const transcripts = [];
  const notes = [];
  let clock = 1_000;
  const timers = [];
  const controller = createVoiceController({
    fetchImpl: async () => { throw new Error("no fetch expected"); },
    ...options,
    now: () => clock,
    setTimer: (fn, ms) => { timers.push({ fn, ms }); return timers.length; },
    clearTimer: () => {},
    onChange: (state) => states.push(state),
    onTranscript: (text, meta) => transcripts.push({ text, ...meta }),
    onNote: (note) => notes.push(note)
  });
  return {
    controller,
    states,
    transcripts,
    notes,
    timers,
    tick: (ms) => { clock += ms; },
    status: () => controller.getState().status
  };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

test("support: speech recognition first (standard or webkit), recording only as the fallback, nothing when neither", () => {
  class Standard {}
  class Webkit {}
  const { win: recordWin } = recordingWindow();
  assert.equal(detectVoiceSupport({ SpeechRecognition: Standard, webkitSpeechRecognition: Webkit }).Recognition, Standard);
  assert.equal(detectVoiceSupport({ webkitSpeechRecognition: Webkit }).Recognition, Webkit);
  assert.deepEqual(detectVoiceSupport(recordWin), { Recognition: null, canRecord: true });
  assert.deepEqual(detectVoiceSupport({ navigator: {} }), { Recognition: null, canRecord: false });
  assert.deepEqual(detectVoiceSupport(undefined), { Recognition: null, canRecord: false });
});

test("speech: idle → listening → interim and final words fill the box → idle, and the words are never sent", async () => {
  const { FakeRecognition, instances } = fakeRecognitionClass();
  const fetch = fakeFetch([]);
  const h = harness({ win: { webkitSpeechRecognition: FakeRecognition }, fetchImpl: fetch.impl });
  assert.deepEqual(h.controller.getState(), { status: "idle", path: "speech", note: "" });

  assert.equal(h.controller.start(), true);
  assert.equal(h.status(), "starting");
  const recognition = instances[0];
  assert.equal(recognition.lang, "en-SG");
  assert.equal(recognition.interimResults, true);
  assert.equal(recognition.continuous, true);
  recognition.emitStart();
  assert.equal(h.status(), "listening");

  recognition.emitResults([["Koufu", false]]);
  recognition.emitResults([["Koufu lunch", true], [" twelve fifty", false]]);
  assert.deepEqual(h.transcripts, [
    { text: "Koufu", final: false },
    { text: "Koufu lunch twelve fifty", final: false }
  ]);

  h.controller.stop();
  assert.equal(recognition.stopped, true);
  recognition.emitResults([["Koufu lunch", true], [" $12.50", true]]);
  recognition.emitEnd();
  assert.equal(h.status(), "idle");
  assert.deepEqual(h.transcripts.at(-1), { text: "Koufu lunch $12.50", final: true });
  assert.deepEqual(h.notes, []);
  assert.equal(fetch.calls.length, 0);
});

test("speech: permission denied ends calmly with the denied note and stays offered", () => {
  const { FakeRecognition, instances } = fakeRecognitionClass();
  const h = harness({ win: { SpeechRecognition: FakeRecognition } });
  h.controller.start();
  instances[0].emitError("not-allowed");
  instances[0].emitEnd();
  assert.deepEqual(h.controller.getState(), { status: "idle", path: "speech", note: "denied" });
  assert.deepEqual(h.notes, ["denied"]);
  assert.deepEqual(h.transcripts, []);
});

test("speech: hearing nothing says so; an unsupported en-SG retries once in en-US", () => {
  const { FakeRecognition, instances } = fakeRecognitionClass();
  const h = harness({ win: { SpeechRecognition: FakeRecognition } });
  h.controller.start();
  instances[0].emitError("no-speech");
  instances[0].emitEnd();
  assert.deepEqual(h.notes, ["noSpeech"]);

  h.controller.start();
  assert.equal(h.controller.getState().note, "");
  instances[1].emitError("language-not-supported");
  instances[1].emitEnd();
  assert.equal(instances.length, 3);
  assert.equal(instances[2].lang, "en-US");
  assert.equal(h.status(), "starting");
  instances[2].emitStart();
  instances[2].emitResults([["Grab ride", true]]);
  instances[2].emitEnd();
  assert.equal(h.status(), "idle");
  assert.deepEqual(h.transcripts.at(-1), { text: "Grab ride", final: true });
  assert.deepEqual(h.notes, ["noSpeech"]);
});

test("speech: a start the browser refuses returns false so the page can retry on the tap", () => {
  const { FakeRecognition } = fakeRecognitionClass({ throwOnStart: Object.assign(new Error("no gesture"), { name: "NotAllowedError" }) });
  const h = harness({ win: { SpeechRecognition: FakeRecognition } });
  assert.equal(h.controller.start(), false);
  assert.equal(h.status(), "idle");
  assert.deepEqual(h.notes, []);
});

test("speech: cancel (send pressed, page left) aborts and ignores late words", () => {
  const { FakeRecognition, instances } = fakeRecognitionClass();
  const h = harness({ win: { SpeechRecognition: FakeRecognition } });
  h.controller.start();
  instances[0].emitStart();
  instances[0].emitResults([["half a", false]]);
  h.controller.cancel();
  assert.equal(instances[0].aborted, true);
  assert.equal(h.status(), "idle");
  instances[0].emitResults([["half a sentence", true]]);
  instances[0].emitEnd();
  assert.deepEqual(h.transcripts, [{ text: "half a", final: false }]);
});

test("speech: a browser that refuses the speech service falls back to recording when it can", async () => {
  const { FakeRecognition, instances } = fakeRecognitionClass();
  const { win, recorders } = recordingWindow();
  const fetch = fakeFetch([jsonResponse(200, { ok: true, available: true, maxSeconds: 30 })]);
  const h = harness({ win: { ...win, webkitSpeechRecognition: FakeRecognition }, fetchImpl: fetch.impl });
  h.controller.start();
  instances[0].emitError("service-not-allowed");
  instances[0].emitEnd();
  await flush();
  assert.equal(h.controller.getState().path, "record");
  assert.equal(h.status(), "listening");
  assert.equal(recorders.length, 1);
  assert.deepEqual(h.notes, []);
});

test("unsupported → fallback: a recorded clip is written down by the transcribe route and fills the box", async () => {
  const { win, recorders, stream } = recordingWindow();
  const fetch = fakeFetch([
    jsonResponse(200, { ok: true, available: true, maxSeconds: 30 }),
    jsonResponse(200, { ok: true, available: true, text: "Koufu lunch twelve fifty", remaining: 9 })
  ]);
  const h = harness({ win, fetchImpl: fetch.impl });
  assert.deepEqual(h.controller.getState(), { status: "idle", path: "record", note: "" });

  h.controller.start();
  assert.equal(h.status(), "starting");
  await flush();
  assert.equal(fetch.calls[0].url, TRANSCRIBE_ENDPOINT);
  assert.equal(fetch.calls[0].init.method ?? "GET", "GET");
  assert.equal(h.status(), "listening");
  assert.equal(recorders[0].mimeType, "audio/mp4");
  assert.equal(recorders[0].options.audioBitsPerSecond, 32_000);
  assert.equal(h.timers[0].ms, VOICE_MAX_RECORD_MS);

  h.tick(4_200);
  h.controller.stop();
  assert.equal(stream.track.stopped, true);
  assert.equal(h.status(), "transcribing");
  await flush();
  await flush();
  const upload = fetch.calls[1];
  assert.equal(upload.url, TRANSCRIBE_ENDPOINT);
  assert.equal(upload.init.method, "POST");
  assert.ok(upload.init.body instanceof FormData);
  assert.equal(upload.init.body.get("durationMs"), "4200");
  assert.equal(upload.init.body.get("audio").type, "audio/mp4");
  assert.equal(h.status(), "idle");
  assert.deepEqual(h.transcripts, [{ text: "Koufu lunch twelve fifty", final: true }]);

  // The availability answer is remembered: the next press records at once.
  h.controller.start();
  await flush();
  assert.equal(fetch.calls.length, 2);
  assert.equal(h.status(), "listening");
});

test("the recording stops itself at 30 seconds", async () => {
  const { win, recorders } = recordingWindow();
  const fetch = fakeFetch([jsonResponse(200, { ok: true, available: true }), jsonResponse(200, { ok: true, available: true, text: "long story" })]);
  const h = harness({ win, fetchImpl: fetch.impl });
  h.controller.start();
  await flush();
  h.tick(VOICE_MAX_RECORD_MS);
  h.timers[0].fn();
  assert.equal(recorders[0].state, "inactive");
  await flush();
  await flush();
  assert.equal(fetch.calls[1].init.body.get("durationMs"), String(VOICE_MAX_RECORD_MS));
});

test("fallback unavailable → hidden: the mic goes, with one calm note, and no microphone is asked for", async () => {
  let asked = 0;
  const { win } = recordingWindow({ getUserMedia: async () => { asked += 1; return fakeStream(); } });
  const fetch = fakeFetch([jsonResponse(200, { ok: true, available: false })]);
  const h = harness({ win, fetchImpl: fetch.impl });
  h.controller.start();
  await flush();
  assert.deepEqual(h.controller.getState(), { status: "hidden", path: "none", note: "unavailable" });
  assert.deepEqual(h.notes, ["unavailable"]);
  assert.equal(asked, 0);
  assert.equal(h.controller.start(), false);
});

test("fallback: a route that turns out to be off after recording also hides the mic", async () => {
  const { win } = recordingWindow();
  const fetch = fakeFetch([jsonResponse(200, { ok: true, available: true }), jsonResponse(200, { ok: true, available: false, code: "off" })]);
  const h = harness({ win, fetchImpl: fetch.impl });
  h.controller.start();
  await flush();
  h.tick(2_000);
  h.controller.stop();
  await flush();
  await flush();
  assert.equal(h.status(), "hidden");
  assert.deepEqual(h.notes, ["unavailable"]);
});

test("fallback: allowance used, too long, a failed upload and microphone denied each end calmly and keep the mic", async () => {
  const cases = [
    { response: jsonResponse(200, { ok: true, available: false, code: "allowance" }), note: "allowance" },
    { response: jsonResponse(413, { ok: false, error: "too long" }), note: "tooLong" },
    { response: jsonResponse(200, { ok: true, available: false, code: "failed" }), note: "failed" },
    { response: new Error("offline"), note: "failed" }
  ];
  for (const item of cases) {
    const { win } = recordingWindow();
    const fetch = fakeFetch([jsonResponse(200, { ok: true, available: true }), item.response]);
    const h = harness({ win, fetchImpl: fetch.impl });
    h.controller.start();
    await flush();
    h.tick(3_000);
    h.controller.stop();
    await flush();
    await flush();
    assert.deepEqual(h.controller.getState(), { status: "idle", path: "record", note: item.note });
    assert.deepEqual(h.transcripts, []);
  }

  const denied = recordingWindow({ getUserMedia: async () => { throw Object.assign(new Error("denied"), { name: "NotAllowedError" }); } });
  const fetch = fakeFetch([jsonResponse(200, { ok: true, available: true })]);
  const h = harness({ win: denied.win, fetchImpl: fetch.impl });
  h.controller.start();
  await flush();
  assert.deepEqual(h.controller.getState(), { status: "idle", path: "record", note: "denied" });
  assert.equal(fetch.calls.length, 1);
});

test("fallback: a press too short to hold words sends nothing", async () => {
  const { win } = recordingWindow();
  const fetch = fakeFetch([jsonResponse(200, { ok: true, available: true })]);
  const h = harness({ win, fetchImpl: fetch.impl });
  h.controller.start();
  await flush();
  h.tick(100);
  h.controller.stop();
  await flush();
  assert.equal(fetch.calls.length, 1);
  assert.deepEqual(h.notes, ["noSpeech"]);
  assert.equal(h.status(), "idle");
});

test("no speech recognition and no recorder: hidden from the start", () => {
  const h = harness({ win: { navigator: {} } });
  assert.deepEqual(h.controller.getState(), { status: "hidden", path: "none", note: "" });
  assert.equal(h.controller.start(), false);
});

test("gesture: hold past the threshold while listening stops on release; a quick tap keeps listening until the next tap", () => {
  let clock = 0;
  const gesture = createPressGesture({ now: () => clock });
  // Hold to talk.
  assert.equal(gesture.down(false), "start");
  clock += VOICE_HOLD_MS + 50;
  assert.equal(gesture.up(true), "stop");
  // Tap to start, tap to stop.
  assert.equal(gesture.down(false), "start");
  clock += 120;
  assert.equal(gesture.up(true), "none");
  clock += 3_000;
  assert.equal(gesture.down(true), "none");
  clock += 80;
  assert.equal(gesture.up(true), "stop");
  // A long press that was still waiting for permission becomes a tap.
  assert.equal(gesture.down(false), "start");
  clock += 2_000;
  assert.equal(gesture.cancel(false), "none");
  assert.equal(gesture.up(false), "none");
  // A hold cancelled by the browser while listening stops.
  assert.equal(gesture.down(false), "start");
  clock += 900;
  assert.equal(gesture.cancel(true), "stop");
});

test("spoken words join what is already typed", () => {
  assert.equal(joinSpokenText("", "Koufu lunch"), "Koufu lunch");
  assert.equal(joinSpokenText("Citi", "Koufu lunch"), "Citi Koufu lunch");
  assert.equal(joinSpokenText("Citi ", " Koufu lunch "), "Citi Koufu lunch");
  assert.equal(joinSpokenText("Citi", ""), "Citi");
});
