const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {StreamingTranscript}=require('../streaming-transcript.js');
const root=path.resolve(__dirname,'..');

function harness({autoReady=true,autoDrain=true,sampleRate=48000,permission='granted',mediaError=null,endedOnOpen=false}={}){
  const nodes=new Map(),workers=[],captures=[],contexts=[],constraints=[],spoken=[],tracks=[],timers=new Map();let now=0,id=0,mediaRequests=0;
  function node(){const classes=new Set();const item={textContent:'',value:'',checked:true,dataset:{},attributes:{},classList:{toggle(name,on){on?classes.add(name):classes.delete(name)},add:n=>classes.add(n),remove:n=>classes.delete(n)},setAttribute(k,v){this.attributes[k]=v},append(n){this.textContent+=n.textContent},addEventListener(){},focus(){},querySelectorAll(){return toggles}};Object.defineProperty(item,'innerHTML',{set(){item.textContent=''}});return item;}
  const toggles=['simplified','traditional','cantonese'].map(mode=>({...node(),dataset:{mode}})),chips=Array.from({length:3},node);
  const query=s=>{if(!nodes.has(s))nodes.set(s,node());return nodes.get(s)};
  const document={documentElement:{dataset:{}},visibilityState:'visible',querySelector:query,querySelectorAll:s=>s==='.chip'?chips:[],createTextNode:text=>({textContent:text}),createElement:node,addEventListener(){}};
  class Worker{
    constructor(){workers.push(this);this.messages=[];this.terminated=false;}
    postMessage(data){this.messages.push(data);if(data.type==='init'&&autoReady)queueMicrotask(()=>this.onmessage({data:{type:'ready'}}));if(data.type==='stop'&&autoDrain)queueMicrotask(()=>this.onmessage({data:{type:'stopped',session:data.session}}));}
    terminate(){this.terminated=true}
    result(data){this.onmessage({data:{type:'result',session:1,epoch:0,segment:0,...data}})}
  }
  class AudioContext{
    constructor(options){this.options=options;this.sampleRate=sampleRate;this.state='running';this.audioWorklet={addModule:async()=>{}};this.destination={};contexts.push(this);}
    async resume(){this.state='running'} async close(){this.state='closed'}
    createMediaStreamSource(){return {connect(){},disconnect(){}}}
  }
  class AudioWorkletNode{
    constructor(){this.port={};captures.push(this);}connect(){}disconnect(){this.disconnected=true}
  }
  const navigator={permissions:{async query(){return {state:permission}}},mediaDevices:{async getUserMedia(request){mediaRequests++;constraints.push(request);if(mediaError)throw mediaError;const events=new Map();const track={stopped:false,readyState:endedOnOpen?'ended':'live',muted:false,stop(){this.stopped=true;this.readyState='ended'},addEventListener(name,fn){if(!events.has(name))events.set(name,new Set());events.get(name).add(fn)},removeEventListener(name,fn){events.get(name)?.delete(fn)},emit(name){if(name==='ended')this.readyState='ended';if(name==='mute')this.muted=true;if(name==='unmute')this.muted=false;for(const fn of [...events.get(name)||[]])fn()},getSettings(){return {sampleRate,channelCount:1}}};tracks.push(track);return {getTracks:()=>[track],getAudioTracks:()=>[track]};}}};
  const context=vm.createContext({document,navigator,Worker,AudioContext,AudioWorkletNode,queueMicrotask,
    SpeechRecognition:class{constructor(){throw new Error('legacy recognizer must never be started')}},
    speechSynthesis:{getVoices:()=>[{lang:'zh-CN',name:'Mandarin'},{lang:'zh-HK',name:'Cantonese'}],speak:u=>spoken.push(u),cancel(){},addEventListener(){}},
    SpeechSynthesisUtterance:class{constructor(text){this.text=text}},setTimeout(fn,delay=0){const key=++id;timers.set(key,{fn,due:now+delay});return key},clearTimeout:key=>timers.delete(key)});
  context.window=context;
  for(const file of ['opencc-full.js','streaming-transcript.js','continuous-audio.js'])vm.runInContext(fs.readFileSync(path.join(root,file),'utf8'),context);
  const inline=[...fs.readFileSync(path.join(root,'index.html'),'utf8').matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)].at(-1)[1];vm.runInContext(inline,context);
  return {query,workers,captures,contexts,constraints,tracks,spoken,context,get mediaRequests(){return mediaRequests},
    press:()=>query('#mobileMicBtn').onclick(),
    async click(){await query('#mobileMicBtn').onclick();if(query('#statusText').textContent==='语音已就绪，请点击连接麦克风')await query('#mobileMicBtn').onclick();},
    audio(samples=new Float32Array(1280)){captures.at(-1).port.onmessage({data:samples})},
    advance(ms){now+=ms;for(const [key,item]of [...timers])if(item.due<=now){timers.delete(key);item.fn()}},
    evaluate:code=>vm.runInContext(code,context)};
}

