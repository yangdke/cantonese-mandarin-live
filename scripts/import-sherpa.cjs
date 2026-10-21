// Import pinned upstream release assets; large model data is split for GitHub Pages.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const source=process.argv[2],root=process.argv[3]?path.resolve(process.argv[3]):path.resolve(__dirname,'..');
fs.mkdirSync(path.join(root,'vendor'),{recursive:true});fs.mkdirSync(path.join(root,'models'),{recursive:true});
for(const name of ['sherpa-onnx-asr.js','sherpa-onnx-wasm-main-asr.js','sherpa-onnx-wasm-main-asr.wasm'])fs.copyFileSync(path.join(source,name),path.join(root,'vendor',name));
const data=fs.readFileSync(path.join(source,'sherpa-onnx-wasm-main-asr.data')),size=32*1024*1024,parts=[];
for(let offset=0,index=1;offset<data.length;offset+=size,index++){
  const bytes=data.subarray(offset,Math.min(offset+size,data.length)),name=`paraformer-${index}.bin`;
  fs.writeFileSync(path.join(root,'models',name),bytes);parts.push({name,bytes:bytes.length,sha256:crypto.createHash('sha256').update(bytes).digest('hex')});
}
fs.writeFileSync(path.join(root,'vendor','asr-assets.json'),JSON.stringify({version:'1.12.28',model:'streaming-paraformer-trilingual-zh-cantonese-en',origin:'https://github.com/k2-fsa/sherpa-onnx/releases/tag/v1.12.28',bytes:data.length,parts},null,2)+'\n');
console.log(JSON.stringify({modelBytes:data.length,parts:parts.length,vendorVersion:'1.12.28'}));
