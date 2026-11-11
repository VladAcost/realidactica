/* Continuous, opt-in microphone. Silence stays local; only complete phrases leave the browser. */
(() => {
  'use strict';
  class KadyListener {
    constructor(options) { this.options=options;this.epoch=0;this.state='idle';this.active=false;this.failures=0; }
    change(state) { this.state=state;this.options.onState?.(state); }
    reset() { this.pre=[];this.chunks=[];this.voiced=0;this.candidate=0;this.quiet=0;this.samples=0;this.heard=false; }
    async start() {
      if(this.state!=='idle')return;
      const Context=window.AudioContext || window.webkitAudioContext;
      if(!navigator.mediaDevices?.getUserMedia || !Context || !window.AudioWorkletNode) {
        this.options.onError?.('La conversación de voz requiere un navegador actualizado. Puedes seguir escribiendo.');return;
      }
      const token=++this.epoch;this.change('permission');
      try {
        const context=new Context({latencyHint:'interactive'});this.context=context;
        // Resume inside the user's click, before the permission prompt completes.
        const resumed=context.resume();
        resumed.catch(()=>{});
        const stream=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true,autoGainControl:true,channelCount:1}});
        if(token!==this.epoch){stream.getTracks().forEach(track=>track.stop());return;}
        this.stream=stream;await resumed;
        const track=stream.getAudioTracks?.()[0];
        if(track?.getCapabilities?.().echoCancellation?.includes('all')) {
          await track.applyConstraints({echoCancellation:{ideal:'all'}}).catch(()=>{});
        }
        if(token!==this.epoch)return;
        if(!context.audioWorklet)throw Error('AudioWorklet unavailable');
        await context.audioWorklet.addModule('/static/js/kady-capture.js');
        if(token!==this.epoch)return;
        this.node=new window.AudioWorkletNode(context,'kady-capture');
        this.source=context.createMediaStreamSource(stream);
        this.node.port.onmessage=event=>{if(token===this.epoch)this.receive(event.data);};
        this.node.onprocessorerror=()=>{if(token===this.epoch){this.cancel();this.options.onError?.('La escucha se interrumpió. Pulsa Conversar para volver a activarla.');}};
        this.source.connect(this.node);this.node.connect(context.destination);
        for(const input of stream.getTracks())input.addEventListener?.('ended',()=>{if(token===this.epoch){this.cancel();this.options.onError?.('El micrófono se desconectó. Puedes volver a activar la conversación.');}},{once:true});
        context.addEventListener?.('statechange',()=>{if(token===this.epoch && this.active && context.state==='suspended'){this.cancel();this.options.onError?.('La conversación quedó pausada. Pulsa Conversar para continuar.');}});
        this.active=true;this.reset();this.noiseFloor=.003;this.failures=0;this.mode='listening';this.idle=0;this.guard=0;this.change('listening');
      } catch(error) {
        if(token!==this.epoch)return;
        this.cancel();this.options.onError?.(error.name==='NotAllowedError'?'Permite usar el micrófono en tu navegador para conversar con Kady.':'No se pudo activar la conversación. Puedes escribir o intentar de nuevo.');
      }
    }
    setMode(mode) {
      if(!this.active || this.mode===mode)return;
      const previous=this.mode;this.mode=mode;this.idle=0;
      if(this.heard && mode==='listening')return; // A barge-in keeps the first syllables.
      this.reset();
      if(mode==='speaking'){this.echoFloor=.003;this.guard=260;}
      else this.guard=previous==='speaking'?240:0;
      this.change(mode==='thinking'?'processing':mode);
    }
    receive(block) {
      if(!this.active || !block?.length)return;
      const ms=block.length/16;
      const rms=Math.sqrt(block.reduce((sum,value)=>sum+value*value,0)/block.length);
      this.options.onLevel?.(Math.min(1,rms*14),Math.floor(this.samples/16000));
      if(this.mode==='thinking')return;
      if(this.guard>0 && !this.heard) {
        this.guard-=ms;
        if(this.mode==='speaking')this.echoFloor=.8*this.echoFloor+.2*rms;
        return;
      }
      const speaking=this.mode==='speaking';
      const threshold=speaking?Math.max(.014,this.noiseFloor*3.5,(this.echoFloor || .003)*2.5):Math.max(.008,this.noiseFloor*2.8);
      const voice=rms>threshold;
      if(!this.heard) {
        this.pre.push(block);if(this.pre.length>16)this.pre.shift();
        this.candidate=voice?this.candidate+ms:0;
        if(!voice) {
          if(speaking)this.echoFloor=.98*this.echoFloor+.02*rms;
          else if(rms<.015)this.noiseFloor=.98*this.noiseFloor+.02*rms;
        }
        if(this.candidate>=(speaking?240:100)) {
          this.heard=true;this.chunks=this.pre;this.pre=[];this.samples=this.chunks.reduce((n,c)=>n+c.length,0);this.voiced=this.candidate;
          this.change('recording');this.options.onSpeechStart?.(speaking);
        } else {
          if(!speaking){this.idle+=ms;if(this.idle>=90000){this.cancel();this.options.onError?.('Conversación pausada por inactividad. Pulsa Conversar cuando quieras continuar.');}}
          return;
        }
      } else {
        this.chunks.push(block);this.samples+=block.length;
        if(voice)this.voiced+=ms;
      }
      this.quiet=voice?0:this.quiet+ms;
      if(this.quiet>=1500 || this.samples>=16000*58)this.finishTurn();
    }
    wav(chunks) {
      const length=chunks.reduce((total,chunk)=>total+chunk.length,0);
      const bytes=new ArrayBuffer(44+length*2),view=new DataView(bytes);
      const label=(at,text)=>{for(let i=0;i<text.length;i++)view.setUint8(at+i,text.charCodeAt(i));};
      label(0,'RIFF');view.setUint32(4,36+length*2,true);label(8,'WAVE');label(12,'fmt ');
      view.setUint32(16,16,true);view.setUint16(20,1,true);view.setUint16(22,1,true);
      view.setUint32(24,16000,true);view.setUint32(28,32000,true);view.setUint16(32,2,true);view.setUint16(34,16,true);
      label(36,'data');view.setUint32(40,length*2,true);
      let offset=44;
      for(const chunk of chunks)for(const sample of chunk){const value=Math.max(-1,Math.min(1,sample));view.setInt16(offset,value*(value<0?32768:32767),true);offset+=2;}
      return new Blob([bytes],{type:'audio/wav'});
    }
    async finishTurn() {
      if(!this.active || !this.heard || this.mode==='thinking')return;
      if(this.voiced<140){this.reset();this.change('listening');return;}
      const blob=this.wav(this.chunks),token=this.epoch;
      this.setMode('thinking');const request=new AbortController();this.request=request;
      try {
        const transcript=(await this.options.transcribe(blob,request.signal)).trim();
        if(token!==this.epoch || request!==this.request)return;
        this.failures=0;
        if(!transcript){this.setMode('listening');this.options.onError?.('No entendí esa frase. Te sigo escuchando.');return;}
        await this.options.onTranscript?.(transcript);
      } catch(error) {
        if(token!==this.epoch || error.name==='AbortError')return;
        this.failures++;
        if(this.failures>=3)this.cancel();else this.setMode('listening');
        this.options.onError?.(error.message || 'No pude entender la frase. Puedes intentar otra vez.');
      } finally {
        if(token===this.epoch && request===this.request){this.request=null;if(this.mode==='thinking')this.setMode('listening');}
      }
    }
    cancel() {
      this.epoch++;this.active=false;this.request?.abort();this.request=null;
      this.stream?.getTracks().forEach(track=>track.stop());this.stream=null;
      this.node?.port.close();this.node?.disconnect();this.node=null;
      this.source?.disconnect();this.source=null;
      this.context?.close().catch(()=>{});this.context=null;this.reset();this.mode='idle';this.options.onLevel?.(0,0);this.change('idle');
    }
  }
  window.KadyListener=KadyListener;
})();
