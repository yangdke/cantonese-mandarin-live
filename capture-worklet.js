class ContinuousMicrophone extends AudioWorkletProcessor{
  constructor(){super();this.buffer=new Float32Array(1280);this.offset=0;}
  process(inputs,outputs){
    // The output remains silent: microphone audio is never played through the speaker.
    for(const channel of outputs[0]||[])channel.fill(0);
    const input=inputs[0]?.[0];
    if(input)for(let i=0;i<input.length;i++){
      this.buffer[this.offset++]=input[i];
      if(this.offset===this.buffer.length){const samples=this.buffer;this.port.postMessage(samples,[samples.buffer]);this.buffer=new Float32Array(1280);this.offset=0;}
    }
    return true;
  }
}
registerProcessor('continuous-microphone',ContinuousMicrophone);
