(() => {
  'use strict';
  const root = document.getElementById('kady-companion');
  if (!root) return;
  const $ = id => document.getElementById(id);
  const bubble = $('kady-bubble'), panel = $('kady-window'), status = $('kady-status'), audio = $('kady-audio');
  const key = `kady:${root.dataset.user}:`;
  const stored = (name, fallback) => { try { return JSON.parse(localStorage.getItem(key + name)) ?? fallback; } catch { return fallback; } };
  const save = (name, value) => { try { localStorage.setItem(key + name, JSON.stringify(value)); } catch {} };
  let micGeneration = 0;
  let context = null, greeting = false, busy = false, recorder = null, stream = null, timer = null, chunks = [];
  let voiceRequest = null, generation = 0, audioUrl = null, dragged = false;
  const voice = $('kady-voice'); voice.checked = stored('voice', true);
  async function api(url, data) {
    const form = data instanceof FormData;
    const response = await fetch(url, {method:data === undefined ? 'GET' : 'POST',
      headers:{'X-CSRF-Token':document.querySelector('meta[name="csrf-token"]').content, ...(!form && data !== undefined ? {'Content-Type':'application/json'} : {})},
      ...(data === undefined ? {} : {body:form ? data : JSON.stringify(data)})});
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw Error(result.error || 'No pude conectar. Intenta de nuevo.');
    return result;
  }
  function open() { panel.hidden = false; clamp(panel); bubble.setAttribute('aria-expanded','true'); }
  function stopVoice() {
    generation++; voiceRequest?.abort(); audio.pause(); audio.removeAttribute('src'); audio.hidden = true;
    if (audioUrl) URL.revokeObjectURL(audioUrl); audioUrl = null; bubble.dataset.speaking = 'false';
  }
  async function speak(text) {
    stopVoice();
    if (!voice.checked || context?.voice_configured === false) return;
    const ticket = generation;
    voiceRequest = new AbortController(); status.textContent = 'Preparando mi voz…';
    try {
      const response = await fetch('/api/kady/voz', {method:'POST', signal:voiceRequest.signal,
        headers:{'Content-Type':'application/json','X-CSRF-Token':document.querySelector('meta[name="csrf-token"]').content},
        body:JSON.stringify({texto:text.slice(0,2400)})});
      const result = await response.json();
      if (!response.ok) throw Error(result.error);
      if (ticket !== generation) return;
      const bytes = Uint8Array.from(atob(result.audio_base64), c => c.charCodeAt(0));
      audioUrl = URL.createObjectURL(new Blob([bytes], {type:'audio/mpeg'})); audio.src = audioUrl;
      audio.hidden = false;
      try { await audio.play(); status.textContent = ''; }
      catch { status.textContent = 'Pulsa reproducir para escucharme. Puedes desactivar mi voz cuando quieras.'; }
    } catch (error) { if (error.name !== 'AbortError' && ticket === generation) status.textContent = error.message || 'La voz no está disponible ahora.'; }
  }
  audio.addEventListener('play', () => { bubble.dataset.speaking = 'true'; });
  audio.addEventListener('pause', () => { bubble.dataset.speaking = 'false'; });
  audio.addEventListener('ended', () => { bubble.dataset.speaking = 'false'; });
  function add(text, who = 'assistant', target) {
    const message = document.createElement('div'); message.className = `kady-message ${who}`; message.textContent = text;
    if (target) { const link = document.createElement('a'); link.href = target; link.textContent = 'Abrir ahora →'; message.append(link); }
    $('kady-messages').append(message); message.scrollIntoView({block:'nearest'});
    if ($('kady-messages').children.length > 40) $('kady-messages').firstChild.remove();
  }
  const classroom = document.getElementById('classroom');
  const subject = classroom?.dataset.subject || (document.getElementById('algebra-app') ? 'algebra' : root.dataset.page.includes('/ingles/') ? 'ingles' : '');
  async function greet() {
    if (greeting || !context) return;
    greeting = true;
    let text = context.mensaje;
    if (subject) {
      const title = subject === 'algebra' ? 'Álgebra' : document.querySelector('h1')?.textContent || 'tu clase';
      text += ` Ya estás en ${title}. Puedes preguntarme, repasar con ejemplos o comenzar una actividad. Aquí aprenderemos sin prisa.`;
    }
    add(text); await api('/api/kady/bienvenida', {}).catch(() => {}); speak(text);
  }
  bubble.addEventListener('click', () => { if (dragged) { dragged = false; return; } if (panel.hidden) { open(); greet(); $('kady-input').focus(); } else close(); });
  function close() { panel.hidden = true; bubble.setAttribute('aria-expanded','false'); stopVoice(); cancelRecording(); bubble.focus(); }
  $('kady-close').addEventListener('click', close);
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && !panel.hidden) close(); });
  voice.addEventListener('change', () => { save('voice', voice.checked); if (!voice.checked) stopVoice(); });
  $('kady-stop').addEventListener('click', stopVoice);
  async function send(text) {
    if (busy || !text.trim()) return;
    busy = true; stopVoice(); add(text, 'user'); status.textContent = 'Te escucho…'; $('kady-send').disabled = true;
    try {
      const result = await api('/api/kady/mensaje', {mensaje:text, materia:subject, tema:document.getElementById('topic-select')?.value});
      add(result.mensaje, 'assistant', result.navegar); $('kady-input').value = ''; status.textContent = '';
      if (result.navegar) {
        // Destination is a closed server allowlist; keep an explicit link if navigation is interrupted.
        stopVoice(); window.location.assign(result.navegar);
      } else speak(result.mensaje);
    } catch (error) { status.textContent = error.message; }
    finally { busy = false; $('kady-send').disabled = false; }
  }
  $('kady-form').addEventListener('submit', e => { e.preventDefault(); send($('kady-input').value); });
  $('kady-input').addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(e.target.value); } });
  root.querySelectorAll('[data-kady-prompt]').forEach(button => button.addEventListener('click', () => send(button.dataset.kadyPrompt)));
  function cancelRecording() {
    micGeneration++;
    clearTimeout(timer);
    if (recorder?.state === 'recording') { recorder.onstop = null; recorder.stop(); }
    stream?.getTracks().forEach(track => track.stop()); stream = null; recorder = null;
    $('kady-mic').textContent = 'Micrófono'; $('kady-mic').setAttribute('aria-pressed','false');
  }
  $('kady-mic').addEventListener('click', async () => {
    if (recorder?.state === 'recording') { recorder.stop(); return; }
    if (busy) return;
    if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) { status.textContent = 'Este navegador no permite grabar aquí. Puedes escribir tu mensaje.'; return; }
    stopVoice();
    const micTicket = ++micGeneration;
    try {
      stream = await navigator.mediaDevices.getUserMedia({audio:true});
      if (panel.hidden || micTicket !== micGeneration) { cancelRecording(); return; }
      chunks = []; recorder = new MediaRecorder(stream);
      recorder.ondataavailable = e => { if (e.data.size) chunks.push(e.data); };
      recorder.onstop = async () => {
        clearTimeout(timer); const type = recorder.mimeType.split(';')[0]; const blob = new Blob(chunks, {type});
        stream.getTracks().forEach(track => track.stop()); stream = null; recorder = null;
        $('kady-mic').textContent = 'Micrófono'; $('kady-mic').setAttribute('aria-pressed','false');
        if (!blob.size) return;
        busy = true; status.textContent = 'Escuchando tu grabación…';
        try {
          const data = new FormData(); data.append('audio',blob,'voice');
          const result = await api('/api/kady/transcribir',data);
          if (micTicket !== micGeneration) return;
          $('kady-input').value = result.texto;
          busy = false;
          if (result.texto.trim()) await send(result.texto); else status.textContent = 'No escuché una frase. Intenta de nuevo.';
        } catch (error) { status.textContent = error.message; }
        finally { busy = false; }
      };
      recorder.start(); $('kady-mic').textContent = 'Terminar grabación'; $('kady-mic').setAttribute('aria-pressed','true');
      status.textContent = 'Te escucho. Pulsa terminar cuando acabes (máximo 30 segundos).';
      timer = setTimeout(() => { if (recorder?.state === 'recording') recorder.stop(); },30000);
    } catch { cancelRecording(); status.textContent = 'No se pudo acceder al micrófono. Revisa el permiso o escribe tu mensaje.'; }
  });
  function position(node, left, top) {
    const rect = node.getBoundingClientRect();
    node.style.left = `${Math.max(8,Math.min(innerWidth - rect.width - 8,left))}px`;
    node.style.top = `${Math.max(8,Math.min(innerHeight - rect.height - 8,top))}px`;
    node.style.right = 'auto'; node.style.bottom = 'auto';
  }
  function clamp(node) { if (!node.hidden) { const rect = node.getBoundingClientRect(); position(node,rect.left,rect.top); } }
  function movable(node, handle, name) {
    const saved = stored(name,null); if (saved) { node.style.left = `${saved[0]}px`; node.style.top = `${saved[1]}px`; node.style.right = 'auto'; node.style.bottom = 'auto'; }
    let start = null;
    handle.addEventListener('pointerdown', e => {
      if (e.button !== 0 || (e.target.closest('button') && e.target.closest('button') !== handle)) return;
      const rect = node.getBoundingClientRect(); start = [e.clientX,e.clientY,rect.left,rect.top]; dragged = false; handle.setPointerCapture(e.pointerId);
    });
    handle.addEventListener('pointermove', e => { if (!start) return; const dx=e.clientX-start[0],dy=e.clientY-start[1]; if (Math.abs(dx)+Math.abs(dy)>5) { dragged=true; position(node,start[2]+dx,start[3]+dy); } });
    handle.addEventListener('pointerup', () => { if (!start) return; const rect=node.getBoundingClientRect(); save(name,[rect.left,rect.top]); start=null; });
    handle.addEventListener('pointercancel', () => { start=null; });
    handle.addEventListener('keydown', e => { const directions={ArrowLeft:[-20,0],ArrowRight:[20,0],ArrowUp:[0,-20],ArrowDown:[0,20]}; if (!directions[e.key] || e.target !== handle) return; e.preventDefault(); const rect=node.getBoundingClientRect(),[x,y]=directions[e.key]; position(node,rect.left+x,rect.top+y); save(name,[node.offsetLeft,node.offsetTop]); });
  }
  movable(bubble,bubble,'bubble'); movable(panel,$('kady-drag'),'window'); clamp(bubble);
  window.addEventListener('resize', () => { clamp(bubble); clamp(panel); });
  window.addEventListener('pagehide', () => { cancelRecording(); stopVoice(); });
  let pendingAnnouncement = null;
  window.Kady = { ask(text) { open(); send(text); }, announce(text) { open(); add(text); if (context) speak(text); else pendingAnnouncement = text; } };
  document.addEventListener('diagnostic:review', e => { open(); send(e.detail.prompt); });
  api('/api/kady/contexto').then(data => {
    context=data;
    if (!data.voice_configured) { voice.checked=false; status.textContent='La voz estará disponible cuando se configure ElevenLabs.'; }
    const classKey = key + 'class:' + subject;
    let classSeen = true; try { classSeen=!!sessionStorage.getItem(classKey); sessionStorage.setItem(classKey,'1'); } catch {}
    if (pendingAnnouncement) { speak(pendingAnnouncement); greeting=true; api('/api/kady/bienvenida',{}).catch(()=>{}); }
    else if (data.first_visit || data.checkin || (subject && !classSeen)) { open(); greet(); }
  }).catch(error => { status.textContent=error.message; });
})();