test('one minute of silence keeps one microphone stream and forwards every audio block',async()=>{
  const app=harness();await app.click();for(let i=0;i<750;i++){app.audio();app.advance(80)}
  assert.equal(app.mediaRequests,1);assert.equal(app.tracks[0].stopped,false);
  assert.equal(app.workers[0].messages.filter(m=>m.type==='audio').length,750);
  assert.equal(app.workers[0].messages.filter(m=>m.type==='start').length,1);
  assert.equal(app.workers[0].messages.filter(m=>m.type==='stop').length,0);
  assert.match(app.query('#statusText').textContent,/持续收音/);
});

test('recording and new translations continue while the preceding translation speaks',async()=>{
  const app=harness();await app.click();const worker=app.workers[0];
  worker.result({segment:0,text:'我哋而家去睇楼。',isFinal:true});assert.equal(app.spoken.length,1);
  for(let i=0;i<40;i++)app.audio(new Float32Array(1280).fill(.1));
  worker.result({segment:1,text:'呢个单位有两个房间。',isFinal:true});
  assert.equal(app.tracks[0].stopped,false);assert.equal(app.mediaRequests,1);
  assert.match(app.query('#source').value,/呢个单位/);assert.equal(app.workers[0].messages.filter(m=>m.type==='audio').length,40);
  assert.equal(app.spoken.length,1);app.spoken[0].onend();assert.equal(app.spoken.length,2);
});

test('partial text appears before eleven characters; a short final sentence is spoken promptly',async()=>{
  const app=harness();await app.click();app.workers[0].result({text:'唔该'});
  assert.equal(app.query('#source').value,'唔该');assert.equal(app.spoken.length,0);
  app.workers[0].result({text:'唔该',isFinal:true});assert.equal(app.spoken[0].text,'麻烦了');
});

test('legitimate repeated phrases in separate utterances are retained',()=>{
  const state=new StreamingTranscript();
  const first=state.push({segment:0,text:'電話54803752',isFinal:true});
  const second=state.push({segment:1,text:'電話54803752',isFinal:true});
  assert.deepEqual(first.speech,['電話54803752']);assert.deepEqual(second.speech,['電話54803752']);
  assert.equal(state.text(),'電話54803752\n電話54803752');
});

test('growing and revised hypotheses do not append repeated prefixes or repeat final speech',()=>{
  const state=new StreamingTranscript(),spoken=[];
  for(const text of ['嘉寶','嘉寶商用','嘉寶商業大廈1980年落成','嘉寶商業大廈1980年落成業主而家放租'])spoken.push(...state.push({segment:0,text}).speech);
  spoken.push(...state.push({segment:0,text:'嘉寶商業大廈1980年落成業主而家放租',isFinal:true}).speech);
  assert.equal(spoken.join(''),'嘉寶商業大廈1980年落成業主而家放租');
  assert.deepEqual(state.push({segment:0,text:'嘉寶商業大廈1980年落成業主而家放租',isFinal:true}).speech,[]);
});

test('stopping reading does not stop or restart microphone capture',async()=>{
  const app=harness();await app.click();app.workers[0].result({text:'今日天气好好。',isFinal:true});
  app.query('#stopSpeakBtn').onclick();app.audio();assert.equal(app.tracks[0].stopped,false);assert.equal(app.mediaRequests,1);
});

test('microphone stop drains the tail before another session starts',async()=>{
  const app=harness({autoDrain:false});await app.click();app.click();
  assert.equal(app.tracks[0].stopped,true);const restarting=app.click();await new Promise(resolve=>setImmediate(resolve));assert.equal(app.mediaRequests,1);
  app.workers[0].result({text:'最后一句唔好漏。',isFinal:true});app.workers[0].onmessage({data:{type:'stopped',session:1}});await restarting;
  assert.match(app.query('#source').value,/最后一句/);assert.equal(app.mediaRequests,2);
});

