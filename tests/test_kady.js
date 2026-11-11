const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const flush=()=>new Promise(resolve=>setImmediate(resolve));
async function setup(options={}) {
 const elements=new Map(),requests=[],windowListeners={},cache=options.cache || new Map();
 let now=0,frame=null,amplitude=0,media,stopped=0,transcriptionResolve,permissionResolve,replyResolve,constraints,recorderOptions;
 const timers=new Map();let timerId=0;
 const el=id=>{
  if(!elements.has(id))elements.set(id,{id,dataset:{},style:{},hidden:false,value:'',children:[],events:{},listeners:{},attributes:{},
   addEventListener(event,fn){(this.events[event]??=[]).push(fn);this.listeners[event]=e=>this.events[event].forEach(f=>f(e));},
   removeEventListener(event,fn){this.events[event]=(this.events[event]||[]).filter(f=>f!==fn);},
   setAttribute(k,v){this.attributes[k]=v;},removeAttribute(k){delete this.attributes[k];},
   append(...items){this.children.push(...items);},querySelectorAll(){return [];},focus(){},scrollIntoView(){},setPointerCapture(){},
   getBoundingClientRect(){return {left:parseFloat(this.style.left)||900,top:parseFloat(this.style.top)||500,width:this.id==='kady-window'?390:130,height:this.id==='kady-window'?460:64};},
   pause(){},async play(){if(options.blockAudio)throw Error('blocked');},closest(){return this;}});
  return elements.get(id);
 };
 el('kady-companion').dataset={user:'41',page:'/prin',agent:options.agent || 'inicio'};el('kady-window').hidden=true;
 class Recorder {
  static isTypeSupported(value){return value.startsWith('audio/webm');}
  constructor(_,settings){this.state='inactive';this.mimeType=settings.mimeType || 'audio/webm';media=this;recorderOptions=settings;}
  start(){this.state='recording';}
  stop(){this.state='inactive';queueMicrotask(()=>{this.ondataavailable?.({data:new Blob([new Uint8Array(1800)])});this.onstop?.();});}
 }
 class Context {
  async resume(){}async close(){}createMediaStreamSource(){return {connect(){},disconnect(){}};}
  createAnalyser(){return {fftSize:2048,getFloatTimeDomainData(data){data.fill(amplitude);}};}
 }
 const sandbox={innerWidth:1400,innerHeight:1000,Blob,Uint8Array,Float32Array,FormData,URLSearchParams,AbortController,atob,URL,
  performance:{now:()=>now},setTimeout(fn,ms){const id=++timerId;timers.set(id,{fn,ms});return id;},clearTimeout(id){timers.delete(id);},
  requestAnimationFrame:fn=>{frame=fn;return 1;},cancelAnimationFrame:()=>{frame=null;},
  localStorage:{getItem:k=>cache.get(k),setItem:(k,v)=>cache.set(k,v)},
  navigator:{mediaDevices:{getUserMedia:async input=>{constraints=input;const value={getTracks:()=>[{stop(){stopped++;}}]};return options.pendingPermission?new Promise(resolve=>{permissionResolve=()=>resolve(value);}):value;}}},
  document:{getElementById:id=>['classroom','algebra-app','english-start','english-stop'].includes(id)?null:el(id),querySelector:()=>({content:'csrf'}),createElement:tag=>el('new-'+tag+'-'+Math.random()),addEventListener(){}},
  window:{AudioContext:Context,MediaRecorder:Recorder,addEventListener:(e,f)=>{windowListeners[e]=f;},location:{assign:url=>{sandbox.destination=url;}}},
  fetch:async(url,init={})=>{
   requests.push({url,init});let data,ok=true;
   if(url.startsWith('/api/kady/contexto'))data={voice_configured:true,notice:options.noNotice?null:'intro-v2',mensaje:'Hola, ¿cómo estás?',agente:{nombre:'Kady '+(options.agent || 'Inicio')},history:options.history || [],...(options.onboarding?{notice:'platform-welcome-v2',redirect:'/encuesta'}:{})};
   else if(url==='/api/kady/bienvenida')data={fresh:options.alreadyClaimed!==true};
   else if(url==='/api/kady/voz')data={audio_base64:'SUQz'};
   else if(url==='/api/kady/transcribir')data=options.pendingTranscript?await new Promise(resolve=>{transcriptionResolve=resolve;}):{texto:'Explícame este paso.'};
   else if(url==='/api/kady/mensaje'){data=options.pendingReply?await new Promise(resolve=>{replyResolve=resolve;}):options.reply || {mensaje:'Vamos a Inicio.',navegar:'/prin'};ok=options.replyOk!==false;}
   else data={ok:true};return {ok,json:async()=>data};
  }};
 vm.runInNewContext(fs.readFileSync('static/js/kady-listener.js','utf8'),sandbox);
 vm.runInNewContext(fs.readFileSync('static/js/kady.js','utf8'),sandbox);await flush();await flush();
 async function tick(ms,level=0){now+=ms;amplitude=level;frame?.();await flush();}
 return {el,requests,sandbox,windowListeners,cache,timers,tick,
  click:async id=>{await el(id).listeners.click();await flush();await flush();},
  stopCount:()=>stopped,media:()=>media,constraints:()=>constraints,recorderOptions:()=>recorderOptions,
  resolveTranscript:()=>transcriptionResolve({texto:'Llévame a inicio'}),resolvePermission:()=>permissionResolve(),resolveReply:()=>replyResolve({mensaje:'Practicamos con otro ejemplo.'})};
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
test('microphone requests noise reduction and preserves a short pause before automatic send',async()=>{
 const s=await setup({reply:{mensaje:'Podemos practicar.'}});await s.click('kady-mic');assert.equal(s.media().state,'recording');
 assert.equal(s.constraints().audio.echoCancellation,true);assert.equal(s.constraints().audio.noiseSuppression,true);assert.equal(s.recorderOptions().audioBitsPerSecond,96000);
 await s.tick(200,.03);await s.tick(200,.03);await s.tick(900,.03);await s.tick(1000,0);assert.equal(s.media().state,'recording');
 await s.tick(900,0);assert.equal(s.media().state,'recording');await s.tick(500,0);await flush();await flush();
 assert.equal(s.requests.filter(r=>r.url==='/api/kady/transcribir').length,1);assert.equal(s.requests.filter(r=>r.url==='/api/kady/mensaje').length,1);assert.match(s.el('kady-heard').textContent,/Explícame/);
});
test('Terminar submits a complete recording instead of discarding it',async()=>{
 const s=await setup();await s.click('kady-mic');await s.tick(700,.03);await s.click('kady-mic');await flush();
 assert.equal(s.requests.filter(r=>r.url==='/api/kady/transcribir').length,1);assert.ok(s.stopCount()>0);
});
test('silence cancels capture without spending a transcription request',async()=>{
 const s=await setup();await s.click('kady-mic');await s.tick(12500,0);assert.ok(s.stopCount()>0);assert.equal(s.requests.filter(r=>r.url==='/api/kady/transcribir').length,0);assert.match(s.el('kady-status').textContent,/No escuché/);
});
test('closing while transcription is pending prevents stale navigation',async()=>{
 const s=await setup({pendingTranscript:true});await s.click('kady-mic');await s.tick(700,.03);await s.click('kady-mic');await s.click('kady-close');s.resolveTranscript();await flush();await flush();
 assert.equal(s.sandbox.destination,undefined);assert.equal(s.requests.filter(r=>r.url==='/api/kady/mensaje').length,0);
});
test('closing while permission is pending releases the late stream',async()=>{
 const s=await setup({pendingPermission:true});await s.click('kady-mic');await s.click('kady-close');s.resolvePermission();await flush();assert.ok(s.stopCount()>0);assert.equal(s.media(),undefined);
});
test('minimizing while a reply is pending keeps the answer silent',async()=>{
 const s=await setup({pendingReply:true});const count=s.requests.filter(r=>r.url==='/api/kady/voz').length;
 s.sandbox.window.Kady.ask('Ayúdame con este ejercicio');await flush();await s.click('kady-close');s.resolveReply();await flush();await flush();
 assert.equal(s.requests.filter(r=>r.url==='/api/kady/voz').length,count);assert.equal(s.el('kady-window').hidden,true);
 assert.equal(s.el('kady-messages').children.at(-1).textContent,'Practicamos con otro ejemplo.');
});
test('disabling voice prevents new audio synthesis',async()=>{
 const s=await setup();const count=s.requests.filter(r=>r.url==='/api/kady/voz').length;s.el('kady-voice').checked=false;s.el('kady-voice').listeners.change();s.sandbox.window.Kady.announce('Sigue practicando.');await flush();assert.equal(s.requests.filter(r=>r.url==='/api/kady/voz').length,count);
});
