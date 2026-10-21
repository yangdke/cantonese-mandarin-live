// Replays a local 16 kHz mono f32le file through the actual production worker.
// Audio stays local; only timing and transcript lengths are printed.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {fileURLToPath,pathToFileURL}=require('node:url');
const {performance}=require('node:perf_hooks');
const root=path.resolve(__dirname,'..'),pcm=fs.readFileSync(process.argv[2]);
const samples=new Float32Array(pcm.buffer.slice(pcm.byteOffset,pcm.byteOffset+pcm.length));
const captureRate=Number(process.argv.find(arg=>arg.startsWith('--capture-rate='))?.split('=')[1]||16000);
if(![16000,44100,48000].includes(captureRate))throw new Error('capture rate must be 16000, 44100 or 48000');
const captureSamples=captureRate===16000?samples:Float32Array.from({length:Math.floor(samples.length*captureRate/16000)},(_,i)=>{const position=i*16000/captureRate,left=Math.floor(position),fraction=position-left;return samples[left]*(1-fraction)+(samples[left+1]??samples[left])*fraction;});
const results=[];let firstResult=null,audioOffset=0,stopped=false;
const started=performance.now();
const context=vm.createContext({console,setTimeout,clearTimeout,URL,performance,
  fetch:async url=>new Response(fs.readFileSync(fileURLToPath(url))),
  postMessage(data){
    if(data.type==='error'){console.error(data.message);process.exitCode=1;}
    if(data.type==='ready')setTimeout(replay,0);
    if(data.type==='result'){results.push(data);if(data.text&&firstResult===null)firstResult=audioOffset/captureRate;}
    if(data.type==='stopped')stopped=true;
  },
  importScripts(...urls){for(const url of urls)vm.runInContext(fs.readFileSync(path.join(root,url),'utf8'),context,{filename:url});}
});
context.self=context;context.location=pathToFileURL(path.join(root,'recognition-worker.js'));
function replay(){
  const initialization=(performance.now()-started)/1000,t=performance.now();
  context.onmessage({data:{type:'start',session:1,epoch:0}});
  const blockSize=Math.round(captureRate*.08);
  for(let offset=0;offset<captureSamples.length;offset+=blockSize){const chunk=captureSamples.subarray(offset,offset+blockSize);audioOffset=offset+chunk.length;context.onmessage({data:{type:'audio',session:1,epoch:0,sampleRate:captureRate,samples:chunk}});}
  context.onmessage({data:{type:'stop',session:1}});
  const duration=samples.length/16000,decode=(performance.now()-t)/1000;
  console.log(JSON.stringify({captureRate,initializationSeconds:initialization,audioSeconds:duration,firstTextAtAudioSeconds:firstResult,decodeSeconds:decode,realTimeFactor:decode/duration,finalSegments:results.filter(r=>r.isFinal&&r.text).length,characters:results.filter(r=>r.isFinal).map(r=>r.text).join('').length,tailDrained:stopped}));
  if(process.argv.includes('--show-text'))console.log(results.filter(r=>r.isFinal).map(r=>r.text).join('\n'));
  if(!stopped||!firstResult)process.exitCode=1;
}
vm.runInContext(fs.readFileSync(path.join(root,'recognition-worker.js'),'utf8'),context,{filename:'recognition-worker.js'});
context.onmessage({data:{type:'init'}});