test('canceling first preparation never opens an audio context or microphone',async()=>{
  const app=harness({autoReady:false});const starting=app.click();await new Promise(resolve=>setImmediate(resolve));app.click();await starting;
  assert.equal(app.mediaRequests,0);assert.equal(app.contexts.length,0);assert.equal(app.workers[0].terminated,true);assert.equal(app.evaluate('listening'),false);
});

test('a failed model download can be retried with a fresh worker',async()=>{
  const app=harness({autoReady:false});const first=app.click();await new Promise(resolve=>setImmediate(resolve));app.workers[0].onmessage({data:{type:'error',message:'下载失败'}});await first;
  const retry=app.click();await new Promise(resolve=>setImmediate(resolve));app.workers[1].onmessage({data:{type:'ready'}});await retry;
  assert.equal(app.mediaRequests,1);assert.equal(app.workers.length,2);
});

test('canceling immediately terminates preparation without requesting the microphone',async()=>{
  const app=harness({autoReady:false});const pending=app.click();app.click();await pending;
  assert.equal(app.workers[0].terminated,true);assert.equal(app.mediaRequests,0);
});

test('preparing the model never silently opens hardware; the next click requests it synchronously',async()=>{
  const app=harness();await app.press();
  assert.equal(app.mediaRequests,0);assert.equal(app.contexts.length,0);assert.equal(app.evaluate('listening'),false);
  assert.match(app.query('#statusText').textContent,/点击连接麦克风/);
  const connection=app.press();assert.equal(app.mediaRequests,1);assert.equal(app.contexts.length,0);
  await connection;assert.equal(app.contexts.length,1);
});
test('compatible input explicitly disables the communication audio processing constraints',async()=>{
  const app=harness();app.query('#compatibleMic').checked=true;await app.click();
  assert.equal(app.constraints[0].audio.echoCancellation,false);
  assert.equal(app.constraints[0].audio.noiseSuppression,false);
  assert.equal(app.constraints[0].audio.autoGainControl,false);
  assert.equal(app.constraints[0].audio.channelCount,undefined);
});
test('raw microphone probe holds one input for five seconds with no model, graph, or playback',async()=>{
  const app=harness();const probe=app.query('#testMicBtn').onclick();await settle();
  assert.equal(app.mediaRequests,1);assert.equal(app.constraints[0].audio,true);
  assert.equal(app.workers.length,0);assert.equal(app.contexts.length,0);assert.equal(app.spoken.length,0);
  app.advance(5000);await probe;
  assert.equal(app.tracks[0].stopped,true);assert.match(app.query('#statusText').textContent,/检测通过/);
});
test('raw probe identifies an independent device end, without reconnecting',async()=>{
  const app=harness();const probe=app.query('#testMicBtn').onclick();await settle();app.tracks[0].emit('ended');await probe;
  assert.equal(app.mediaRequests,1);assert.equal(app.contexts.length,0);assert.match(app.query('#statusText').textContent,/也被中断/);
  assert.match(app.query('#micDiagnosticText').textContent,/raw-probe-ended/);
});
test('stopping a raw probe promptly releases the input and cancels its timer',async()=>{
  const app=harness();const probe=app.evaluate('audio.probe()');await settle();app.evaluate('audio.stop()');await probe;
  assert.equal(app.tracks[0].stopped,true);assert.equal(app.mediaRequests,1);
});
test('an ended-on-open track is distinguished from an ended graph and never creates Web Audio',async()=>{
  const app=harness({endedOnOpen:true});await app.click();
  assert.match(app.query('#micIssueText').textContent,/MIC_ENDED_OPEN/);assert.equal(app.contexts.length,0);
});
test('a device ended while loading the audio module is diagnosed as a pipeline-stage failure',async()=>{
  const app=harness();const NativeContext=app.context.AudioContext;
  app.context.AudioContext=class extends NativeContext{constructor(options){super(options);this.audioWorklet.addModule=async()=>app.tracks[0].emit('ended');}};
  await app.click();assert.match(app.query('#micIssueText').textContent,/MIC_ENDED_WORKLET/);
  assert.match(app.query('#micDiagnosticText').textContent,/track-ended/);assert.equal(app.evaluate('audio.recording'),false);
});
test('diagnostic export contains connection metadata but no private transcript or device identifier',async()=>{
  const app=harness();await app.click();app.workers[0].result({text:'私人识别内容54803752',isFinal:true});app.audio();
  const diagnostics=app.evaluate('audio.diagnosticText()');
  assert.match(diagnostics,/first-audio-block/);assert.doesNotMatch(diagnostics,/私人|54803752|deviceId|groupId/);
});

