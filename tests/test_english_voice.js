const assert = require("node:assert/strict");
const {test} = require("node:test");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");

const source = fs.readFileSync(path.join(__dirname, "../static/js/english.js"), "utf8");
const flush = () => new Promise((resolve) => setImmediate(resolve));

// Exercise the page through its microphone and buttons, with deterministic audio/time.
async function classroom(transcripts, answerStatus = 200, options = {}) {
  const elements = new Map();
  for (const id of ["english-class", "english-quiz", "english-quiz-form", "english-voice",
    "english-level", "english-status", "english-start", "english-stop", "english-retake",
    "english-feedback", "english-mic-level", "english-transcript", "english-heard",
    "english-tip", "english-example", "kady-visual", "kady-state-label"]) {
    elements.set(id, {textContent: "", dataset: {voiceReady: "true"}, hidden: false,
      listeners: {}, reset() {}, addEventListener(event, handler) { this.listeners[event] = handler; }});
  }
  let now = 0;
  let frame;
  let loudness = 0;
  let currentRecorder;
  let onReady;
  let cueCount = 0;
  const requests = [];
  const answer = {english: "What would you like?", feedback_es: "Puedes usar please.",
    example_en: "A coffee, please.", example_es: "Un café, por favor.", audio_base64: "SUQz"};
  class FakeRecorder {
    static isTypeSupported() { return true; }
    constructor(_, options) {
      this.mimeType = options.mimeType;
      this.state = "inactive";
      this.listeners = [];
      currentRecorder = this;
    }
    start() { this.state = "recording"; }
    addEventListener(_, handler) { this.listeners.push(handler); }
    stop() {
      this.state = "inactive";
      queueMicrotask(() => {
        this.ondataavailable({data: new Blob([new Uint8Array(1800)])});
        this.onstop();
        this.listeners.forEach((handler) => handler());
      });
    }
  }
  class FakeContext {
    state = "running";
    currentTime = 0;
    async resume() {}
    close() {}
    createMediaStreamSource() { return {connect() {}}; }
    createAnalyser() { return {fftSize: 2048, getFloatTimeDomainData(buffer) { buffer.fill(loudness); }}; }
    createOscillator() { return {frequency: {}, connect() {}, start() { cueCount++; }, stop() {}}; }
    createGain() { return {gain: {}, connect() {}}; }
  }
  class FakeAudio {
    async play() {
      if (options.onPlay) options.onPlay(this);
      else queueMicrotask(() => this.onended());
    }
    pause() {}
  }
  const sandbox = {
    document: {getElementById: (id) => elements.get(id), querySelector: () => ({content: "csrf"}),
      addEventListener(_, handler) { onReady = handler; }},
    window: {AudioContext: FakeContext, MediaRecorder: FakeRecorder, addEventListener() {}},
    navigator: {mediaDevices: {getUserMedia: options.getUserMedia || (async () => ({getTracks: () => [{stop() {}}]}))}},
    MediaRecorder: FakeRecorder, Audio: FakeAudio, Blob, FormData, AbortController,
    Uint8Array, Float32Array, URL, atob, setTimeout, clearTimeout, queueMicrotask,
    performance: {now: () => now},
    requestAnimationFrame(handler) { frame = handler; return 1; },
    cancelAnimationFrame() { frame = null; },
    async fetch(url, options) {
      requests.push({url, mode: options.body.get("modo"), text: options.body.get("mensaje")});
      if (url === "/transcribir_ingles") {
        const next = transcripts.shift();
        const data = typeof next === "function" ? await next(options.signal) : {texto: next};
        return {ok: true, json: async () => data};
      }
      return {ok: answerStatus === 200, json: async () => answerStatus === 200 ? answer : {error: "Inténtalo otra vez."}};
    },
  };
  vm.runInNewContext(source, sandbox);
  onReady();
  const click = async (id) => elements.get(id).listeners.click();
  if (options.autoStart !== false) await click("english-start");
  async function tick(duration, amplitude = 0) {
    now += duration;
    loudness = amplitude;
    frame?.();
    await flush();
  }
  async function phrase() {
    await tick(400, 0.02);
    await tick(30, 0.02);
    await tick(30, 0.02);
    await tick(600, 0.02);
    await tick(1900);
    await flush();
    await flush();
  }
  return {elements, requests, phrase, tick, click,
    recorder: () => currentRecorder, cues: () => cueCount};
}

