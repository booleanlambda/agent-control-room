// Isolated, strictly serial, one-worker Kimi exercise. Never touches AAU production.
// Any provider admission failure, incomplete response, or ambiguous timeout => manual_hold.
import {writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {publicProblem,hiddenProblems,grade,specification,hash} from './benchmark.mjs';
import {runIsolatedPython} from '../recursion-tree-v0/unseen-python-sandbox.mjs';

if(process.env.GITHUB_ACTIONS!=='true'||process.env.AAU_PYTHON_SANDBOX!=='yes'||process.env.AAU_SOLO_REAL_KIMI!=='yes')throw Error('NOT_AUTHORIZED_CI_ONLY');
const key=String(process.env.MOONSHOT_API_KEY||'').trim();
if(!key)throw Error('MOONSHOT_SECRET_UNAVAILABLE');
const resultsFile='solo-logistics-evidence.json';
const report={id:'AAU_SOLO_LOGISTICS_V1',scope:'isolated_research_only',model:'kimi-k2.6',thinking:'disabled',
 branchStyle:'single_serial_worker_no_parallel_calls',status:'running',providerCalls:0,providerReportedTokens:0,
 globalCallCeiling:4,tokenCeiling:32000,callHistory:[],nodes:[],publicInputHash:hash(publicProblem),
 hiddenInputHashes:hiddenProblems.map(hash),noAutomaticProviderRetries:true,
 limitations:['No provider-wide lock; other applications may use same account','No across-GitHub-reruns billing idempotency']};
const save=()=>writeFileSync(resultsFile,JSON.stringify(report,null,2)+'\n');
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
let lastTime=0;
const SYSTEM='Return only compact valid JSON with no code fences. Do not claim you have run code. All decisions and Python source must be authored by you; hidden cases are unknown.';
async function query(stage,messages,maxTokens){
 if(report.providerCalls>=report.globalCallCeiling||report.providerReportedTokens>=report.tokenCeiling){report.status='budget_exhausted';save();return null;}
 const conservativeReserve=Math.ceil(JSON.stringify(messages).length/2)+maxTokens;
 const reserved=(report.reserveUnits??0)+conservativeReserve;
 if(reserved>48000){report.status='reservation_exhausted';save();return null;}
 const delay=Math.max(0,lastTime+23000-Date.now());if(delay)await pause(delay);
 lastTime=Date.now();const entry={stage,status:'request_in_flight',maxTokens,reserveUnits:conservativeReserve,startedAt:new Date().toISOString()};
 report.callHistory.push(entry);report.providerCalls++;report.reserveUnits=reserved;save(); // Commit attempt before HTTP send.
 const ctrl=new AbortController(),timer=setTimeout(()=>ctrl.abort(),175000);
 try{
  const resp=await fetch('https://api.moonshot.ai/v1/chat/completions',{method:'POST',redirect:'manual',signal:ctrl.signal,
   headers:{authorization:'Bearer '+key,'content-type':'application/json',accept:'application/json'},
   body:JSON.stringify({model:'kimi-k2.6',thinking:{type:'disabled'},temperature:0.6,max_tokens:maxTokens,
    response_format:{type:'json_object'},stream:false,messages:[{role:'system',content:SYSTEM},...messages]})});
  const packet=await resp.json().catch(()=>({}));
  entry.http=resp.status;
  const used=packet?.usage?.total_tokens;
  if(Number.isSafeInteger(used)&&used>=0){report.providerReportedTokens+=used;entry.reportedTokens=used;}
  const choice=packet?.choices?.[0];entry.finish=choice?.finish_reason??null;
  if(!resp.ok){entry.status='rejected';entry.reason=resp.status===429?'provider_account_concurrency_or_rate_limit':'provider_http_'+resp.status;report.status='manual_hold';save();return null;}
  if(entry.finish!=='stop'||choice?.message?.reasoning_content){entry.status='incomplete';entry.reason='truncated_or_unexpected_thinking';report.status='manual_hold';save();return null;}
  const raw=choice?.message?.content;
  if(typeof raw!=='string'||!raw.trim()){entry.status='incomplete';entry.reason='empty_response';report.status='manual_hold';save();return null;}
  let decoded;try{decoded=JSON.parse(raw);}catch{entry.status='incomplete';entry.reason='malformed_json';report.status='manual_hold';save();return null;}
  if(!decoded||typeof decoded!=='object'||Array.isArray(decoded)){entry.status='invalid';entry.reason='response_not_object';report.status='manual_hold';save();return null;}
  entry.status='journaled';entry.responseSha=createHash('sha256').update(raw).digest('hex');
  entry.response=decoded;save();return decoded;
 }catch(e){entry.status='uncertain';entry.reason=e?.name==='AbortError'?'client_timeout':'transport_uncertain';report.status='manual_hold';save();return null;
 }finally{clearTimeout(timer)}
}
function recordNode(path,step,status,additional={}){
 const node={path,step,status,...additional};report.nodes.push(node);save();return node;
}
try{
 const plan=await query('decompose',[{role:'user',content:JSON.stringify({request:'Choose 2 to 4 meaningful ORDERED subproblems to solve this unfamiliar exact logistics problem. No parallel branches. Each subproblem feeds the next. Reply {"action":"plan","steps":[{"name":"...","deliverable":"..."},...],"strategy":"..."}. Do not provide code yet.',specification,publicInput:publicProblem})}],1250);
 if(!plan)throw Error('HALTED');
 if(plan.action!=='plan'||!Array.isArray(plan.steps)||plan.steps.length<2||plan.steps.length>4||plan.steps.some(x=>!x?.name||!x?.deliverable)){report.status='plan_invalid';throw Error('HALTED');}
 recordNode('R','decompose','accepted',{plan:plan.steps,strategy:plan.strategy});
 let currentSource=null,publicRun=null,publicGraded=null;
 for(let attempt=0;attempt<2;attempt++){
  const stage=attempt===0?'author_solver':'repair_solver';
  const prompt=attempt===0?{
   request:'Write a COMPLETE GENERAL exact Python3 solver for the described problem. Follow your own proposed ordered work steps as needed. Reply {"action":"code","python":"full executable source","algorithm":"brief explanation"}. Avoid hardcoding routes or constants for this example. Different unseen customer lists will be tested.',
   specification,publicInput:publicProblem,agentAuthoredPlan:plan.steps
  }:{
   request:'Your public solver failed. Repair the ROOT CAUSE, and provide the complete corrected general Python3 source. Reply {"action":"code","python":"full executable source","algorithm":"brief explanation"}. No held-out information will be provided.',
   specification,publicInput:publicProblem,previousPython:currentSource,
   observedPublicFailure:{pythonExecuted:publicRun?.ok??false,output:publicRun?.result??null,error:publicRun?.error??null,
    stderr:String(publicRun?.stderr||'').slice(0,800),verifier:publicGraded?.reason??null,
    claimedCost:publicGraded?.actualCost??null}
  };
  const answer=await query(stage,[{role:'user',content:JSON.stringify(prompt)}],7000);
  if(!answer)throw Error('HALTED');
  if(answer.action!=='code'||typeof answer.python!=='string'){report.status='code_invalid';throw Error('HALTED')}
  currentSource=answer.python;
  publicRun=await runIsolatedPython(currentSource,publicProblem);
  publicGraded=publicRun.ok?grade(publicProblem,publicRun.result):{passed:false,reason:publicRun.error};
  recordNode('R.'+String(attempt+1).padStart(3,'0'),stage,publicGraded.passed?'accepted':'rejected',
   {sourceSha:createHash('sha256').update(currentSource).digest('hex'),python:currentSource,algorithm:answer.algorithm,
    publicResult:publicRun.result??null,publicGraded});
  if(publicGraded.passed)break;
 }
 if(!publicGraded?.passed){report.status='public_problem_failed';throw Error('HALTED');}
 // Hidden benchmarks are local-only. Their inputs and grader details NEVER go to the model.
 const unseen=[];
 for(const task of hiddenProblems){const x=await runIsolatedPython(currentSource,task);const g=x.ok?grade(task,x.result):{passed:false,reason:x.error};
  unseen.push({inputHash:hash(task),passed:Boolean(g.passed),reason:g.reason,actualCost:g.actualCost??null,
   optimalCost:g.optimalCost??null,result:x.result??null});}
 report.hidden=unseen;save();
 if(!unseen.every(x=>x.passed)){report.status='hidden_problem_failed';throw Error('HALTED');}
 const summary=await query('synthesize',[{role:'user',content:JSON.stringify({request:'Synthesize your agent-written plan and proven public solver into a concise final explanation. Respond {"action":"finish","summary":"...","invariants":["..."],"limits":"..."}. Do not assert knowledge of unseen cases.',plan:plan.steps,publicVerification:{passed:true,claimedCost:publicRun.result?.cost,actualCost:publicGraded.actualCost}})}],1300);
 if(!summary)throw Error('HALTED');
 if(summary.action!=='finish'||!summary.summary||!Array.isArray(summary.invariants)||summary.invariants.length<2){report.status='synthesis_invalid';throw Error('HALTED')}
 recordNode('R.final','synthesize','accepted',{summary});
 report.status='passed';report.acceptedRootDigest=hash({plan:plan.steps,pythonSha:hash(currentSource),public:publicGraded,hidden:unseen.map(x=>({hash:x.inputHash,pass:x.passed})),summary});
} catch(e){if(e.message!=='HALTED'){report.status='runner_exception';report.errorName=String(e?.name||'Error').slice(0,80)}}
finally{save();console.log('SOLO_LOGISTICS_RESULT='+JSON.stringify({status:report.status,providerCalls:report.providerCalls,providerTokens:report.providerReportedTokens,
 nodes:report.nodes.map(n=>({path:n.path,status:n.status,step:n.step})),publicPass:report.nodes.some(n=>n.publicGraded?.passed),
 hiddenPasses:report.hidden?.filter(x=>x.passed).length??0,hiddenCount:hiddenProblems.length,rootCertified:!!report.acceptedRootDigest}));
 if(report.status!=='passed')process.exitCode=2;}
