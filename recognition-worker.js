'use strict';
var Module;
let recognizer=null,stream=null,session=0,segment=0,lastText='',ready=false,epoch=0;
let resamplePosition=0,resampleTail=new Float32Array(0);
const MODEL_BYTES=238509671,PART_BYTES=32*1024*1024;
const progress=(loaded,total)=>postMessage({type:'progress',loaded,total,percent:Math.floor(loaded/total*100)});

async function cached(url,expectedSize,report){
  let cache=null;try{cache=await caches.open('cantonese-streaming-v1.12.28');}catch(_){}
  let response=cache&&await cache.match(url);
  if(!response){response=await fetch(url);if(!response.ok)throw new Error('识别文件下载失败，请检查网络后重试');}
  const data=new Uint8Array(expectedSize),reader=response.body?.getReader();let loaded=0;
  if(reader){while(true){const item=await reader.read();if(item.done)break;if(loaded+item.value.length>expectedSize)throw new Error('识别文件大小不正确');data.set(item.value,loaded);loaded+=item.value.length;report?.(loaded);}}
  else{const buffer=new Uint8Array(await response.arrayBuffer());data.set(buffer);loaded=buffer.length;report?.(loaded);}
  if(loaded!==expectedSize)throw new Error('识别文件尚未下载完整，请重试');
  if(cache){try{await cache.put(url,new Response(data));}catch(_){postMessage({type:'cache-warning'});}}
  return data;
}

async function initialize(){
  try{
    const bytes=new Uint8Array(MODEL_BYTES),parts=Math.ceil(MODEL_BYTES/PART_BYTES);
    for(let i=0;i<parts;i++){
      const offset=i*PART_BYTES,length=Math.min(PART_BYTES,MODEL_BYTES-offset);
      const part=await cached(new URL(`models/paraformer-${i+1}.bin`,self.location.href).href,length,n=>progress(offset+n,MODEL_BYTES+11547794));bytes.set(part,offset);
    }
    const wasm=await cached(new URL('vendor/sherpa-onnx-wasm-main-asr.wasm',self.location.href).href,11547794,n=>progress(MODEL_BYTES+n,MODEL_BYTES+11547794));
    Module={
      wasmBinary:wasm,getPreloadedPackage:()=>bytes.buffer,
      print:()=>{},printErr:()=>{},onAbort:()=>postMessage({type:'error',message:'手机内存不足或不支持本地识别，请关闭其他页面后重试'}),
      onRuntimeInitialized(){
        try{
          const config={featConfig:{sampleRate:16000,featureDim:80},modelConfig:{paraformer:{encoder:'./encoder.onnx',decoder:'./decoder.onnx'},tokens:'./tokens.txt',numThreads:1,provider:'cpu',debug:0,modelType:'paraformer',modelingUnit:'cjkchar'},decodingMethod:'greedy_search',maxActivePaths:4,enableEndpoint:1,rule1MinTrailingSilence:2.4,rule2MinTrailingSilence:0.65,rule3MinUtteranceLength:20,hotwordsFile:'',hotwordsScore:1.5,ctcFstDecoderConfig:{graph:'',maxActive:3000},ruleFsts:'',ruleFars:''};
          recognizer=createOnlineRecognizer(Module,config);if(!recognizer.handle)throw new Error('本地粤语模型初始化失败');
          ready=true;postMessage({type:'ready'});
        }catch(error){postMessage({type:'error',message:error.message});}
      }
    };
    importScripts('vendor/sherpa-onnx-asr.js','vendor/sherpa-onnx-wasm-main-asr.js');
  }catch(error){postMessage({type:'error',message:error.message});}
}

function resetStream(){stream?.free();stream=recognizer.createStream();lastText='';resamplePosition=0;resampleTail=new Float32Array(0);}
function emit(isFinal=false){const text=recognizer.getResult(stream).text.trim();if(text!==lastText||isFinal){lastText=text;postMessage({type:'result',session,epoch,segment,text,isFinal});}}
function decode(){while(recognizer.isReady(stream))recognizer.decode(stream);emit();if(recognizer.isEndpoint(stream)){emit(true);segment++;recognizer.reset(stream);lastText='';}}
function resample(samples,rate){
  if(rate===16000)return samples;
  const input=new Float32Array(resampleTail.length+samples.length);input.set(resampleTail);input.set(samples,resampleTail.length);
  const ratio=rate/16000,out=[];
  while(resamplePosition+1<input.length){const left=Math.floor(resamplePosition),fraction=resamplePosition-left;out.push(input[left]*(1-fraction)+input[left+1]*fraction);resamplePosition+=ratio;}
  const used=Math.min(Math.floor(resamplePosition),input.length);resampleTail=input.slice(used);resamplePosition-=used;return new Float32Array(out);
}
self.onmessage=({data})=>{
  try{
    if(data.type==='init'){initialize();return;}
    if(!ready)return;
    if(data.type==='start'){session=data.session;epoch=data.epoch;segment=0;resetStream();return;}
    if(data.session!==session||!stream)return;
    if(data.type==='audio'&&data.epoch===epoch){stream.acceptWaveform(16000,resample(data.samples,data.sampleRate));decode();}
    else if(data.type==='stop'){stream.acceptWaveform(16000,new Float32Array(16000));stream.inputFinished();decode();emit(true);stream.free();stream=null;postMessage({type:'stopped',session});}
    else if(data.type==='reset'){epoch=data.epoch;segment++;resetStream();}
  }catch(error){postMessage({type:'error',message:error.message});}
};
