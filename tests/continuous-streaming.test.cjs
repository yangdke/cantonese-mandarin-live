const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {StreamingTranscript}=require('../streaming-transcript.js');
const root=path.resolve(__dirname,'..');

function harness({autoReady=true,autoDrain=true}={}){
  const nodes=new Map(),workers=[],captures=[],spoken=[],tracks=[],timers=new Map();let now=0,id=0,mediaRequests=0;
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
    constructor(){this.sampleRate=16000;this.state='running';this.audioWorklet={addModule:async()=>{}};this.destination={};}
    async resume(){this.state='running'} async close(){this.state='closed'}
    createMediaStreamSource(){return {connect(){},disconnect(){}}}
  }
  class AudioWorkletNode{
    constructor(){this.port={};captures.push(this);}connect(){}disconnect(){this.disconnected=true}
  }
  const navigator={mediaDevices:{async getUserMedia(){mediaRequests++;const track={stopped:false,stop(){this.stopped=true},addEventListener(){}};tracks.push(track);return {getTracks:()=>[track],getAudioTracks:()=>[track]};}}};
  const context=vm.createContext({document,navigator,Worker,AudioContext,AudioWorkletNode,queueMicrotask,
    SpeechRecognition:class{constructor(){throw new Error('legacy recognizer must never be started')}},
    speechSynthesis:{getVoices:()=>[{lang:'zh-CN',name:'Mandarin'},{lang:'zh-HK',name:'Cantonese'}],speak:u=>spoken.push(u),cancel(){},addEventListener(){}},
    SpeechSynthesisUtterance:class{constructor(text){this.text=text}},setTimeout(fn,delay=0){const key=++id;timers.set(key,{fn,due:now+delay});return key},clearTimeout:key=>timers.delete(key)});
  context.window=context;
  for(const file of ['opencc-full.js','streaming-transcript.js','continuous-audio.js'])vm.runInContext(fs.readFileSync(path.join(root,file),'utf8'),context);
  const inline=[...fs.readFileSync(path.join(root,'index.html'),'utf8').matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)].at(-1)[1];vm.runInContext(inline,context);
  return {query,workers,captures,tracks,spoken,context,get mediaRequests(){return mediaRequests},
    click:()=>query('#mobileMicBtn').onclick(),
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

test('canceling first preparation releases the context without opening a microphone',async()=>{
  const app=harness({autoReady:false});const starting=app.click();await new Promise(resolve=>setImmediate(resolve));app.click();await starting;
  assert.equal(app.mediaRequests,0);assert.equal(app.workers[0].terminated,true);assert.equal(app.evaluate('listening'),false);
});

test('a failed model download can be retried with a fresh worker',async()=>{
  const app=harness({autoReady:false});const first=app.click();await new Promise(resolve=>setImmediate(resolve));app.workers[0].onmessage({data:{type:'error',message:'下载失败'}});await first;
  const retry=app.click();await new Promise(resolve=>setImmediate(resolve));app.workers[1].onmessage({data:{type:'ready'}});await retry;
  assert.equal(app.mediaRequests,1);assert.equal(app.workers.length,2);
});

test('canceling immediately does not begin a model download',async()=>{
  const app=harness({autoReady:false});const pending=app.click();app.click();await pending;
  assert.equal(app.workers.length,0);assert.equal(app.mediaRequests,0);
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
