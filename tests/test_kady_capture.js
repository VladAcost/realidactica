const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const source=fs.readFileSync('static/js/kady-capture.js','utf8');

for(const rate of [16000,44100,48000])test(`capture preserves timing and level at ${rate} Hz with variable input blocks`,()=>{
 let Capture;const output=[];
 class Processor{constructor(){this.port={postMessage:block=>output.push(block.slice())};}}
 vm.runInNewContext(source,{sampleRate:rate,Float32Array,AudioWorkletProcessor:Processor,registerProcessor:(_,type)=>{Capture=type;}});
 const processor=new Capture();let position=0;
 for(const size of [128,256,64,512]) {
   for(let i=0;i<Math.floor(rate/size);i++){
     const block=new Float32Array(size);block.fill(.25);assert.equal(processor.process([[block]]),true);position+=size;
   }
 }
 assert.ok(Math.abs(output.length*320-position*16000/rate)<321);
 assert.ok(output.every(block=>block.length===320&&block.every(value=>Math.abs(value-.25)<1e-6)));
 assert.equal(processor.process([]),true);
});