test('late events from a canceled worker cannot mark a retry ready',async()=>{
  const app=harness({autoReady:false});const first=app.click();await new Promise(resolve=>setImmediate(resolve));app.click();await first;
  const retry=app.click();await new Promise(resolve=>setImmediate(resolve));app.workers[0].onmessage({data:{type:'ready'}});
  await new Promise(resolve=>setImmediate(resolve));assert.equal(app.mediaRequests,0);
  app.workers[1].onmessage({data:{type:'ready'}});await retry;assert.equal(app.mediaRequests,1);
});

test('clear rejects delayed results from the previous transcript epoch',async()=>{
  const app=harness();await app.click();app.workers[0].result({text:'旧内容',isFinal:true});app.query('#clearBtn').onclick();
  app.workers[0].result({text:'不应该重新出现的旧内容',isFinal:true});assert.equal(app.query('#source').value,'');
  app.workers[0].result({epoch:1,segment:1,text:'新的话',isFinal:true});assert.equal(app.query('#source').value,'新的话');
});

test('a finalized sentence is read intact rather than cut into another eleven-character block',()=>{
  const state=new StreamingTranscript();const text='有无人知道金钟天马街系点去';
  assert.deepEqual(state.push({segment:0,text,isFinal:true}).speech,[text]);
});

test('finishing playback updates the status without changing microphone capture',async()=>{
  const app=harness();await app.click();app.workers[0].result({text:'今日天气好好。',isFinal:true});app.spoken[0].onend();
  assert.equal(app.query('#statusText').textContent,'持续收音·等待说话');assert.equal(app.tracks[0].stopped,false);
  assert.equal(app.evaluate("translateCantoneseToMandarin('有无人知道呢度系点去')"),'有没有人知道这里怎么去');
});

