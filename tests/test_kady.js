const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const flush=()=>new Promise(resolve=>setImmediate(resolve));
async function setup(options={}) {
 const elements=new Map(),requests=[],windowListeners={},cache=options.cache || new Map();
 let stopped=0,permissionCalls=0,micNode,transcriptionResolve,permissionResolve,replyResolve,voiceResolve,constraints;
 const documentListeners={};
 const timers=new Map();let timerId=0;
 const el=id=>{
  if(!elements.has(id))elements.set(id,{id,dataset:{},style:{},hidden:false,value:'',children:[],events:{},listeners:{},attributes:{},
   addEventListener(event,fn){(this.events[event]??=[]).push(fn);this.listeners[event]=e=>this.events[event].forEach(f=>f(e));},
   removeEventListener(event,fn){this.events[event]=(this.events[event]||[]).filter(f=>f!==fn);},
   setAttribute(k,v){this.attributes[k]=v;},removeAttribute(k){delete this.attributes[k];},
   append(...items){this.children.push(...items);},querySelectorAll(){return [];},focus(){},scrollIntoView(){},setPointerCapture(){},
   getBoundingClientRect(){return {left:parseFloat(this.style.left)||900,top:parseFloat(this.style.top)||500,width:this.id==='kady-window'?390:130,height:this.id==='kady-window'?460:64};},
   paused:true,pause(){const playing=!this.paused;this.paused=true;if(playing)this.listeners.pause?.();},async play(){if(options.blockAudio)throw Error('blocked');this.paused=false;this.listeners.play?.();},closest(){return this;}});
  return elements.get(id);
 };
 el('kady-companion').dataset={user:'41',page:'/prin',agent:options.agent || 'inicio'};el('kady-window').hidden=true;
 class CaptureNode {
  constructor(){micNode=this;this.port={close(){}};}connect(){}disconnect(){}
 }
 class Context {
  constructor(){this.state='running';this.destination={};this.audioWorklet={addModule:async()=>{if(options.workletFails)throw Error('load failed');}};}
  async resume(){}async close(){this.state='closed';}createMediaStreamSource(){return {connect(){},disconnect(){}};}
 }
 const sandbox={innerWidth:1400,innerHeight:1000,Blob,Uint8Array,Float32Array,ArrayBuffer,DataView,FormData,URLSearchParams,AbortController,atob,URL,
setTimeout(fn,ms){const id=++timerId;timers.set(id,{fn,ms});return id;},clearTimeout(id){timers.delete(id);},

  localStorage:{getItem:k=>cache.get(k),setItem:(k,v)=>cache.set(k,v)},
  navigator:{mediaDevices:{getUserMedia:async input=>{constraints=input;permissionCalls++;const value={getTracks:()=>[{stop(){stopped++;}}]};return options.pendingPermission?new Promise(resolve=>{permissionResolve=()=>resolve(value);}):value;}}},
  document:{getElementById:id=>['classroom','algebra-app','english-start','english-stop'].includes(id)?null:el(id),querySelector:()=>({content:'csrf'}),createElement:tag=>el('new-'+tag+'-'+Math.random()),addEventListener:(event,fn)=>{documentListeners[event]=fn;}},
  window:{AudioContext:Context,AudioWorkletNode:CaptureNode,addEventListener:(e,f)=>{windowListeners[e]=f;},location:{assign:url=>{sandbox.destination=url;}}},
  fetch:async(url,init={})=>{
   requests.push({url,init});let data,ok=true;
   if(url.startsWith('/api/kady/contexto'))data={voice_configured:true,notice:options.noNotice?null:'intro-v2',mensaje:'Hola, ¿cómo estás?',agente:{nombre:'Kady '+(options.agent || 'Inicio')},history:options.history || [],...(options.onboarding?{notice:'platform-welcome-v2',redirect:'/encuesta'}:{})};
   else if(url==='/api/kady/bienvenida')data={fresh:options.alreadyClaimed!==true};
   else if(url==='/api/kady/voz'){if(options.voiceFails){ok=false;data={error:'Voz no disponible'};}else data=options.pendingVoice?await new Promise(resolve=>{voiceResolve=resolve;}):{audio_base64:'SUQz'};}
   else if(url==='/api/kady/transcribir')data=options.pendingTranscript?await new Promise(resolve=>{transcriptionResolve=resolve;}):{texto:options.transcript || 'Explícame este paso.'};
   else if(url==='/api/kady/mensaje'){data=options.pendingReply?await new Promise(resolve=>{replyResolve=resolve;}):options.reply || {mensaje:'Vamos a Inicio.',navegar:'/prin'};ok=options.replyOk!==false;}
   else data={ok:true};return {ok,json:async()=>data};
  }};
 vm.runInNewContext(fs.readFileSync('static/js/kady-listener.js','utf8'),sandbox);
 vm.runInNewContext(fs.readFileSync('static/js/kady.js','utf8'),sandbox);await flush();await flush();
 async function tick(ms,level=0){for(let n=0;n<ms;n+=20){const block=new Float32Array(320);for(let i=0;i<320;i++)block[i]=i%2?level:-level;micNode?.port.onmessage?.({data:block});}await flush();await flush();}
 return {el,requests,sandbox,windowListeners,documentListeners,cache,timers,tick,
  click:async id=>{await el(id).listeners.click();await flush();await flush();},
  endAudio:async()=>{el('kady-audio').paused=true;el('kady-audio').listeners.ended?.();await flush();},
  stopCount:()=>stopped,permissionCalls:()=>permissionCalls,constraints:()=>constraints,
  resolveTranscript:()=>transcriptionResolve({texto:'Llévame a inicio'}),resolvePermission:()=>permissionResolve(),resolveReply:()=>replyResolve({mensaje:'Practicamos con otro ejemplo.'}),resolveVoice:()=>voiceResolve({audio_base64:'SUQz'})};
}

