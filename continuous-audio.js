(function(root){
  'use strict';
  const VERSION='20261021-mic3';
  class ContinuousAudio{
    constructor({onResult=()=>{},onStatus=()=>{},onError=()=>{},onLevel=()=>{},onDiagnostic=()=>{}}={}){
      Object.assign(this,{onResult,onStatus,onError,onLevel,onDiagnostic});
      this.generation=0;this.session=0;this.epoch=0;this.ready=false;this.recording=false;
      this.worker=null;this.context=null;this.stage='idle';this.events=[];this.startedAt=Date.now();this.blocks=0;
    }
    log(event,details={}){
      this.events.push({ms:Date.now()-this.startedAt,event,...details});if(this.events.length>24)this.events.shift();
      this.onDiagnostic(this.diagnosticText());
    }
    diagnosticText(){
      // Connection metadata only: no audio, transcript, device ID, or track label.
      return JSON.stringify({version:VERSION,browser:navigator.userAgent||'unavailable',secure:root.isSecureContext??null,
        visible:root.document?.visibilityState||'unknown',mode:this.mode||'not-selected',stage:this.stage,
        modelReady:this.ready,context:this.context?.state||'none',rate:this.context?.sampleRate||null,blocks:this.blocks,
        events:this.events},null,2);
    }
    prepare(){
      if(this.ready)return Promise.resolve();if(this.preparing)return this.preparing;
      const worker=this.worker=new Worker('recognition-worker.js?v='+VERSION);
      this.preparing=new Promise((resolve,reject)=>{this.resolveReady=resolve;this.rejectReady=reject;});
      worker.onmessage=({data})=>{
        if(this.worker!==worker)return;
        if(data.type==='ready'){this.ready=true;this.resolveReady();this.log('model-ready');}
        else if(data.type==='progress')this.onStatus(data);
        else if(data.type==='result'&&data.session===this.session&&data.epoch===this.epoch)this.onResult(data);
        else if(data.type==='stopped'){this.resolveDrained?.();this.draining=null;}
        else if(data.type==='cache-warning')this.onStatus({phase:'cache-warning'});
        else if(data.type==='error')this.fail(new Error(data.message));
      };
      worker.onerror=event=>{if(this.worker===worker)this.fail(new Error(event.message||'本地识别引擎无法启动'));};
      worker.postMessage({type:'init'});return this.preparing;
    }
    fail(error){
      this.rejectReady?.(error);this.log('engine-error',{name:error.name});this.stop();this.worker?.terminate();
      this.worker=null;this.preparing=null;this.ready=false;this.resolveDrained?.();this.draining=null;this.onError(error);
    }
    microphoneEnded(stage=this.stage,empty=false){
      return Object.assign(new Error(empty?'浏览器返回了空的麦克风音轨，请使用麦克风检测确认原始连接':'麦克风音轨已中断。请点击“检测麦克风”，区分原始收音和识别音频链路问题'),
        {code:empty?'MIC_EMPTY':'MIC_ENDED_'+stage.toUpperCase().replace(/-/g,'_')});
    }
    detachInput(){
      this.removeTrackListeners?.();this.removeTrackListeners=null;
      if(this.capture){this.capture.port.onmessage=null;this.capture.disconnect();}
      this.input?.disconnect();this.media?.getTracks().forEach(track=>track.stop());
      this.capture=null;this.input=null;this.media=null;
    }
    async connectInput(token){
      this.stage='request';this.log('request-microphone');
      const audio=this.mode==='compatible'?{echoCancellation:false,noiseSuppression:false,autoGainControl:false}:
        {channelCount:{ideal:1},echoCancellation:true,noiseSuppression:true,autoGainControl:true};
      // Called synchronously from the connection click, before model/drain/module awaits.
      const media=await navigator.mediaDevices.getUserMedia({audio});
      if(token!==this.generation){media.getTracks().forEach(track=>track.stop());return false;}
      this.media=media;const tracks=media.getAudioTracks();this.stage='open';
      this.log('microphone-returned',{tracks:tracks.length,states:tracks.map(t=>({state:t.readyState,muted:t.muted,enabled:t.enabled}))});
      if(!tracks.length||tracks.some(track=>track.readyState==='ended'))throw this.microphoneEnded('open',!tracks.length);
      const settings=tracks[0].getSettings?.()||{},format={};
      for(const key of ['sampleRate','channelCount','echoCancellation','noiseSuppression','autoGainControl'])if(settings[key]!==undefined)format[key]=settings[key];
      this.log('input-format',format);
      const current=()=>token===this.generation&&this.media===media;
      const listeners=[];
      for(const track of tracks){
        for(const [name,fn]of Object.entries({
          ended:()=>{if(current()){this.log('track-ended',{stage:this.stage,blocks:this.blocks});if(this.recording)this.recoverInput(token,media);}},
          mute:()=>{if(current()){this.log('track-muted');if(this.recording)this.onStatus({phase:'muted'});}},
          unmute:()=>{if(current()){this.log('track-unmuted');this.reportInputState();}}
        })){track.addEventListener(name,fn);listeners.push(()=>track.removeEventListener(name,fn));}
      }
      this.removeTrackListeners=()=>listeners.forEach(remove=>remove());
      if(!this.context){
        this.stage='context';const Context=root.AudioContext||root.webkitAudioContext;
        this.context=new Context({latencyHint:'interactive'});this.log('context-created',{state:this.context.state,rate:this.context.sampleRate});
        if(!this.context.audioWorklet)throw new Error('当前浏览器不支持持续收音的音频接口，请更新浏览器');
        this.stage='worklet';await this.context.audioWorklet.addModule('capture-worklet.js?v='+VERSION);
        if(!current())return false;
        if(tracks.some(track=>track.readyState==='ended'))throw this.microphoneEnded('worklet');
      }
      this.stage='graph';const context=this.context,capture=this.capture=new AudioWorkletNode(context,'continuous-microphone');
      this.input=context.createMediaStreamSource(media);
      capture.port.onmessage=({data:samples})=>{
        if(!current()||this.capture!==capture||!this.recording)return;
        this.blocks++;if(this.blocks===1)this.log('first-audio-block',{samples:samples.length});
        let sum=0;for(const sample of samples)sum+=sample*sample;this.onLevel(Math.sqrt(sum/samples.length));
        this.worker.postMessage({type:'audio',session:this.session,epoch:this.epoch,sampleRate:context.sampleRate,samples},[samples.buffer]);
      };
      this.input.connect(capture);capture.connect(context.destination);
      if(context.state!=='running')context.resume().catch(()=>{if(current())this.reportInputState();});
      if(tracks.some(track=>track.readyState==='ended'))throw this.microphoneEnded('graph');
      this.stage='running';this.log('audio-graph-connected');return true;
    }
    reportInputState(){
      if(!this.recording||!this.media)return;
      const state=this.context?.state;
      this.onStatus({phase:state==='suspended'||state==='interrupted'?'suspended':this.media.getAudioTracks().some(track=>track.muted)?'muted':'listening'});
    }
    async resume(){
      const context=this.context;if(!this.recording||!context)return false;
      this.log('resume-request');await context.resume();if(context===this.context)this.reportInputState();return context.state==='running';
    }
    async recoverInput(token,media){
      if(token!==this.generation||this.media!==media||this.recovering)return;this.recovering=true;
      try{
        if(this.recoveries>=1||root.document?.visibilityState==='hidden')throw this.microphoneEnded();
        let permission;try{permission=await navigator.permissions?.query({name:'microphone'});}catch(_){}
        if(token!==this.generation)return;
        this.log('recovery-permission',{state:permission?.state||'unknown'});
        if(permission?.state==='denied')throw Object.assign(new Error('麦克风权限已被关闭'),{name:'NotAllowedError'});
        if(permission?.state==='prompt')throw this.microphoneEnded();
        this.recoveries++;this.onStatus({phase:'recovering'});this.detachInput();
        if(await this.connectInput(token))this.reportInputState();
      }catch(error){if(token===this.generation){this.log('recovery-failed',{code:error.code||error.name});this.stop();this.onError(error);}}
      finally{if(token===this.generation)this.recovering=false;}
    }
    async start({compatible=false}={}){
      const token=++this.generation,Context=root.AudioContext||root.webkitAudioContext;
      if(!navigator.mediaDevices?.getUserMedia||!Context||typeof Worker==='undefined')throw new Error('当前浏览器不支持持续收音，请使用新版 Chrome、Edge 或 Safari');
      try{
        if(!this.ready||this.draining){
          this.stage='model';this.onStatus({phase:'preparing'});await this.prepare();if(this.draining)await this.draining;
          if(token!==this.generation)return false;
          // Do not open a microphone after a long asynchronous model preparation.
          this.stage='awaiting-click';this.log('awaiting-connection-click');this.onStatus({phase:'awaiting-gesture'});return false;
        }
        this.mode=compatible?'compatible':'standard';this.blocks=0;this.recoveries=0;this.recovering=false;
        this.onStatus({phase:'permission'});
        if(!await this.connectInput(token))return false;
        this.session++;this.epoch=0;this.recording=true;this.worker.postMessage({type:'start',session:this.session,epoch:this.epoch});
        const context=this.context;
        context.onstatechange=()=>{if(token===this.generation&&this.context===context){this.log('context-state',{state:context.state});this.reportInputState();}};
        this.reportInputState();return true;
      }catch(error){if(token!==this.generation)return false;this.log('start-failed',{code:error.code||error.name,stage:this.stage});this.stop();throw error;}
    }
    async probe(duration=5000){
      const token=++this.generation;this.stage='probe';this.log('raw-probe-request');this.onStatus({phase:'probe-start'});
      // This isolated test deliberately does not create a model, AudioContext, or player.
      if(!navigator.mediaDevices?.getUserMedia)throw new Error('当前浏览器不支持麦克风采集，请更新浏览器');
      let media;try{media=await navigator.mediaDevices.getUserMedia({audio:true});}catch(error){if(token!==this.generation)return false;this.log('raw-probe-error',{name:error.name});throw error;}
      if(token!==this.generation){media.getTracks().forEach(t=>t.stop());return false;}
      const tracks=media.getAudioTracks();
      if(!tracks.length||tracks.some(t=>t.readyState==='ended')){media.getTracks().forEach(t=>t.stop());this.log('raw-probe-ended-on-open');throw this.microphoneEnded('probe-open',!tracks.length);}
      this.log('raw-probe-open');
      const passed=await new Promise(resolve=>{
        const finish=value=>{clearTimeout(timer);tracks.forEach(t=>t.removeEventListener('ended',ended));media.getTracks().forEach(t=>t.stop());this.cancelProbe=null;resolve(value);};
        const ended=()=>finish(false),timer=setTimeout(()=>finish(tracks.every(t=>t.readyState==='live')),duration);
        tracks.forEach(t=>t.addEventListener('ended',ended));this.cancelProbe=()=>finish(false);
      });
      if(token!==this.generation)return false;
      this.stage='probe-finished';this.log(passed?'raw-probe-passed':'raw-probe-ended');
      this.onStatus({phase:passed?'probe-passed':'probe-failed'});return passed;
    }
    stop(){
      this.generation++;this.cancelProbe?.();const wasRecording=this.recording;this.recording=false;
      if(this.ready&&wasRecording){this.draining=new Promise(resolve=>{this.resolveDrained=resolve;});this.worker?.postMessage({type:'stop',session:this.session});}
      this.detachInput();this.recovering=false;
      if(this.context){this.context.onstatechange=null;this.context.close().catch(()=>{});}this.context=null;
      if(!this.ready&&this.worker){this.worker.terminate();this.worker=null;this.rejectReady?.(new Error('已取消准备'));this.preparing=null;}
      return this.draining||Promise.resolve();
    }
    reset(){this.epoch++;if(this.ready)this.worker.postMessage({type:'reset',session:this.session,epoch:this.epoch});}
  }
  root.ContinuousAudio=ContinuousAudio;
  if(typeof module==='object'&&module.exports)module.exports={ContinuousAudio};
})(typeof window==='object'?window:this);
