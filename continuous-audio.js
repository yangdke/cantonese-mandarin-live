(function(root){
  'use strict';
  class ContinuousAudio{
    constructor({onResult=()=>{},onStatus=()=>{},onError=()=>{},onLevel=()=>{}}={}){
      Object.assign(this,{onResult,onStatus,onError,onLevel});this.generation=0;this.session=0;this.epoch=0;this.ready=false;this.recording=false;this.worker=null;this.context=null;
    }
    prepare(){
      if(this.ready)return Promise.resolve();if(this.preparing)return this.preparing;
      const worker=this.worker=new Worker('recognition-worker.js?v=20261021-mic2');
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
      this.rejectReady?.(error);this.stop();this.worker?.terminate();this.worker=null;this.preparing=null;this.ready=false;this.resolveDrained?.();this.draining=null;
      this.onError(error);
    }
    microphoneEnded(){return Object.assign(new Error('麦克风音轨已被系统中断。请保持页面在前台，关闭其他正在录音或通话的应用后重试'),{code:'MIC_ENDED'});}
    detachInput(){
      this.removeTrackListeners?.();this.removeTrackListeners=null;
      if(this.capture){this.capture.port.onmessage=null;this.capture.disconnect();}
      this.input?.disconnect();this.media?.getTracks().forEach(track=>track.stop());
      this.capture=null;this.input=null;this.media=null;
    }
    async connectInput(token){
      // Let the device choose its native format. The worker converts actual input to 16 kHz.
      const media=await navigator.mediaDevices.getUserMedia({audio:{channelCount:{ideal:1},echoCancellation:true,noiseSuppression:true,autoGainControl:true}});
      if(token!==this.generation){media.getTracks().forEach(track=>track.stop());return false;}
      this.media=media;const tracks=media.getAudioTracks();
      if(!tracks.length||tracks.some(track=>track.readyState==='ended'))throw this.microphoneEnded();
      const context=this.context,capture=this.capture=new AudioWorkletNode(context,'continuous-microphone');
      const current=()=>token===this.generation&&this.media===media&&this.capture===capture;
      this.input=context.createMediaStreamSource(media);
      const listeners=[];
      for(const track of tracks){
        for(const [name,fn]of Object.entries({
          ended:()=>{if(current()&&this.recording)this.recoverInput(token,media);},
          mute:()=>{if(current()&&this.recording)this.onStatus({phase:'muted'});},
          unmute:()=>{if(current()&&this.recording)this.reportInputState();}
        })){track.addEventListener(name,fn);listeners.push(()=>track.removeEventListener(name,fn));}
      }
      this.removeTrackListeners=()=>listeners.forEach(remove=>remove());
      capture.port.onmessage=({data:samples})=>{
        if(!current()||!this.recording)return;
        let sum=0;for(const sample of samples)sum+=sample*sample;this.onLevel(Math.sqrt(sum/samples.length));
        this.worker.postMessage({type:'audio',session:this.session,epoch:this.epoch,sampleRate:context.sampleRate,samples},[samples.buffer]);
      };
      this.input.connect(capture);capture.connect(context.destination);
      if(context.state!=='running')context.resume().catch(()=>{if(current())this.reportInputState();});
      // Some mobile devices end an input while its audio route is being connected.
      if(tracks.some(track=>track.readyState==='ended'))throw this.microphoneEnded();
      return true;
    }
    reportInputState(){
      if(!this.recording||!this.media)return;
      const state=this.context?.state;
      this.onStatus({phase:state==='suspended'||state==='interrupted'?'suspended':this.media.getAudioTracks().some(track=>track.muted)?'muted':'listening'});
    }
    async resume(){
      const context=this.context;if(!this.recording||!context)return false;
      await context.resume();if(context===this.context)this.reportInputState();return context.state==='running';
    }
    async recoverInput(token,media){
      if(token!==this.generation||this.media!==media||this.recovering)return;
      this.recovering=true;
      try{
        // Never create a reconnect loop or reopen an input after permission was revoked.
        if(this.recoveries>=1||root.document?.visibilityState==='hidden')throw this.microphoneEnded();
        let permission;try{permission=await navigator.permissions?.query({name:'microphone'});}catch(_){}
        if(token!==this.generation)return;
        if(permission?.state==='denied')throw Object.assign(new Error('麦克风权限已被关闭'),{name:'NotAllowedError'});
        if(permission?.state==='prompt')throw this.microphoneEnded();
        this.recoveries++;this.onStatus({phase:'recovering'});this.detachInput();
        if(await this.connectInput(token))this.reportInputState();
      }catch(error){if(token===this.generation){error.captureState=this.context?.state;this.stop();this.onError(error);}}
      finally{if(token===this.generation)this.recovering=false;}
    }
    async start(){
      const token=++this.generation;
      const Context=root.AudioContext||root.webkitAudioContext;
      if(!navigator.mediaDevices?.getUserMedia||!Context||typeof Worker==='undefined')throw new Error('当前浏览器不支持持续收音，请使用新版 Chrome、Edge 或 Safari');
      this.onStatus({phase:'preparing'});
      try{
        this.recoveries=0;this.recovering=false;
        this.context=new Context({latencyHint:'interactive'});
        await this.context.resume();if(token!==this.generation)return false;await this.prepare();if(this.draining)await this.draining;
        if(token!==this.generation)return false;
        if(!this.context.audioWorklet)throw new Error('当前浏览器不支持持续收音的音频接口，请在新版 Chrome、Edge 或 Safari 中打开');
        await this.context.audioWorklet.addModule('capture-worklet.js?v=20261021-mic2');
        if(token!==this.generation)return false;
        this.onStatus({phase:'permission'});
        if(!await this.connectInput(token))return false;
        this.session++;this.epoch=0;this.recording=true;this.worker.postMessage({type:'start',session:this.session,epoch:this.epoch});
        const context=this.context;
        context.onstatechange=()=>{if(token===this.generation&&this.context===context)this.reportInputState();};
        this.reportInputState();return true;
      }catch(error){if(token!==this.generation)return false;this.stop();throw error;}
    }
    stop(){
      this.generation++;const wasRecording=this.recording;this.recording=false;
      if(this.ready&&wasRecording){this.draining=new Promise(resolve=>{this.resolveDrained=resolve;});this.worker?.postMessage({type:'stop',session:this.session});}
      this.detachInput();this.recovering=false;
      if(this.context){this.context.onstatechange=null;this.context.close().catch(()=>{});}
      this.context=null;
      if(!this.ready&&this.worker){this.worker.terminate();this.worker=null;this.rejectReady?.(new Error('已取消准备'));this.preparing=null;}
      return this.draining||Promise.resolve();
    }
    reset(){this.epoch++;if(this.ready)this.worker.postMessage({type:'reset',session:this.session,epoch:this.epoch});}
  }
  root.ContinuousAudio=ContinuousAudio;
  if(typeof module==='object'&&module.exports)module.exports={ContinuousAudio};
})(typeof window==='object'?window:this);
