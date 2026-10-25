'use strict';
const fs=require('node:fs');
function warnings(input){
 const groups={};
 for(const line of input.split(/\r?\n/)){
  if(!/(?:warning:|npm warn deprecated|DeprecationWarning:)/i.test(line))continue;
  if(/\b(?:crypto|ssl)\/[\w./-]+:\d+:\d+: warning:/.test(line)){
   const m=line.match(/((?:crypto|ssl)\/[\w./-]+:\d+:\d+: warning: .*?)(?:\r?$)/);
   if(m)groups['openssl:'+m[1]]=(groups['openssl:'+m[1]]||0)+1;
  }else if(/src\/(?:common\/utf8\.h|wallet\/wallet2\.h|cryptonote_core\/blockchain\.cpp|p2p\/net_node\.inl|daemonizer\/windows_service\.cpp)/.test(line)){
   const m=line.match(/(src\/[\w./]+:\d+:\d+: warning: .*?)(?:\r?$)/);
   if(m)groups['crylo:'+m[1]]=(groups['crylo:'+m[1]]||0)+1;
  }else if(/npm warn deprecated/.test(line))groups['npm:'+line.replace(/^.*npm warn deprecated /,'').slice(0,100)]=(groups['npm:'+line.replace(/^.*npm warn deprecated /,'').slice(0,100)]||0)+1;
 }
 return groups;
}
function compare(oldText,newText){
 const old=warnings(oldText),now=warnings(newText);
 return {schema:1,classification:'WINDOWS_WARNING_REVIEW_ONLY',releaseFrozen:true,mayPublish:false,
 priorWarningLines:Object.values(old).reduce((a,b)=>a+b,0),
 currentWarningLines:Object.values(now).reduce((a,b)=>a+b,0),
 newDiagnostics:Object.keys(now).filter(k=>!(k in old)).map(k=>({key:k,count:now[k]})),
 preexistingDiagnostics:Object.keys(now).filter(k=>k in old).map(k=>({key:k,prior:old[k],current:now[k]})),
 notInCurrent:Object.keys(old).filter(k=>!(k in now)).map(k=>({key:k,prior:old[k]}))};
}
if(require.main===module){
 const [old,newer,out]=process.argv.slice(2);
 if(!old||!newer||!out)throw Error('Two logs and report path required');
 const result=compare(fs.readFileSync(old,'utf8'),fs.readFileSync(newer,'utf8'));
 fs.writeFileSync(out,JSON.stringify(result,null,2)+'\n',{flag:'wx'});
 console.log('new: '+result.newDiagnostics.length+' retained: '+result.preexistingDiagnostics.length+
  ' no longer present: '+result.notInCurrent.length);
 console.log('RELEASE FROZEN; warning report cannot authorize publication.');
}
module.exports={warnings,compare};