test('welcome handles blocked playback and text navigation keeps agent identity',async()=>{
 const {el,sandbox,requests}=await setup({blockAudio:true,agent:'algebra'});
 assert.equal(el('kady-window').hidden,false);assert.match(el('kady-status').textContent,/reproducir/);
 el('kady-input').value='Llévame a inicio';el('kady-form').listeners.submit({preventDefault(){}});await flush();
 assert.equal(sandbox.destination,'/prin');const call=requests.find(r=>r.url==='/api/kady/mensaje');assert.equal(JSON.parse(call.init.body).agente,'algebra');
});
test('restored history and an already claimed greeting are never spoken again',async()=>{
 const {el,requests}=await setup({alreadyClaimed:true,history:[{id:1,role:'assistant',content:'Explicación anterior'}]});
 assert.equal(requests.filter(r=>r.url==='/api/kady/voz').length,0);assert.equal(el('kady-messages').children.length,1);assert.equal(el('kady-window').hidden,true);
});
test('automatic announcements are deduplicated independently for each agent',async()=>{
 const cache=new Map();const first=await setup({agent:'algebra',cache,noNotice:true});
 first.sandbox.window.Kady.announce('¡Excelente trabajo!');await flush();first.sandbox.window.Kady.announce('¡Excelente trabajo!');await flush();
 assert.equal(first.requests.filter(r=>r.url==='/api/kady/voz').length,1);
 const second=await setup({agent:'liderazgo',cache,noNotice:true});second.sandbox.window.Kady.announce('¡Excelente trabajo!');await flush();
 assert.equal(second.requests.filter(r=>r.url==='/api/kady/voz').length,1);
});
test('first welcome offers the survey and redirects after spoken playback ends',async()=>{
 const {el,sandbox,timers}=await setup({onboarding:true});assert.equal(el('kady-onboarding').hidden,false);
 el('kady-audio').listeners.ended();const next=[...timers.values()].find(t=>t.ms===1000);assert.ok(next);next.fn();assert.equal(sandbox.destination,'/encuesta');
});
test('bubble and window support independent keyboard movement and resize',async()=>{
 const {el,windowListeners}=await setup();const event=(target,key)=>({target,key,preventDefault(){}});
 el('kady-bubble').listeners.keydown(event(el('kady-bubble'),'ArrowLeft'));assert.equal(el('kady-bubble').style.left,'880px');
 el('kady-drag').listeners.keydown(event(el('kady-drag'),'ArrowUp'));assert.equal(el('kady-window').style.top,'480px');windowListeners.resize();
});
test('one click supports successive voice turns without reopening the microphone',async()=>{
 const s=await setup({reply:{mensaje:'Podemos practicar.'}});await s.click('kady-mic');
 assert.equal(s.el('kady-mic-label').textContent,'Finalizar');assert.equal(s.constraints().audio.echoCancellation,true);assert.equal(s.constraints().audio.noiseSuppression,true);
 await s.tick(400,.03);await s.tick(1000);assert.equal(s.requests.filter(r=>r.url==='/api/kady/transcribir').length,0);
 await s.tick(600);assert.equal(s.requests.filter(r=>r.url==='/api/kady/mensaje').length,1);assert.equal(s.el('kady-mic').dataset.state,'speaking');
 await s.endAudio();assert.equal(s.el('kady-mic').dataset.state,'listening');await s.tick(260);await s.tick(500,.03);await s.tick(1600);
 assert.equal(s.requests.filter(r=>r.url==='/api/kady/mensaje').length,2);assert.equal(s.permissionCalls(),1);assert.equal(s.stopCount(),0);
 const audio=s.requests.find(r=>r.url==='/api/kady/transcribir').init.body.get('audio');assert.equal(audio.type,'audio/wav');const view=new DataView(await audio.arrayBuffer());assert.equal(view.getUint32(24,true),16000);assert.equal(view.getUint16(22,true),1);
});