test("Hola Kady tolerates spelling variations and keeps the next turn open", async () => {
  for (const activation of ["Hola Kady", "¡Ola, Cadi!", "Hola Katie", "Holakady"]) {
    const page = await classroom([activation, "Quiero pedir un café", "I would like a coffee, please"]);
    await page.phrase();
    assert.equal(page.cues(), 1, activation);
    assert.equal(page.requests.filter((r) => r.url === "/conversar_ingles").length, 0);
    await page.phrase();
    await page.phrase();
    assert.deepEqual(page.requests.filter((r) => r.url === "/conversar_ingles").map((r) => r.text),
      ["Quiero pedir un café", "I would like a coffee, please"]);
    assert.deepEqual(page.requests.filter((r) => r.url === "/transcribir_ingles").map((r) => r.mode),
      ["activacion", "conversacion", "conversacion"]);
    await page.click("english-stop");
  }
});

test("wake and bilingual phrase in one clip; an unrelated greeting stays idle", async () => {
  const page = await classroom(["Hola Carlos", "Hola Kady, I want to practicar inglés"]);
  await page.phrase();
  assert.equal(page.requests.filter((r) => r.url === "/conversar_ingles").length, 0);
  assert.match(page.elements.get("english-transcript").textContent, /Hola Carlos/);
  await page.phrase();
  assert.equal(page.requests.find((r) => r.url === "/conversar_ingles").text, "I want to practicar inglés");
  await page.click("english-stop");
});

test("short pauses and soft syllables stay in the same recording", async () => {
  const page = await classroom(["Hola Kady, yes"]);
  await page.tick(400, 0.02);
  await page.tick(30, 0.02);
  await page.tick(30, 0.02);
  await page.tick(1500);
  assert.equal(page.requests.length, 0);
  await page.tick(10, 0.0045);
  await page.tick(1500);
  assert.equal(page.requests.length, 0);
  await page.tick(400);
  await flush();
  assert.equal(page.requests.find((r) => r.url === "/conversar_ingles").text, "yes");
  await page.click("english-stop");
});

test("after silence, new speech needs Hola Kady again", async () => {
  const page = await classroom(["Hola Kady", "This should not be sent"]);
  await page.phrase();
  await page.tick(46000);
  await page.phrase();
  assert.equal(page.requests.filter((r) => r.url === "/conversar_ingles").length, 0);
  assert.equal(page.requests.at(-1).mode, "activacion");
  await page.click("english-stop");
});

test("failed replies show the heard phrase and allow a direct retry", async () => {
  const page = await classroom(["Hola Kady, I like music", "I like jazz"], 502);
  await page.phrase();
  assert.match(page.elements.get("english-transcript").textContent, /I like music/);
  assert.match(page.elements.get("english-status").textContent, /Puedes repetir/);
  await page.phrase();
  assert.equal(page.requests.at(-1).text, "I like jazz");
  await page.click("english-stop");
});

test("stopping cancels a pending transcription and leaves the new session idle", async () => {
  let deliver;
  let signal;
  const page = await classroom([(requestSignal) => {
    signal = requestSignal;
    return new Promise((resolve) => { deliver = resolve; });
  }, "I like music"]);
  await page.phrase();
  await page.click("english-stop");
  assert.equal(signal.aborted, true);
  await page.click("english-start");
  deliver({texto: "Hola Kady, old recording"});
  await flush();
  await flush();
  await page.phrase();
  assert.equal(page.requests.filter((r) => r.url === "/conversar_ingles").length, 0);
  assert.equal(page.requests.at(-1).mode, "activacion");
  await page.click("english-stop");
});

test("retaking the quiz while microphone permission is pending cancels activation", async () => {
  let grantMicrophone;
  let microphoneStopped = false;
  const page = await classroom([], 200, {autoStart: false,
    getUserMedia: () => new Promise(resolve => { grantMicrophone = resolve; })});
  const activation = page.click("english-start");
  await page.click("english-retake");
  grantMicrophone({getTracks: () => [{stop() { microphoneStopped = true; }}]});
  await activation;
  assert.equal(microphoneStopped, true);
  assert.equal(page.recorder(), undefined);
  assert.equal(page.elements.get("english-status").textContent, "Micrófono desactivado");
});

test("the visual follows hearing, spoken playback, listening and stop", async () => {
  let playback;
  const page = await classroom(["Hola Kady, hello"], 200, {onPlay: player => { playback = player; }});
  const state = () => page.elements.get("kady-visual").dataset.state;
  assert.equal(state(), "listening");
  await page.tick(400, 0.02);
  await page.tick(30, 0.02);
  await page.tick(30, 0.02);
  assert.equal(state(), "hearing");
  await page.tick(600, 0.02);
  await page.tick(1900);
  await flush();
  assert.equal(state(), "speaking");
  playback.onended();
  await flush();
  await flush();
  assert.equal(state(), "listening");
  await page.click("english-stop");
  assert.equal(state(), "idle");
});