const settle=()=>new Promise(resolve=>setImmediate(resolve));
test('microphone and Web Audio use the native device rate, forwarded for worker resampling',async()=>{
  for(const sampleRate of [44100,48000]){
    const app=harness({sampleRate});await app.click();app.audio();
    assert.equal(app.contexts[0].options.sampleRate,undefined);
    assert.equal(app.constraints[0].audio.sampleRate,undefined);
    assert.equal(app.workers[0].messages.at(-1).sampleRate,sampleRate);
  }
});
test('an unexpected device end recovers once without resetting the recognizer or speech queue',async()=>{
  const app=harness();await app.click();app.workers[0].result({text:'今日天气好好。',isFinal:true});
  app.tracks[0].emit('ended');await settle();app.audio();
  assert.equal(app.mediaRequests,2);assert.equal(app.evaluate('audio.recording'),true);
  assert.equal(app.workers[0].messages.filter(m=>m.type==='start').length,1);
  assert.equal(app.workers[0].messages.filter(m=>m.type==='stop').length,0);
  assert.equal(app.spoken.length,1);assert.equal(app.contexts.length,1);
  app.tracks[1].emit('ended');await settle();
  assert.equal(app.mediaRequests,2);assert.equal(app.evaluate('audio.recording'),false);
  assert.equal(app.query('#micIssue').hidden,false);assert.match(app.query('#micIssueText').textContent,/MIC_ENDED/);
});
test('late audio and ended events from the previous capture cannot affect a new session',async()=>{
  const app=harness();await app.click();const lateAudio=app.captures[0].port.onmessage;
  await app.click();await app.click();app.tracks[0].emit('ended');await settle();
  const before=app.workers[0].messages.filter(m=>m.type==='audio').length;
  lateAudio({data:new Float32Array(1280)});
  assert.equal(app.workers[0].messages.filter(m=>m.type==='audio').length,before);
  assert.equal(app.evaluate('audio.recording'),true);assert.equal(app.tracks[1].stopped,false);
});
test('temporary device mute does not reopen the microphone, and unmute restores listening',async()=>{
  const app=harness();await app.click();app.tracks[0].emit('mute');
  assert.match(app.query('#statusText').textContent,/暂时/);assert.equal(app.mediaRequests,1);
  app.tracks[0].emit('unmute');assert.match(app.query('#statusText').textContent,/持续收音/);
});
test('revoked permission stops once with a persistent actionable message, without prompting in a loop',async()=>{
  const app=harness({permission:'denied'});await app.click();app.tracks[0].emit('ended');await settle();
  assert.equal(app.mediaRequests,1);assert.equal(app.query('#micIssue').hidden,false);
  assert.match(app.query('#micIssueText').textContent,/权限/);assert.equal(app.evaluate('audio.recording'),false);
});
test('a microphone that is already ended never becomes falsely connected',async()=>{
  const app=harness({endedOnOpen:true});await app.click();
  assert.equal(app.evaluate('audio.recording'),false);assert.equal(app.query('#micIssue').hidden,false);
  assert.match(app.query('#micIssueText').textContent,/MIC_ENDED/);
});
test('permission and busy-device failures have distinct persistent instructions',async()=>{
  for(const [name,expected]of [['NotAllowedError',/权限/],['NotReadableError',/占用/]]){
    const app=harness({mediaError:Object.assign(new Error('native error'),{name})});await app.click();
    assert.equal(app.query('#micIssue').hidden,false);assert.match(app.query('#micIssueText').textContent,expected);
    assert.equal(app.contexts.length,0);
  }
});
test('interrupted audio resumes the same context and stream from the recovery button',async()=>{
  const app=harness();await app.click();const ctx=app.contexts[0];ctx.state='interrupted';ctx.onstatechange();
  assert.equal(app.query('#micIssue').hidden,false);await app.query('#retryMicBtn').onclick();
  assert.equal(ctx.state,'running');assert.equal(app.mediaRequests,1);assert.equal(app.contexts.length,1);
});
test('a late getUserMedia rejection after cancel cannot stop the next successful session',async()=>{
  const app=harness();let reject;
  app.context.navigator.mediaDevices.getUserMedia=()=>new Promise((_,fail)=>{reject=fail});
  const pending=app.click();await settle();await app.click();
  app.context.navigator.mediaDevices.getUserMedia=async()=>({getTracks:()=>[],getAudioTracks:()=>[{readyState:'live',addEventListener(){},removeEventListener(){}}]});
  await app.click();reject(Object.assign(new Error('late error'),{name:'NotAllowedError'}));await pending;
  assert.equal(app.evaluate('audio.recording'),true);assert.equal(app.evaluate('listening'),true);
  assert.equal(app.query('#micIssue').hidden,true);
});
test('device interruption while hidden stops without automatically reopening the microphone',async()=>{
  const app=harness();await app.click();app.context.document.visibilityState='hidden';app.tracks[0].emit('ended');await settle();
  assert.equal(app.mediaRequests,1);assert.equal(app.evaluate('audio.recording'),false);
});
test('capture worklet batches eighty milliseconds at the actual device sample rate',()=>{
  for(const rate of [16000,44100,48000]){
    const output=[];let Processor;
    const ctx=vm.createContext({sampleRate:rate,AudioWorkletProcessor:class{constructor(){this.port={postMessage:data=>output.push(data)}}},registerProcessor:(_,value)=>{Processor=value}});
    vm.runInContext(fs.readFileSync(path.join(root,'capture-worklet.js'),'utf8'),ctx);
    const processor=new Processor();const data=new Float32Array(Math.round(rate*.16)).fill(.25),silent=new Float32Array(128).fill(1);
    processor.process([[data]],[[silent]]);assert.equal(output.length,2);assert.equal(output[0].length,Math.round(rate*.08));
    assert.equal(output[0][0],.25);assert.equal(silent.some(Boolean),false);
  }
});
test('worker resampling preserves timing and continuity for native 44.1 and 48 kHz blocks',()=>{
  for(const rate of [44100,48000]){
    const fresh=()=>{const ctx=vm.createContext({self:{},Float32Array});vm.runInContext(fs.readFileSync(path.join(root,'recognition-worker.js'),'utf8'),ctx);return ctx};
    const whole=fresh(),chunked=fresh(),input=Float32Array.from({length:rate},(_,i)=>Math.sin(2*Math.PI*440*i/rate));
    whole.input=input;whole.rate=rate;const expected=vm.runInContext('resample(input,rate)',whole),actual=[];
    for(let i=0;i<input.length;i+=1280){chunked.input=input.subarray(i,i+1280);chunked.rate=rate;actual.push(...vm.runInContext('resample(input,rate)',chunked));}
    assert.ok(Math.abs(actual.length-16000)<=1);assert.equal(actual.length,expected.length);
    assert.ok(actual.every((value,i)=>Math.abs(value-expected[i])<.00001));
  }
});