test('sustained speech interrupts playback and preserves the start of the new phrase',async()=>{
 const s=await setup({reply:{mensaje:'Seguimos con una explicación.'}});await s.click('kady-mic');s.sandbox.window.Kady.announce('Una explicación para interrumpir.');await flush();await flush();
 assert.equal(s.el('kady-audio').paused,false);await s.tick(300,.002);await s.tick(100,.05);assert.equal(s.el('kady-audio').paused,false);
 await s.tick(160,.05);assert.equal(s.el('kady-audio').paused,true);assert.equal(s.el('kady-mic').dataset.state,'recording');await s.tick(300,.04);await s.tick(1600);
 const clip=s.requests.find(r=>r.url==='/api/kady/transcribir').init.body.get('audio');const bytes=new DataView(await clip.arrayBuffer());
 assert.ok([...Array(clip.size/2-22)].some((_,i)=>Math.abs(bytes.getInt16(44+i*2,true))>1400),'Speech onset is preserved');assert.equal(s.requests.filter(r=>r.url==='/api/kady/mensaje').length,1);
});

test('ambient sound and brief bumps do not interrupt Kady or invoke transcription',async()=>{
 const s=await setup();await s.click('kady-mic');s.sandbox.window.Kady.announce('Una explicación larga.');await flush();await flush();
 await s.tick(1000,.003);await s.tick(80,.05);await s.tick(2400,.003);assert.equal(s.el('kady-audio').paused,false);assert.equal(s.requests.filter(r=>r.url==='/api/kady/transcribir').length,0);
});

test('silence stays local and only a long inactive session pauses the conversation',async()=>{
 const s=await setup();await s.click('kady-mic');await s.tick(13000);assert.equal(s.stopCount(),0);await s.tick(78000);
 assert.ok(s.stopCount()>0);assert.equal(s.requests.filter(r=>r.url==='/api/kady/transcribir').length,0);assert.match(s.el('kady-status').textContent,/inactividad/);assert.equal(s.el('kady-mic-label').textContent,'Conversar');
});

test('Finalizar cancels a phrase rather than submitting unfinished speech',async()=>{
 const s=await setup();await s.click('kady-mic');await s.tick(700,.03);await s.click('kady-mic');assert.ok(s.stopCount()>0);assert.equal(s.requests.filter(r=>r.url==='/api/kady/transcribir').length,0);assert.equal(s.el('kady-mic').attributes['aria-pressed'],'false');
});

