document.addEventListener("DOMContentLoaded", () => {
  const page = document.getElementById("english-class");
  const quiz = document.getElementById("english-quiz");
  const quizForm = document.getElementById("english-quiz-form");
  const voice = document.getElementById("english-voice");
  const levelLabel = document.getElementById("english-level");
  const status = document.getElementById("english-status");
  const start = document.getElementById("english-start");
  const stop = document.getElementById("english-stop");
  const retake = document.getElementById("english-retake");
  const feedback = document.getElementById("english-feedback");
  const heard = document.getElementById("english-transcript");
  const micLevel = document.getElementById("english-mic-level");
  const visualStage = document.getElementById("kady-visual");
  const visualLabel = document.getElementById("kady-state-label");
  const visual = window.KadyVisual ? new window.KadyVisual(document.getElementById("kady-canvas")) : null;
  const csrf = document.querySelector('meta[name="csrf-token"]')?.content || "";
  const AudioContext = window.AudioContext || window.webkitAudioContext;
  const wakePattern = /(?:^|[\s¿¡,.;:!?])h?[oó]la[\s,.:;!?¿¡-]*(?:kady|cady|kadi|cadi|katie|catie|katy|caty|kati|cati|caddy|kaddy|cadie|kadie|keidy|keidi|kathy|cathy)\b[\s,.:;!?¿¡]*/i;
  let active = false;
  let conversationOpen = false;
  let replyDeadline = 0;
  let listenAfter = 0;
  let voiceSession = 0;
  let pendingRequest = null;
  let speaking = false;
  let busy = false;
  let capturing = false;
  let finishing = false;
  let stream = null;
  let context = null;
  let analyser = null;
  let levelSamples = null;
  let outputAnalyser = null;
  let outputSamples = null;
  let recorder = null;
  let frame = null;
  let audioPlayer = null;
  let audioUrl = null;
  let finishPlayback = null;
  let recordingChunks = [];
  let recordingStartedAt = 0;
  let noiseFloor = 0.003;
  let voiceFrames = 0;
  let speechStart = 0;
  let lastVoice = 0;

  function setStatus(message) { status.textContent = message; }

  function setVisualState(state) {
    if (visualStage) visualStage.dataset.state = state;
    if (visualLabel) visualLabel.textContent = {
      idle: "Lista para practicar", connecting: "Preparando la escucha",
      listening: "Escucha activa", hearing: "Te estoy escuchando",
      thinking: "Preparando tu respuesta", speaking: "Kady está hablando",
      error: "Volvamos a intentarlo"
    }[state];
    visual?.setState(state);
  }

  function isCurrent(session) { return active && session === voiceSession; }

  function listenForReply() {
    conversationOpen = true;
    replyDeadline = performance.now() + 45000;
    setVisualState("listening");
    setStatus("Te escucho. Puedes hablar en español o inglés.");
  }

  function playWakeCue() {
    if (!context || context.state !== "running") return;
    const tone = context.createOscillator();
    const gain = context.createGain();
    tone.frequency.value = 880;
    gain.gain.value = 0.045;
    tone.connect(gain);
    gain.connect(context.destination);
    tone.start();
    tone.stop(context.currentTime + 0.12);
  }

  function resetCapture() {
    capturing = false;
    finishing = false;
    voiceFrames = 0;
  }

  function stopVoice() {
    active = false;
    voiceSession += 1;
    pendingRequest?.abort();
    pendingRequest = null;
    busy = false;
    start.disabled = false;
    start.hidden = false;
    stop.hidden = true;
    resetCapture();
    if (frame) cancelAnimationFrame(frame);
    frame = null;
    if (recorder && recorder.state !== "inactive") recorder.stop();
    recorder = null;
    recordingChunks = [];
    if (stream) stream.getTracks().forEach((track) => track.stop());
    stream = null;
    if (audioPlayer) {
      audioPlayer.pause();
    }
    finishPlayback?.();
    finishPlayback = null;
    audioPlayer = null;
    if (audioUrl) URL.revokeObjectURL(audioUrl);
    audioUrl = null;
    if ("speechSynthesis" in window) window.speechSynthesis.cancel();
    if (context) context.close();
    context = null;
    analyser = null;
    levelSamples = null;
    outputAnalyser = null;
    outputSamples = null;
    speaking = false;
    conversationOpen = false;
    micLevel.value = 0;
    visual?.setLevel(0);
    setVisualState("idle");
    setStatus("Micrófono desactivado");
  }

  function chooseMimeType() {
    for (const type of ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"]) {
      if (MediaRecorder.isTypeSupported(type)) return type;
    }
    return "";
  }

  function startRecorder() {
    if (!active || !stream) return;
    const mimeType = chooseMimeType();
    const options = {audioBitsPerSecond: 128000};
    if (mimeType) options.mimeType = mimeType;
    const current = new MediaRecorder(stream, options);
    recorder = current;
    recordingChunks = [];
    recordingStartedAt = performance.now();
    current.ondataavailable = (event) => {
      if (active && recorder === current && event.data?.size) recordingChunks.push(event.data);
    };
    current.onstop = () => {
      if (!active || recorder !== current) return;
      const chunks = recordingChunks;
      const mime = current.mimeType || "audio/webm";
      const shouldTranscribe = finishing;
      resetCapture();
      startRecorder();
      if (shouldTranscribe) transcribe(chunks, mime);
    };
    current.onerror = () => {
      if (recorder !== current) return;
      stopVoice();
      setVisualState("error");
      setStatus("Se interrumpió la grabación. Activa la escucha para volver a intentar.");
    };
    current.start(250);
  }

  function rotateRecorder() {
    if (!recorder || recorder.state !== "recording" || capturing || finishing) return Promise.resolve();
    const current = recorder;
    return new Promise((resolve) => {
      current.addEventListener("stop", resolve, {once: true});
      current.stop();
    });
  }

  async function transcribe(chunks, mime) {
    const blob = new Blob(chunks, {type: mime});
    if (!active || blob.size < 1000) return;
    if (blob.size > 2 * 1024 * 1024) {
      setStatus("La frase fue demasiado larga. Di una frase más corta.");
      return;
    }
    busy = true;
    const session = voiceSession;
    const controller = new AbortController();
    pendingRequest = controller;
    setVisualState("thinking");
    let wakeCue = false;
    setStatus("Entendiendo lo que dijiste...");
    try {
      const payload = new FormData();
      payload.append("audio", blob, mime.includes("mp4") ? "utterance.m4a" : "utterance.webm");
      payload.append("modo", conversationOpen ? "conversacion" : "activacion");
      const response = await fetch("/transcribir_ingles", {
        method: "POST", body: payload, credentials: "same-origin",
        headers: {"X-CSRF-Token": csrf}, signal: controller.signal
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "No se pudo transcribir el audio.");
      if (!isCurrent(session)) return;
      const transcript = (data.texto || "").trim();
      if (!transcript) {
        setVisualState("listening");
        setStatus("No escuché una frase clara. Prueba hablar un poco más cerca del micrófono.");
        return;
      }
      heard.textContent = "Escuché: “" + transcript + "”";
      const match = transcript.match(wakePattern);
      if (!conversationOpen && !match) {
        setVisualState("listening");
        setStatus("Di “Hola Kady” para comenzar. Puedes ver abajo lo que escuché.");
        return;
      }
      const rest = (match ? transcript.slice(match.index + match[0].length) : transcript)
        .replace(/^[\s,.:;!?¿¡]+|[\s,.:;!?¿¡]+$/g, "").trim();
      conversationOpen = true;
      if (rest) {
        await sendTurn(rest, session, controller.signal);
      } else {
        listenForReply();
        wakeCue = true;
      }
    } catch (error) {
      if (isCurrent(session)) {
        replyDeadline = performance.now() + 45000;
        setVisualState("error");
        setStatus(error.message + " Puedes repetir tu frase.");
      }
    } finally {
      if (isCurrent(session)) {
        await rotateRecorder();
        if (isCurrent(session)) {
          pendingRequest = null;
          if (conversationOpen) replyDeadline = performance.now() + 45000;
          listenAfter = performance.now() + (wakeCue ? 350 : 150);
          busy = false;
          if (wakeCue) playWakeCue();
        }
      }
    }
  }

  function monitorLevel() {
    if (!active || !analyser) return;
    const samples = levelSamples;
    analyser.getFloatTimeDomainData(samples);
    let power = 0;
    for (let i = 0; i < samples.length; i++) {
      const amplitude = samples[i];
      power += amplitude * amplitude;
    }
    const rms = Math.sqrt(power / samples.length);
    micLevel.value = Math.min(100, Math.round(rms * 1400));
    let outputRms = 0;
    if (speaking && outputAnalyser && outputSamples) {
      outputAnalyser.getFloatTimeDomainData(outputSamples);
      outputRms = Math.sqrt(outputSamples.reduce((sum, sample) => sum + sample * sample, 0) / outputSamples.length);
    }
    visual?.setLevel(speaking ? outputRms * 12 : capturing ? rms * 16 : 0);
    const now = performance.now();
    if (!busy && !speaking && !finishing && now >= listenAfter && recorder?.state === "recording") {
      if (conversationOpen && !capturing && now > replyDeadline) {
        conversationOpen = false;
        setStatus("Escuchando “Hola Kady” para retomar...");
      }
      // A lower threshold during a phrase keeps soft syllables from ending it early.
      const threshold = capturing ? Math.max(0.0035, noiseFloor * 1.35) : Math.max(0.005, noiseFloor * 1.7);
      if (rms > threshold) {
        voiceFrames += 1;
        lastVoice = now;
        if (!capturing && voiceFrames >= 3) {
          capturing = true;
          speechStart = now;
          setVisualState("hearing");
          setStatus(conversationOpen ? "Escuchando tu respuesta..." : "Escuchando la frase de activación...");
        }
      } else {
        voiceFrames = 0;
        if (!capturing) noiseFloor = Math.min(0.02, noiseFloor * 0.97 + rms * 0.03);
      }
      if (capturing && ((now - lastVoice > 1800 && now - speechStart > 250) || now - speechStart > 25000)) {
        finishing = true;
        setVisualState("thinking");
        setStatus("Procesando tu voz...");
        if (recorder?.state === "recording") recorder.stop();
      } else if (!capturing && now - recordingStartedAt > 4000) {
        rotateRecorder();
      }
    }
    frame = requestAnimationFrame(monitorLevel);
  }

  function fallbackSpeech(text, session) {
    if (!("speechSynthesis" in window) || !isCurrent(session)) return Promise.resolve();
    return new Promise((resolve) => {
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = "en-US";
      const voices = window.speechSynthesis.getVoices();
      utterance.voice = voices.find((item) => /female|samantha|zira|victoria|aria|jenny/i.test(item.name)) || null;
      const done = () => { clearTimeout(watchdog); resolve(); };
      const watchdog = setTimeout(() => { window.speechSynthesis.cancel(); done(); }, Math.max(8000, text.length * 130));
      finishPlayback = done;
      utterance.onend = done;
      utterance.onerror = done;
      window.speechSynthesis.speak(utterance);
    });
  }

  function shortSpokenAnswer(data) {
    return data.english + " " + data.feedback_es + " " + data.example_en;
  }

  async function playKady(data, session) {
    if (!isCurrent(session)) return;
    speaking = true;
    setVisualState("speaking");
    let voiceSource = null;
    let playbackAnalyser = null;
    try {
      if (!data.audio_base64) {
        await fallbackSpeech(shortSpokenAnswer(data), session);
        return;
      }
      const bytes = Uint8Array.from(atob(data.audio_base64), (char) => char.charCodeAt(0));
      audioUrl = URL.createObjectURL(new Blob([bytes], {type: "audio/mpeg"}));
      audioPlayer = new Audio(audioUrl);
      // Analyse the same audio that reaches the speakers, so the sculpture follows Kady's voice.
      if (context?.createMediaElementSource) {
        voiceSource = context.createMediaElementSource(audioPlayer);
        playbackAnalyser = context.createAnalyser();
        playbackAnalyser.fftSize = 512;
        voiceSource.connect(playbackAnalyser);
        playbackAnalyser.connect(context.destination);
        outputAnalyser = playbackAnalyser;
        outputSamples = new Float32Array(playbackAnalyser.fftSize);
      }
      await new Promise((resolve, reject) => {
        const done = (error) => {
          clearTimeout(watchdog);
          error ? reject(error) : resolve();
        };
        const watchdog = setTimeout(() => {
          audioPlayer?.pause();
          done(new Error("Se interrumpió la voz de Kady."));
        }, Math.max(15000, shortSpokenAnswer(data).length * 130));
        finishPlayback = () => done();
        audioPlayer.onended = () => done();
        audioPlayer.onerror = () => done(new Error("No se pudo reproducir la voz de Kady."));
        audioPlayer.play().catch(done);
      });
    } catch (_) {
      await fallbackSpeech(shortSpokenAnswer(data), session);
    } finally {
      voiceSource?.disconnect();
      playbackAnalyser?.disconnect();
      if (session === voiceSession) {
        outputAnalyser = null;
        outputSamples = null;
        if (audioUrl) URL.revokeObjectURL(audioUrl);
        audioUrl = null;
        audioPlayer = null;
        finishPlayback = null;
        speaking = false;
      }
    }
  }

  async function sendTurn(transcript, session, signal) {
    setVisualState("thinking");
    setStatus("Kady está preparando tu respuesta...");
    try {
      const payload = new FormData();
      payload.append("mensaje", transcript);
      const response = await fetch("/conversar_ingles", {
        method: "POST", body: payload, credentials: "same-origin",
        headers: {"X-CSRF-Token": csrf}, signal
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "No fue posible hablar con Kady.");
      if (!isCurrent(session)) return;
      document.getElementById("english-heard").textContent = "Dijiste: " + transcript;
      document.getElementById("english-tip").textContent = data.feedback_es;
      document.getElementById("english-example").textContent = data.example_en + " — " + data.example_es;
      feedback.hidden = false;
      setStatus("Kady está hablando. Escucha su respuesta antes de continuar.");
      await playKady(data, session);
      if (isCurrent(session)) listenForReply();
    } catch (error) {
      if (isCurrent(session)) {
        replyDeadline = performance.now() + 45000;
        setVisualState("error");
        setStatus(error.message + " Puedes repetir tu frase sin volver a activarla.");
      }
    }
  }

  const diagnosticSummary = document.getElementById("english-diagnostic-summary");
  const diagnosticDetails = document.getElementById("english-diagnostic-details");
  function showDiagnostic(result, open = false) {
    if (!diagnosticSummary || !result) return;
    window.DiagnosticSummary?.render(diagnosticSummary, result);
    diagnosticDetails.hidden = false;
    diagnosticDetails.open = open;
  }
  if (diagnosticSummary && page.dataset.level) {
    fetch("/api/diagnosticos/ingles", {credentials: "same-origin"})
      .then((response) => response.ok ? response.json() : null)
      .then((data) => showDiagnostic(data?.diagnostico)).catch(() => {});
  }

  quizForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const answers = [1, 2, 3, 4, 5, 6].map((number) =>
      quizForm.querySelector('input[name="q' + number + '"]:checked')?.value
    );
    if (answers.some((answer) => !answer)) return;
    const button = quizForm.querySelector('button[type="submit"]');
    button.disabled = true;
    try {
      const response = await fetch("/evaluar_ingles", {
        method: "POST", credentials: "same-origin",
        headers: {"Content-Type": "application/json", "X-CSRF-Token": csrf},
        body: JSON.stringify({respuestas: answers, version: Number(quizForm.dataset.version)})
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "No se pudo evaluar tu nivel.");
      page.dataset.level = data.nivel;
      page.dataset.view = "voice";
      levelLabel.textContent = data.nivel;
      quiz.hidden = true;
      voice.hidden = false;
      feedback.hidden = true;
      showDiagnostic(data.diagnostico, true);
      voice.scrollIntoView({behavior: "smooth", block: "start"});
      setStatus("Activa la escucha para comenzar.");
    } catch (error) {
      alert(error.message);
    } finally {
      button.disabled = false;
    }
  });

  retake.addEventListener("click", () => {
    stopVoice();
    quizForm.reset();
    quiz.hidden = false;
    voice.hidden = true;
    page.dataset.view = "quiz";
  });

  if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder || !AudioContext) {
    start.disabled = true;
    setVisualState("error");
    setStatus("Este navegador no permite grabar audio. Abre la clase en Chrome o Edge y concede acceso al micrófono.");
    return;
  }
  if (page.dataset.voiceReady !== "true") {
    start.disabled = true;
    setVisualState("error");
    setStatus("Falta configurar la transcripción de voz en el servidor.");
    return;
  }

  start.addEventListener("click", async () => {
    if (active) return;
    const session = ++voiceSession;
    start.disabled = true;
    setVisualState("connecting");
    setStatus("Solicitando permiso para usar el micrófono...");
    try {
      const microphone = await navigator.mediaDevices.getUserMedia({audio: {
        echoCancellation: true, noiseSuppression: true, autoGainControl: true,
        channelCount: 1, sampleRate: {ideal: 48000}
      }});
      if (session !== voiceSession) {
        microphone.getTracks().forEach((track) => track.stop());
        return;
      }
      stream = microphone;
      context = new AudioContext();
      await context.resume();
      if (session !== voiceSession) return;
      const source = context.createMediaStreamSource(stream);
      analyser = context.createAnalyser();
      analyser.fftSize = 2048;
      levelSamples = new Float32Array(analyser.fftSize);
      source.connect(analyser);
      active = true;
      start.hidden = true;
      stop.hidden = false;
      noiseFloor = 0.003;
      listenAfter = performance.now() + 350;
      startRecorder();
      frame = requestAnimationFrame(monitorLevel);
      setVisualState("listening");
      setStatus("Escuchando “Hola Kady”...");
    } catch (_) {
      if (session === voiceSession) {
        stopVoice();
        setVisualState("error");
        setStatus("No se pudo activar el micrófono. Revisa sus permisos y vuelve a intentarlo.");
      }
    } finally {
      if (session === voiceSession) start.disabled = false;
    }
  });
  stop.addEventListener("click", stopVoice);
  window.addEventListener("beforeunload", stopVoice);
  window.addEventListener("beforeunload", () => visual?.destroy());
});
