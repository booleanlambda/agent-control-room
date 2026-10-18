// Independent behavioral oracle for an actual V28 production-style failure.
// Candidate code runs in a no-network, read-only Docker container.
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import vm from 'node:vm';

const stage=process.argv[2]||'public';
const sourcePath=process.argv[3];
if(!sourcePath)throw Error('CANDIDATE_PATH_REQUIRED');
const code=readFileSync(sourcePath,'utf8');
if(!code.includes('async function model(')||code.length<1500||code.length>13000)
 throw Error('CANDIDATE_SHAPE_INVALID');
const valid=(tokens=123,content='{"patch":"ok"}',finish='stop')=>({
 ok:true,status:200,json:async()=>({
 choices:[{finish_reason:finish,message:{content}}],
 usage:{total_tokens:tokens,prompt_tokens:42,completion_tokens:tokens-42}
 })
});
const cases={
 received:{phase:'level_1',reply:valid(),expectStatus:'received',expectTokens:123,expectFinish:'stop',mode:'return'},
 malformed:{phase:'repair_2',reply:valid(123,'{"broken":','stop'),expectStatus:'malformed_model_json',expectTokens:123,expectFinish:'stop',mode:'hold'},
 http_error:{phase:'repair_2',reply:{ok:false,status:503,json:async()=>({error:{message:'PRIVATE_CANARY'}})},expectStatus:'provider_http_error',expectTokens:null,expectFinish:null,mode:'hold'},
 timeout:{phase:'repair_2',throwError:Object.assign(new Error('PRIVATE_CANARY'),{name:'TimeoutError'}),expectStatus:'transport_timeout_or_abort',expectTokens:null,expectFinish:null,mode:'hold'},
 off_length:{phase:'level_2',reply:valid(234,'{','length'),expectStatus:'output_truncated_unconfirmed_fallback',expectTokens:234,expectFinish:'length',mode:'hold'},
 on_length:{phase:'repair_2',reply:valid(234,'{','length'),expectStatus:'budget_exhausted',expectTokens:234,expectFinish:'length',mode:'exhaustion'},
 nested_undici:{phase:'repair_2',throwError:Object.assign(new TypeError('PRIVATE_CANARY'),{cause:Object.assign(new Error('SECRET_URL'),{code:'UND_ERR_HEADERS_TIMEOUT'})}),expectStatus:'transport_timeout_or_abort',expectTokens:null,expectFinish:null,mode:'hold'},
 ledger_fail:{phase:'level_0',reply:valid(333),ledgerFail:true,expectStatus:null,expectTokens:null,expectFinish:null,mode:'hold'}
};
const selected=stage==='public'?['received','malformed','http_error','timeout']:
 stage==='hidden'?['off_length','on_length','nested_undici','ledger_fail']:
 stage==='all'?Object.keys(cases):[];
if(!selected.length)throw Error('INVALID_TEST_SELECTION');

