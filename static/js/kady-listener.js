/* One complete audio file per turn; adaptive silence detection never clips the first syllable. */
(() => {
  'use strict';
  class KadyListener {
    constructor(options) { this.options=options; this.epoch=0; this.state='idle'; }
    change(state) { this.state=state; this.options.onState?.(state); }
    async start() {
      if (this.state !== 'idle') return;
      const token=++this.epoch;
      if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) { this.options.onError?.('Este navegador no permite grabar aquí. Puedes escribir tu mensaje.'); return; }
      this.change('permission');
      try {
        const stream=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true,autoGainControl:true,channelCount:1}});
        if (token !== this.epoch) { stream.getTracks().forEach(track=>track.stop()); return; }
        this.stream=stream;
        const type=['audio/webm;codecs=opus','audio/mp4','audio/ogg;codecs=opus'].find(value=>window.MediaRecorder.isTypeSupported?.(value));
        const recorder=new window.MediaRecorder(stream,{...(type?{mimeType:type}:{}),audioBitsPerSecond:96000});
        this.recorder=recorder;this.chunks=[];this.heard=false;this.voiceFrames=0;this.noiseFloor=.004;
        recorder.ondataavailable=event=>{if(token===this.epoch && event.data.size) this.chunks.push(event.data);};
        recorder.onerror=()=>{if(token===this.epoch){this.cancel();this.options.onError?.('La grabación se interrumpió. Intenta de nuevo.');}};
        recorder.onstop=()=>this.finish(token,recorder.mimeType);
        const Context=window.AudioContext || window.webkitAudioContext;
        if(Context) {
          try {
            const audioContext=new Context();this.context=audioContext;await audioContext.resume();
            if(token!==this.epoch){audioContext.close().catch(()=>{});stream.getTracks().forEach(track=>track.stop());return;}
            this.source=this.context.createMediaStreamSource(stream);this.analyser=this.context.createAnalyser();
            this.analyser.fftSize=2048;this.samples=new Float32Array(this.analyser.fftSize);this.source.connect(this.analyser);
          } catch { if(token!==this.epoch){stream.getTracks().forEach(track=>track.stop());return;}this.analyser=null; this.context?.close().catch(()=>{});this.context=null; }
        }
        if(token!==this.epoch){stream.getTracks().forEach(track=>track.stop());return;}
        this.started=performance.now();this.lastVoice=this.started;recorder.start();this.change('recording');
        this.deadline=setTimeout(()=>this.stop(),60000);
        this.observe(token);
      } catch(error) {
        if(token!==this.epoch)return;
        this.cancel();this.options.onError?.(error.name==='NotAllowedError'?'Permite usar el micrófono en tu navegador para hablar con Kady.':'No se pudo abrir el micrófono. Puedes escribir o intentar otra vez.');
      }
    }
    observe(token) {
      if(token!==this.epoch || this.state!=='recording')return;
      const now=performance.now();const elapsed=now-this.started;
      if(this.analyser) {
        this.analyser.getFloatTimeDomainData(this.samples);
        const rms=Math.sqrt(this.samples.reduce((sum,value)=>sum+value*value,0)/this.samples.length);
        const threshold=Math.max(.009,this.noiseFloor*2.6);
        if(rms>threshold) {
          this.voiceFrames++;if(this.voiceFrames>=2){this.heard=true;this.lastVoice=now;}
        } else { this.voiceFrames=0;if(!this.heard && rms<.015)this.noiseFloor=.96*this.noiseFloor+.04*rms; }
        this.options.onLevel?.(Math.min(1,rms*14),Math.floor(elapsed/1000));
        if(this.heard && elapsed>900 && now-this.lastVoice>2200){this.stop();return;}
        if(!this.heard && elapsed>12000){this.cancel();this.options.onError?.('No escuché una frase. Acerca un poco el micrófono e intenta de nuevo.');return;}
      } else this.options.onLevel?.(0,Math.floor(elapsed/1000));
      this.frame=requestAnimationFrame(()=>this.observe(token));
    }
    stop() {
      if(this.state!=='recording')return;
      clearTimeout(this.deadline);cancelAnimationFrame(this.frame);this.change('processing');
      if(this.recorder?.state==='recording')this.recorder.stop();
    }
    release() {
      clearTimeout(this.deadline);cancelAnimationFrame(this.frame);
      this.stream?.getTracks().forEach(track=>track.stop());this.stream=null;
      this.source?.disconnect();this.source=null;this.analyser=null;
      this.context?.close().catch(()=>{});this.context=null;this.options.onLevel?.(0,0);
    }
    cancel() {
      this.epoch++;this.request?.abort();this.release();
      if(this.recorder?.state==='recording'){this.recorder.onstop=null;this.recorder.ondataavailable=null;this.recorder.stop();}
      this.recorder=null;this.chunks=[];this.change('idle');
    }
    async finish(token,mime) {
      if(token!==this.epoch)return;
      const duration=performance.now()-this.started;
      const blob=new Blob(this.chunks,{type:mime.split(';')[0]});
      this.recorder=null;this.release();
      if(blob.size<100 || duration<300){this.change('idle');this.options.onError?.('La grabación fue muy corta. Pulsa Hablar y espera a ver «Te escucho».');return;}
      this.change('processing');this.request=new AbortController();
      try {
        const transcript=await this.options.transcribe(blob,this.request.signal);
        if(token!==this.epoch)return;
        this.change('idle');
        if(!transcript.trim()){this.options.onError?.('No entendí una frase. Puedes repetirla o escribirla.');return;}
        this.options.onTranscript?.(transcript);
      } catch(error) {
        if(token!==this.epoch || error.name==='AbortError')return;
        this.change('idle');this.options.onError?.(error.message || 'No pude transcribir. Intenta de nuevo.');
      }
    }
  }
  window.KadyListener=KadyListener;
})();
