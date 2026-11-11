(() => {
  'use strict';
  const root=document.getElementById('kady-companion');
  if(!root)return;
  const $=id=>document.getElementById(id), bubble=$('kady-bubble'),panel=$('kady-window'),status=$('kady-status'),audio=$('kady-audio');
  const agent=root.dataset.agent || 'inicio', key=`kady:${root.dataset.user}:${agent}:`, sharedKey=`kady:${root.dataset.user}:`;
  const stored=(name,fallback)=>{try{return JSON.parse(localStorage.getItem(key+name)) ?? fallback;}catch{return fallback;}};
  const save=(name,value)=>{try{localStorage.setItem(key+name,JSON.stringify(value));}catch{}};
  let context=null,busy=false,voiceRequest=null,generation=0,audioUrl=null,dragged=false,listener=null,onboardingTimer=null,onboardingEnd=null;
  let pendingAnnouncement=null;
  const voice=$('kady-voice');
  try{voice.checked=JSON.parse(localStorage.getItem(sharedKey+'voice')) ?? true;}catch{voice.checked=true;}
  async function api(url,data,signal) {
    const form=data instanceof FormData;
    const response=await fetch(url,{method:data===undefined?'GET':'POST',signal,
      headers:{'X-CSRF-Token':document.querySelector('meta[name="csrf-token"]').content,...(!form&&data!==undefined?{'Content-Type':'application/json'}:{})},
      ...(data===undefined?{}:{body:form?data:JSON.stringify(data)})});
    const result=await response.json().catch(()=>({}));
    if(!response.ok)throw Error(result.error || 'No pude conectar. Intenta de nuevo.');
    return result;
  }
  function open(){panel.hidden=false;clamp(panel);bubble.setAttribute('aria-expanded','true');}
  function stopVoice(){generation++;voiceRequest?.abort();audio.pause();audio.removeAttribute('src');audio.hidden=true;if(audioUrl)URL.revokeObjectURL(audioUrl);audioUrl=null;bubble.dataset.speaking='false';}
  function cancelOnboarding(){clearTimeout(onboardingTimer);if(onboardingEnd)audio.removeEventListener('ended',onboardingEnd);onboardingEnd=null;}
  async function speak(text) {
    stopVoice();
    if(!text || !voice.checked || context?.voice_configured===false)return false;
    const ticket=generation;voiceRequest=new AbortController();status.textContent='Preparando mi voz…';
    try {
      const result=await api('/api/kady/voz',{texto:text.slice(0,2400)},voiceRequest.signal);
      if(ticket!==generation)return false;
      const bytes=Uint8Array.from(atob(result.audio_base64),c=>c.charCodeAt(0));audioUrl=URL.createObjectURL(new Blob([bytes],{type:'audio/mpeg'}));audio.src=audioUrl;audio.hidden=false;
      try{await audio.play();status.textContent='';return true;}catch{status.textContent='Pulsa reproducir para escucharme.';return false;}
    }catch(error){if(error.name!=='AbortError'&&ticket===generation)status.textContent=error.message || 'La voz no está disponible ahora.';return false;}
  }
  audio.addEventListener('play',()=>{bubble.dataset.speaking='true';});
  for(const event of ['pause','ended'])audio.addEventListener(event,()=>{bubble.dataset.speaking='false';});
  const shown=new Set();
  function add(text,who='assistant',link,id) {
    if(!text || (id&&shown.has(id)))return;
    if(id)shown.add(id);
    const message=document.createElement('div');message.className=`kady-message ${who}`;message.textContent=text;
    if(link && /^\/(?!\/)/.test(link.url)){const a=document.createElement('a');a.href=link.url;a.textContent=link.texto || 'Abrir →';message.append(a);}
    $('kady-messages').append(message);
    if($('kady-messages').children.length>40)$('kady-messages').firstChild.remove();
    $('kady-messages').scrollTop=$('kady-messages').scrollHeight;clamp(panel);
  }
  function close(){cancelOnboarding();panel.hidden=true;bubble.setAttribute('aria-expanded','false');stopVoice();listener?.cancel();bubble.focus();}
  bubble.addEventListener('click',()=>{if(dragged){dragged=false;return;}if(panel.hidden){open();$('kady-input').focus();}else close();});
  $('kady-close').addEventListener('click',close);
  document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!panel.hidden)close();});
  voice.addEventListener('change',()=>{try{localStorage.setItem(sharedKey+'voice',JSON.stringify(voice.checked));}catch{}if(!voice.checked)stopVoice();});
  $('kady-stop').addEventListener('click',stopVoice);
  async function send(text) {
    if(busy||!text.trim())return;
    cancelOnboarding();listener?.cancel();busy=true;stopVoice();add(text,'user');status.textContent='Estoy pensando…';$('kady-send').disabled=true;$('kady-mic').disabled=true;
    const voiceTicket=generation;
    try {
      const result=await api('/api/kady/mensaje',{mensaje:text,agente:agent,tema:document.getElementById('topic-select')?.value});
      add(result.mensaje,'assistant',result.enlace || (result.navegar?{url:result.navegar,texto:'Abrir ahora →'}:null));
      $('kady-input').value='';status.textContent='';
      if(result.navegar && /^\/(?!\/)/.test(result.navegar)){stopVoice();window.location.assign(result.navegar);}else if(voiceTicket===generation&&!panel.hidden)await speak(result.mensaje);
    }catch(error){status.textContent=error.message;}finally{busy=false;$('kady-send').disabled=false;$('kady-mic').disabled=false;}
  }
  $('kady-form').addEventListener('submit',e=>{e.preventDefault();send($('kady-input').value);});
  $('kady-input').addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();send(e.target.value);}});
  root.querySelectorAll('[data-kady-prompt]').forEach(button=>button.addEventListener('click',()=>send(button.dataset.kadyPrompt)));
  function micState(state) {
    const recording=state==='recording';$('kady-mic').dataset.state=state;
    $('kady-mic').setAttribute('aria-pressed',String(recording));
    $('kady-mic-label').textContent=recording?'Terminar':state==='processing'?'Entendiendo…':state==='permission'?'Activando…':'Hablar';
    $('kady-listening').hidden=!recording;
    $('kady-send').disabled=state==='permission'||state==='processing'||busy;
    $('kady-mic').disabled=state==='processing'||busy;
    if(recording)status.textContent='Te escucho. Habla con calma; terminaré después de una pausa.';
    if(state==='permission')status.textContent='Activando el micrófono…';
    if(state==='processing')status.textContent='Entendiendo tu mensaje…';
  }
  if(window.KadyListener)listener=new window.KadyListener({
    onState:micState,
    onLevel:(level,seconds)=>{$('kady-mic-level').value=level;$('kady-mic-time').textContent=`${Math.floor(seconds/60)}:${String(seconds%60).padStart(2,'0')}`;},
    onError:text=>{status.textContent=text;},
    transcribe:async(blob,signal)=>{const data=new FormData();data.append('audio',blob,'voice');data.append('agente',agent);return (await api('/api/kady/transcribir',data,signal)).texto || '';},
    onTranscript:text=>{$('kady-input').value=text;$('kady-heard').textContent='Entendí: '+text;$('kady-heard').hidden=false;send(text);}
  });
  $('kady-mic').addEventListener('click',()=>{
    cancelOnboarding();
    if(!listener){status.textContent='El micrófono no pudo cargarse. Puedes escribir tu mensaje.';return;}
    if(listener.state==='recording'){listener.stop();return;}
    if(listener.state==='permission'){listener.cancel();return;}
    if(busy)return;
    stopVoice();document.getElementById('english-stop')?.click();listener.start();
  });
  document.getElementById('english-start')?.addEventListener('click',()=>{listener?.cancel();stopVoice();});
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
  window.addEventListener('pagehide', () => { listener?.cancel(); stopVoice(); });
  function hash(text){let value=2166136261;for(const char of text){value^=char.charCodeAt(0);value=Math.imul(value,16777619);}return (value>>>0).toString(36);}
  window.Kady={ask(text){open();send(text);},announce(text){
    const notice=hash(text),seen=stored('announcements',[]);
    if(seen.includes(notice))return;
    save('announcements',[...seen,notice].slice(-100));open();add(text);
    if(context)speak(text);else pendingAnnouncement=text;
  }};
  document.addEventListener('diagnostic:review',e=>{open();send(e.detail.prompt);});
  $('kady-send').disabled=true;$('kady-mic').disabled=true;
  const query=new URLSearchParams({agente:agent,pagina:root.dataset.page});
  api('/api/kady/contexto?'+query).then(async data=>{
    context=data;$('kady-title').textContent=data.agente?.nombre || $('kady-title').textContent;
    if(!data.voice_configured){voice.checked=false;status.textContent='La voz estará disponible cuando se configure ElevenLabs.';}
    for(const item of data.history || [])add(item.content,item.role,null,'history:'+item.id);
    if(data.notice && data.mensaje){
      const claim=await api('/api/kady/bienvenida',{agente:agent,notice:data.notice});
      if(claim.fresh!==false){
        open();add(data.mensaje,'assistant',data.redirect?{url:data.redirect,texto:'Comenzar mi test →'}:null,'notice:'+data.notice);
        if(data.redirect)$('kady-onboarding').hidden=false;
        const played=await speak(data.mensaje);
        if(data.redirect && !panel.hidden){
          const navigate=()=>window.location.assign(data.redirect);
          if(played){onboardingEnd=()=>{cancelOnboarding();onboardingTimer=setTimeout(navigate,1000);};audio.addEventListener('ended',onboardingEnd,{once:true});onboardingTimer=setTimeout(navigate,25000);}
          else onboardingTimer=setTimeout(navigate,6500);
        }
      }
    }
    if(pendingAnnouncement){await speak(pendingAnnouncement);pendingAnnouncement=null;}
  }).catch(error=>{status.textContent=error.message;}).finally(()=>{$('kady-send').disabled=false;$('kady-mic').disabled=false;});
})();
