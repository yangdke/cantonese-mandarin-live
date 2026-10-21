(function(root){
  'use strict';
  class ContinuousAudio{
    constructor({onResult=()=>{},onStatus=()=>{},onError=()=>{},onLevel=()=>{}}={}){
      Object.assign(this,{onResult,onStatus,onError,onLevel});this.generation=0;this.session=0;this.epoch=0;this.ready=false;this.recording=false;this.worker=null;this.context=null;
    }
    prepare(){
      if(this.ready)return Promise.resolve();if(this.preparing)return this.preparing;
      const worker=this.worker=new Worker('recognition-worker.js');
      this.preparing=new Promise((resolve,reject)=>{this.resolveReady=resolve;this.rejectReady=reject;});
      this.worker.onmessage=({data})=>{
        if(this.worker!==worker)return;
        if(data.type==='ready'){this.ready=true;this.resolveReady();this.onStatus({phase:'ready'});}
        else if(data.type==='progress')this.onStatus(data);
        else if(data.type==='result'&&data.session===this.session&&data.epoch===this.epoch)this.onResult(data);
        else if(data.type==='stopped'){this.resolveDrained?.();this.draining=null;}
        else if(data.type==='cache-warning')this.onStatus({phase:'cache-warning'});
        else if(data.type==='error')this.fail(new Error(data.message));
      };
      this.worker.onerror=event=>{if(this.worker===worker)this.fail(new Error(event.message||'本地识别引擎无法启动'))};
      this.worker.postMessage({type:'init'});return this.preparing;
    }
    fail(error){
      const active=this.recording;this.rejectReady?.(error);this.stop();this.worker?.terminate();this.worker=null;this.preparing=null;this.ready=false;this.resolveDrained?.();this.draining=null;
      if(active)this.onError(error);
    }
    async start(){
      const token=++this.generation;
      const Context=root.AudioContext||root.webkitAudioContext;
      if(!navigator.mediaDevices?.getUserMedia||!Context||typeof Worker==='undefined')throw new Error('当前浏览器不支持持续收音，请使用新版 Chrome、Edge 或 Safari');
      this.onStatus({phase:'preparing'});
      try{
        try{this.context=new Context({sampleRate:16000,latencyHint:'interactive'});}catch(_){this.context=new Context({latencyHint:'interactive'});}
        await this.context.resume();if(token!==this.generation)return false;await this.prepare();if(this.draining)await this.draining;
        if(token!==this.generation)return false;
        this.onStatus({phase:'permission'});
        const media=await navigator.mediaDevices.getUserMedia({audio:{channelCount:1,echoCancellation:true,noiseSuppression:true,autoGainControl:true,sampleRate:16000}});
        if(token!==this.generation){media.getTracks().forEach(track=>track.stop());return false;}
        this.media=media;this.input=this.context.createMediaStreamSource(media);
        await this.context.audioWorklet.addModule('capture-worklet.js');
        if(token!==this.generation)return false;
        this.capture=new AudioWorkletNode(this.context,'continuous-microphone');
        this.session++;this.epoch=0;this.recording=true;this.worker.postMessage({type:'start',session:this.session,epoch:this.epoch});
        this.capture.port.onmessage=({data:samples})=>{
          if(!this.recording)return;
          let sum=0;for(const sample of samples)sum+=sample*sample;this.onLevel(Math.sqrt(sum/samples.length));
          this.worker.postMessage({type:'audio',session:this.session,epoch:this.epoch,sampleRate:this.context.sampleRate,samples},[samples.buffer]);
        };
        this.input.connect(this.capture);this.capture.connect(this.context.destination);
        media.getAudioTracks().forEach(track=>track.addEventListener('ended',()=>{if(this.recording){this.stop();this.onError(new Error('麦克风连接已断开，请重新连接后开始'));}},{once:true}));
        this.context.onstatechange=()=>{if(this.recording&&this.context?.state==='suspended')this.onStatus({phase:'suspended'});else if(this.recording&&this.context?.state==='running')this.onStatus({phase:'listening'});};
        this.onStatus({phase:'listening'});return true;
      }catch(error){if(token===this.generation)this.stop();throw error;}
    }
    stop(){
      this.generation++;const wasRecording=this.recording;this.recording=false;
      if(this.ready&&wasRecording){this.draining=new Promise(resolve=>{this.resolveDrained=resolve;});this.worker?.postMessage({type:'stop',session:this.session});}
      this.capture?.disconnect();this.input?.disconnect();this.media?.getTracks().forEach(track=>track.stop());
      if(this.context){this.context.onstatechange=null;this.context.close().catch(()=>{});}
      this.capture=null;this.input=null;this.media=null;this.context=null;
      if(!this.ready&&this.worker){this.worker.terminate();this.worker=null;this.rejectReady?.(new Error('已取消准备'));this.preparing=null;}
      return this.draining||Promise.resolve();
    }
    reset(){this.epoch++;if(this.ready)this.worker.postMessage({type:'reset',session:this.session,epoch:this.epoch});}
  }
  root.ContinuousAudio=ContinuousAudio;
  if(typeof module==='object'&&module.exports)module.exports={ContinuousAudio};
})(typeof window==='object'?window:this);
