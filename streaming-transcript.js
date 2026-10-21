(function(root){
  'use strict';
  const compact=text=>Array.from(text).filter(c=>!/[\s，。！？；、,.!?：:“”"'‘’（）()\-]/.test(c)).join('');
  function commonPrefix(a,b){let n=0;while(n<a.length&&n<b.length&&a[n]===b[n])n++;return b.slice(0,n)}
  function prefixPosition(text,count){let n=0,pos=0;for(const ch of text){pos+=ch.length;if(compact(ch)&&++n===count)return pos}return text.length}
  class StreamingTranscript{
    constructor(base=''){this.base=base;this.segments=new Map();this.firstSpoken=false;}
    push({segment,text='',isFinal=false}){
      let entry=this.segments.get(segment);
      if(entry?.final)return {text:this.text(),speech:[]};
      if(!entry){entry={text:'',consumed:0,final:false};this.segments.set(segment,entry)}
      const previous=entry.text;entry.text=text.trim();
      const stable=isFinal?entry.text:commonPrefix(previous,entry.text);
      const speech=[];
      let start=prefixPosition(stable,entry.consumed);
      if(!entry.consumed)start=0;
      if(!this.firstSpoken&&!isFinal&&compact(stable.slice(start)).length>=11){
        const end=start+prefixPosition(stable.slice(start),11);
        speech.push(stable.slice(start,end).trim());entry.consumed=compact(stable.slice(0,end)).length;start=end;this.firstSpoken=true;
      }
      if(this.firstSpoken){
        const rest=stable.slice(start),punctuation=/[，。！？；,.!?;]/g;
        let match,last=0;
        while((match=punctuation.exec(rest))){const end=match.index+1,chunk=rest.slice(last,end).trim();if(compact(chunk))speech.push(chunk);last=end;}
        if(last){entry.consumed+=compact(rest.slice(0,last)).length;start+=last;}
      }
      if(isFinal){
        const tail=entry.text.slice(entry.consumed?prefixPosition(entry.text,entry.consumed):0).trim();
        if(compact(tail)){speech.push(tail);this.firstSpoken=true;}
        entry.consumed=compact(entry.text).length;entry.final=true;
      }
      return {text:this.text(),speech};
    }
    text(){return [this.base,...Array.from(this.segments.values(),entry=>entry.text)].filter(Boolean).join('\n')}
  }
  if(typeof module==='object'&&module.exports)module.exports={StreamingTranscript};
  else root.StreamingTranscript=StreamingTranscript;
})(typeof window==='object'?window:this);
