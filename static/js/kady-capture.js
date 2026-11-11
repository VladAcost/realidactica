/* Mono PCM at 16 kHz, in complete 20 ms blocks. The output stays silent. */
class KadyCapture extends AudioWorkletProcessor {
  constructor() {
    super();
    this.ratio=sampleRate/16000;
    this.weight=0;this.sum=0;this.offset=0;this.block=new Float32Array(320);
  }
  process(inputs) {
    const channel=inputs[0]?.[0];
    if(!channel)return true;
    for(const sample of channel) {
      let remaining=1;
      while(remaining>1e-7) {
        const take=Math.min(remaining,this.ratio-this.weight);
        this.sum+=sample*take;this.weight+=take;remaining-=take;
        if(this.weight>=this.ratio-1e-7) {
          this.block[this.offset++]=this.sum/this.ratio;this.weight=0;this.sum=0;
          if(this.offset===this.block.length) {
            this.port.postMessage(this.block,[this.block.buffer]);
            this.block=new Float32Array(320);this.offset=0;
          }
        }
      }
    }
    return true;
  }
}
registerProcessor('kady-capture',KadyCapture);
