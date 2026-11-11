const {test} = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const flush = () => new Promise(resolve => setImmediate(resolve));
async function setup(options = {}) {
  const elements = new Map(), requests = [], windowListeners = {};
  const el = id => {
    if (!elements.has(id)) elements.set(id,{id, dataset:{}, style:{}, hidden:false, value:'', children:[], listeners:{}, attributes:{},
      addEventListener(event,fn) {this.listeners[event]=fn;}, setAttribute(k,v) {this.attributes[k]=v;}, removeAttribute(k) {delete this.attributes[k];},
      append(...items) {this.children.push(...items);}, querySelectorAll() {return [];}, focus() {}, scrollIntoView() {}, setPointerCapture() {},
      getBoundingClientRect() {return {left:parseFloat(this.style.left)||900, top:parseFloat(this.style.top)||500, width:this.id==='kady-window'?390:130, height:this.id==='kady-window'?460:64};},
      pause() {}, async play() {if (options.blockAudio) throw Error('blocked');}, closest() {return this;}});
    return elements.get(id);
  };
  el('kady-companion').dataset={user:'41',page:'/prin'};
  el('kady-window').hidden=true;
  const cache=new Map();
  let media, stopped=0, transcriptionResolve;
  class Recorder {
    constructor() {this.state='inactive';this.mimeType='audio/webm';media=this;}
    start() {this.state='recording';}
    stop() {this.state='inactive';queueMicrotask(()=>{this.ondataavailable?.({data:new Blob(['hello'])});this.onstop?.();});}
  }
  const sandbox={innerWidth:1400,innerHeight:1000, Blob,Uint8Array,FormData,AbortController,atob,URL,
    setTimeout:()=>1,clearTimeout(){},
    localStorage:{getItem:k=>cache.get(k),setItem:(k,v)=>cache.set(k,v)}, sessionStorage:{getItem:()=>null,setItem(){}},
    navigator:{mediaDevices:{getUserMedia:async()=>({getTracks:()=>[{stop(){stopped++;}}]})}},MediaRecorder:Recorder,
    document:{getElementById:id=>['classroom','algebra-app'].includes(id)?null:el(id),querySelector:()=>({content:'csrf'}),createElement:tag=>el(`new-${tag}-${Math.random()}`),addEventListener(){}},
    window:{MediaRecorder:Recorder,addEventListener:(e,f)=>{windowListeners[e]=f;},location:{assign:url=>{sandbox.destination=url;}}},
    fetch:async(url,init={})=>{
      requests.push({url,init});
      let data;
      if(url==='/api/kady/contexto')data={voice_configured:true,first_visit:true,checkin:true,mensaje:'Hola. ¿Cómo estás? No tienes tareas pendientes.'};
      else if(url==='/api/kady/voz')data={audio_base64:'SUQz'};
      else if(url==='/api/kady/transcribir')data=await new Promise(resolve=>{transcriptionResolve=resolve;});
      else if(url==='/api/kady/mensaje')data=options.reply || {mensaje:'Vamos a Inicio.',navegar:'/prin'};
      else data={ok:true};
      return {ok:true,json:async()=>data};
    }};
  vm.runInNewContext(fs.readFileSync('static/js/kady.js','utf8'),sandbox);
  await flush();await flush();
  return {el,requests,sandbox,windowListeners,click:async id=>{await el(id).listeners.click();await flush();},stopCount:()=>stopped,media:()=>media,resolveTranscript:()=>transcriptionResolve({texto:'Llévame a inicio'})};
}
test('welcome opens floating window, handles blocked autoplay, and permits text navigation',async()=>{
  const {el,click,sandbox,requests}=await setup({blockAudio:true});
  assert.equal(el('kady-window').hidden,false);
  assert.match(el('kady-status').textContent,/reproducir/);
  assert.ok(requests.some(r=>r.url==='/api/kady/bienvenida'));
  el('kady-input').value='Llévame a inicio';
  await el('kady-form').listeners.submit({preventDefault(){}});await flush();
  assert.equal(sandbox.destination,'/prin');
  await click('kady-close');assert.equal(el('kady-window').hidden,true);
});
test('bubble and window can be moved independently by keyboard and clamped on resize',async()=>{
  const {el,windowListeners}=await setup();
  const event=(target,key)=>({target,key,preventDefault(){}});
  el('kady-bubble').listeners.keydown(event(el('kady-bubble'),'ArrowLeft'));
  assert.equal(el('kady-bubble').style.left,'880px');
  el('kady-drag').listeners.keydown(event(el('kady-drag'),'ArrowUp'));
  assert.equal(el('kady-window').style.top,'480px');
  windowListeners.resize();assert.equal(el('kady-bubble').style.left,'880px');
});
test('closing while transcription is pending stops capture and prevents stale voice navigation',async()=>{
  const {click,media,resolveTranscript,stopCount,sandbox,requests}=await setup();
  await click('kady-mic');assert.equal(media().state,'recording');
  await click('kady-mic');assert.ok(stopCount()>0);
  await click('kady-close');resolveTranscript();await flush();await flush();
  assert.equal(sandbox.destination,undefined);
  assert.equal(requests.filter(r=>r.url==='/api/kady/mensaje').length,0);
});
test('turning voice off prevents new synthesis requests',async()=>{
  const {el,sandbox,requests}=await setup();
  const before=requests.filter(r=>r.url==='/api/kady/voz').length;
  el('kady-voice').checked=false;el('kady-voice').listeners.change();
  sandbox.window.Kady.announce('¡Muy bien, sigue adelante!');await flush();
  assert.equal(requests.filter(r=>r.url==='/api/kady/voz').length,before);
});