test('closing during transcription prevents stale navigation and automatic restart',async()=>{
 const s=await setup({pendingTranscript:true});await s.click('kady-mic');await s.tick(500,.03);await s.tick(1600);await s.click('kady-close');s.resolveTranscript();await flush();await flush();
 assert.equal(s.sandbox.destination,undefined);assert.equal(s.requests.filter(r=>r.url==='/api/kady/mensaje').length,0);assert.equal(s.el('kady-mic-label').textContent,'Conversar');
});

test('pressing Enter during transcription cannot overlap two user turns',async()=>{
 const s=await setup({pendingTranscript:true});await s.click('kady-mic');await s.tick(500,.03);await s.tick(1600);
 s.el('kady-input').value='Otra pregunta';s.el('kady-input').listeners.keydown({key:'Enter',shiftKey:false,target:s.el('kady-input'),preventDefault(){}});await flush();
 assert.equal(s.requests.filter(r=>r.url==='/api/kady/mensaje').length,0);await s.click('kady-mic');
});

test('closing while permission is pending releases the late stream',async()=>{
 const s=await setup({pendingPermission:true});await s.click('kady-mic');await s.click('kady-close');s.resolvePermission();await flush();assert.ok(s.stopCount()>0);
});

test('finalizing while a reply is pending keeps the answer silent',async()=>{
 const s=await setup({pendingReply:true});await s.click('kady-mic');const count=s.requests.filter(r=>r.url==='/api/kady/voz').length;
 await s.tick(500,.03);await s.tick(1600);await s.click('kady-mic');s.resolveReply();await flush();await flush();
 assert.equal(s.requests.filter(r=>r.url==='/api/kady/voz').length,count);assert.equal(s.el('kady-mic-label').textContent,'Conversar');assert.equal(s.el('kady-messages').children.at(-1).textContent,'Practicamos con otro ejemplo.');
});

test('closing during voice generation ignores the late audio',async()=>{
 const s=await setup({noNotice:true,pendingVoice:true});s.sandbox.window.Kady.announce('Una respuesta.');await flush();await s.click('kady-close');s.resolveVoice();await flush();await flush();assert.equal(s.el('kady-audio').paused,true);
});

test('a spoken end command stops listening without an AI request',async()=>{
 const s=await setup({transcript:'Termina la conversación.'});await s.click('kady-mic');await s.tick(600,.03);await s.tick(1600);assert.ok(s.stopCount()>0);assert.equal(s.requests.filter(r=>r.url==='/api/kady/mensaje').length,0);assert.match(s.el('kady-status').textContent,/finalizada/);
});

test('voice generation failure returns to listening for the next phrase',async()=>{
 const s=await setup({voiceFails:true,reply:{mensaje:'Puedes leer esto.'}});await s.click('kady-mic');await s.tick(500,.03);await s.tick(1600);assert.equal(s.el('kady-mic').dataset.state,'listening');assert.equal(s.stopCount(),0);
});

test('hiding the page stops the microphone and playback',async()=>{
 const s=await setup();await s.click('kady-mic');s.sandbox.document.hidden=true;s.documentListeners.visibilitychange();assert.ok(s.stopCount()>0);assert.equal(s.el('kady-audio').paused,true);assert.equal(s.el('kady-mic-label').textContent,'Conversar');
});

test('worklet initialization failure releases the microphone',async()=>{
 const s=await setup({workletFails:true});await s.click('kady-mic');assert.ok(s.stopCount()>0);assert.equal(s.el('kady-mic-label').textContent,'Conversar');assert.match(s.el('kady-status').textContent,/No se pudo activar/);
});

test('disabling voice prevents new audio synthesis',async()=>{
 const s=await setup();const count=s.requests.filter(r=>r.url==='/api/kady/voz').length;s.el('kady-voice').checked=false;s.el('kady-voice').listeners.change();s.sandbox.window.Kady.announce('Sigue practicando.');await flush();assert.equal(s.requests.filter(r=>r.url==='/api/kady/voz').length,count);
});