async function exercise(key){
 const scenario=cases[key];
 const events={begin:[],finish:[],fetchCount:0};
 let finishWrites=0;
 const state={providerCalls:0,providerTokens:0};
 const report={thinkingRouting:[],thinkingExhaustions:[],providerCallDiagnostics:[],callCount:0,providerTokens:0};
 const db={
  beginCall:async(...args)=>{events.begin.push(args)},
  finishCall:async(...args)=>{events.finish.push(args);finishWrites++;
   if(scenario.ledgerFail)throw Error('PRIVATE_CANARY ledger offline')}
 };
 const digest=x=>createHash('sha256').update(String(x)).digest('hex');
 const context={
  modelCap:24,tokenCap:75000,outputReservationCap:150000,outputReservations:0,
  SYSTEM:'You are a bounded research model',kimiStageRequest:p=>({
   model:'kimi-k2.6',thinking:{type:p.startsWith('repair_')?'enabled':'disabled'},
   temperature:0.6,max_tokens:p.startsWith('repair_')?32768:4096,timeoutMs:9000
  }),
  kimiResponseAcceptable:(p,ch)=>ch?.finish_reason==='stop'&&
   typeof ch?.message?.content==='string'&&ch.message.content.trim().length>0,
  report,db,run:'frozen-research-run',digest,wait:async()=>{},lastStart:0,
  AbortController, setTimeout,clearTimeout,Date,Error,process:{env:{MOONSHOT_API_KEY:'DUMMY_ONLY'}},
  fetch:async()=>{events.fetchCount++;if(scenario.throwError)throw scenario.throwError;return scenario.reply},
  isKnownThinkingExhaustion:(p,c,ok)=>Boolean(ok&&p.startsWith('repair_')&&c?.finish_reason==='length'),
  THINKING_EXHAUSTED:Symbol.for('TEST_THINKING_EXHAUSTED'),
  result:null
 };
 // No mock expected patches are supplied to the candidate.
 vm.runInNewContext(code+'\nresult=model;',context,{timeout:5000});
 let value=null,hold=false;
 try{value=await context.result(scenario.phase,scenario.phase.startsWith('repair_')?1:0,state,{ticket:'actual-v28'},3100)}
 catch(e){hold=e?.message==='MODEL_REQUEST_MANUAL_HOLD';if(!hold)throw Error('UNSAFE_ERROR_LEAK_OR_WRONG_HOLD')}
 const last=events.finish.at(-1);
 const problems=[];
 if(events.begin.length!==1)problems.push('one durable presend expected');
 if(events.fetchCount!==1)problems.push('never auto resend paid request');
 if(events.finish.length!==1)problems.push('exactly one receipt write; no overwrite of ledger failure');
 if(scenario.mode==='hold'&&!hold)problems.push('must preserve manual hold');
 if(scenario.mode==='return'&&(hold||value?.patch!=='ok'))problems.push('valid response must return normal answer');
 if(scenario.mode==='exhaustion'&&(hold||value!==context.THINKING_EXHAUSTED))
  problems.push('confirmed ON length must use authorized exhaustion sentinel');
 const statusSafe=typeof last?.[3]==='string'&&/^[a-z][a-z0-9_]{0,63}$/.test(last[3])?last[3]:null;
 if(last&&scenario.expectStatus!==null&&last[3]!==scenario.expectStatus)
  problems.push('wrong failure category: '+(statusSafe??'redacted_invalid_status'));
 if(last&&scenario.expectStatus!==null&&last[4]!==scenario.expectTokens)problems.push('token receipt lost');
 if(last&&scenario.expectStatus!==null&&last[5]!==scenario.expectFinish)problems.push('finish reason lost');
 if(report.providerCallDiagnostics?.some(x=>JSON.stringify(x).includes('PRIVATE_CANARY')||JSON.stringify(x).includes('SECRET_URL')))
  problems.push('sensitive exception/provider details leaked into report');
 if(!scenario.ledgerFail&&scenario.mode==='hold'&&report.providerCallDiagnostics?.length<1)
  problems.push('missing sanitized diagnostic report on hold');
 if(scenario.ledgerFail&&events.finish.length!==1)problems.push('ledger commit ambiguity led to second write');
 return {case:key,passed:problems.length===0,problems,reportedStatus:statusSafe};
}
let failures=0;
for(const key of selected){
 // A model-generated exception may fail one case, but must not suppress
 // the other public cases or raw-stack-leak into feedback.
 let x;
 try{x=await exercise(key)}
 catch{x={case:key,passed:false,problems:['candidate exception during verification'],reportedStatus:null}}
 console.log(JSON.stringify(x));
 if(!x.passed)failures++;
}
console.log('AAU_REAL_BUG_TEST_SUMMARY='+JSON.stringify({suite:stage,cases:selected.length,passed:selected.length-failures,failed:failures}));
if(failures)process.exitCode=1;
