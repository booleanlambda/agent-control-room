// Single-call research-only live probe: can Kimi K2.6 with thinking ON
// repair the actual V25 failed code? No gold answer, no hidden cases, no
// production state writes and NO retry of an uncertain billed request.
import {Pool} from 'pg';
import {writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {runIsolatedPython} from '../recursion-tree-v0/unseen-python-sandbox.mjs';
import {publicCasesFor,assess,sha} from '../kimi-recursion-v24/benchmark.mjs';
import {behaviorProbesAt} from '../kimi-recursion-v24/behavioral-probes.mjs';
import {reconcileSelectedCost} from '../kimi-recursion-v24/cost-companion.mjs';
import {kimiStageRequest,kimiResponseAcceptable} from '../kimi-recursion-v24/thinking-router.mjs';
if(process.env.GITHUB_ACTIONS!=='true'||process.env.AAU_V27_REPAIR_PROBE!=='yes'||
 process.env.AAU_PYTHON_SANDBOX!=='yes')throw Error('ISOLATED_CI_ONLY');
const shaText=x=>createHash('sha256').update(typeof x==='string'?x:JSON.stringify(x)).digest('hex');
const id='485862c5-8525-4b74-92ed-d242e6fbc277';
const evidence={experiment:'AAU_V27_REPAIR_ONLY_THINKING_ON',sourceRun:id,
 model:'kimi-k2.6',testingOnlyStage:'repair_0',thinking:'enabled',otherStageMode:'disabled',
 scope:'isolated_previous_actual_V25_model_authored_failure',
 status:'preflight',attempts:0,providerTokens:null,rawReasoningRetained:false,
 noRetries:true,noCorrectAnswerProvided:true,noHiddenInputs:true,
 repairAccepted:false,publicPassed:false,notes:[]};
const persist=()=>writeFileSync('repair-probe-v27-evidence.json',JSON.stringify(evidence,null,2)+'\n');
let pool;
const validStage=kimiStageRequest('repair_0',3600);
if(validStage.thinking.type!=='enabled'||validStage.model!=='kimi-k2.6')throw Error('INVALID_ROUTING');
const routeStages=['level_0','level_1','level_9','synthesize'];
if(routeStages.some(x=>kimiStageRequest(x,3600).thinking.type!=='disabled'))throw Error('ROUTING_LEAK');
async function testCode(code,input){
 const exec=await runIsolatedPython(code,input,{timeoutMs:10000});
 if(!exec.ok)return {passed:false,reason:exec.error};
 const result=assess(input,reconcileSelectedCost(input,exec.result).answer);
 return {passed:result.passed,reason:result.reason,selected:exec.result.selected,reportedCost:exec.result.cost};
}
try{
 const connString=String(process.env.NEON_V19_DATABASE_URL||'');
 const apiKey=String(process.env.MOONSHOT_API_KEY||'');
 if(!/^postgres(?:ql)?:\/\//.test(connString)||!apiKey)throw Error('RESEARCH_SECRETS_MISSING');
 pool=new Pool({connectionString:connString,ssl:{rejectUnauthorized:true},
  max:1,connectionTimeoutMillis:12000,statement_timeout:12000,
  application_name:'AAU_V27_REPAIR_TEST_READ_ONLY'});
 const br=await pool.query('select branch_id,marker from aau_research_v19.integration_scope');
 if(br.rowCount!==1||br.rows[0].branch_id!=='br-cold-rice-b4m3l9qu'||
  br.rows[0].marker!=='AAU_V20_ISOLATED_LIVE_WORKER')throw Error('NEON_RESEARCH_BRANCH_MISMATCH');
 const q=await pool.query('select status,seq,state from aau_research_v23.runs where run_id=$1',[id]);
 if(q.rowCount!==1||q.rows[0].status!=='failed'||q.rows[0].seq!==6)
  throw Error('SOURCE_NOT_FAILED_V25');
 const state=q.rows[0].state,source=state.source,firstCase=publicCasesFor(0)[0];
 if(typeof source!=='string'||source.length<100||state.verifiedDepth!==0||
   state.repairs?.length!==2||state.lastFailure?.reason!=='LEXICOGRAPHIC_TIE_BREAK')
  throw Error('FAILURE_SOURCE_MISMATCH');
 evidence.sourceHash=shaText(source);
 evidence.publicInputHash=sha(firstCase);
 const baseline=await testCode(source,firstCase);
 evidence.baseline={passed:baseline.passed,reason:baseline.reason,reportedCost:baseline.reportedCost};
 if(baseline.passed||baseline.reason!=='LEXICOGRAPHIC_TIE_BREAK')
  throw Error('REAL_MODEL_CODE_NO_LONGER_FAILS');
 const instruction='Your OWN model-authored Python failed a public invariant check. Diagnose the root cause then give exactly ONE LOCAL patch. Do NOT rewrite the entire solver. Return JSON {old:exact unique substring from current source,replacement:new substring,diagnosis:string,invariantPreserved:string}. Do not hardcode task-specific IDs, values or expected answers.';
 const messages=[
  {role:'system',content:'You are Kimi K2.6, now in remediation thinking mode. Preserve prior verified constraints. You do not know any hidden oracle answers. Correct the general cause of the public rejection. Return one JSON object only.'},
  {role:'user',content:JSON.stringify({instruction,stage:'repair_0',attempt:1,
   originalRule:'Among equal-minimum-cost selections return the lexicographically smallest ascending ID list',
   currentPython:source,publicFailure:{reason:baseline.reason,
    observed:baseline.selected,reportedCost:baseline.reportedCost},publicInput:firstCase})}
 ];
 const body={model:validStage.model,thinking:validStage.thinking,
  temperature:validStage.temperature, max_tokens:validStage.max_tokens,
  response_format:{type:'json_object'},stream:false,messages};
 evidence.requestHash=shaText(body);
 evidence.status='potentially_billable_sent_or_uncertain';evidence.attempts=1;persist();
 const abort=new AbortController(),timer=setTimeout(()=>abort.abort(),validStage.timeoutMs);
 let parsed,finish,tokens,reasoningPresent;
 try{
  const response=await fetch('https://api.moonshot.ai/v1/chat/completions',{method:'POST',
   redirect:'manual',signal:abort.signal,headers:{
    authorization:'Bearer '+apiKey,'content-type':'application/json',accept:'application/json'},
   body:JSON.stringify(body)});
  const j=await response.json().catch(()=>({}));
  const choice=j?.choices?.[0];finish=choice?.finish_reason;
  tokens=j?.usage?.total_tokens??null;
  evidence.providerTokens=tokens;
  reasoningPresent=!!choice?.message?.reasoning_content;
  evidence.reasoningReturned=reasoningPresent;
  evidence.finishReason=finish??null;
  evidence.reasoningTokens=j?.usage?.completion_tokens_details?.reasoning_tokens??null;
  if(!response.ok||!kimiResponseAcceptable('repair_0',choice))
   throw Error('PROVIDER_INCOMPLETE_OR_REJECTED');
  parsed=JSON.parse(choice.message.content||'');
  if(typeof parsed.old!=='string'||typeof parsed.replacement!=='string'||typeof parsed.diagnosis!=='string')
   throw Error('REPAIR_RESPONSE_SHAPE_INVALID');
  evidence.responseHash=shaText(parsed);
 }finally{clearTimeout(timer)}
 // Do not retain raw chain-of-thought.
 evidence.diagnosis=parsed.diagnosis.slice(0,2000);
 const old=parsed.old,newPart=parsed.replacement;
 const occurrence=old?source.split(old).length-1:0;
 if(occurrence!==1||newPart===old||newPart.length>10500)
  throw Error('INVALID_OR_NONUNIQUE_MODEL_PATCH');
 const patched=source.replace(old,newPart);
 if(patched.length>10500)throw Error('PATCH_TOO_LARGE');
 evidence.patchedSourceHash=shaText(patched);
 let checks=0;
 for(const p of [...publicCasesFor(0),...behaviorProbesAt(0).map(x=>x.input)]){
  const outcome=await testCode(patched,p);checks++;
  if(!outcome.passed){
   evidence.status='repair_failed_verification';
   evidence.firstFailure={reason:outcome.reason,checkIndex:checks};
   evidence.checked=checks;persist();break;
  }
 }
 if(evidence.status!=='repair_failed_verification'){
  evidence.checked=checks;
  evidence.publicPassed=true;
  evidence.repairAccepted=true;
  evidence.status='verified';
 }
}catch(e){
 if(evidence.status==='potentially_billable_sent_or_uncertain')evidence.status='manual_hold';
 else if(!evidence.status.startsWith('repair_failed')&&evidence.status!=='verified')evidence.status='failed';
 evidence.error=String(e.message||e).replace(/[^A-Z0-9_]/g,'').slice(0,90);
}finally{
 if(pool)await pool.end().catch(()=>{});
 persist();
 console.log('AAU_V27_REPAIR_RESULT='+JSON.stringify({
  status:evidence.status,thinking:evidence.thinking,attempts:evidence.attempts,
  tokens:evidence.providerTokens,reasoningReturned:evidence.reasoningReturned??null,
  repaired:evidence.repairAccepted,publicPassed:evidence.publicPassed,
  firstFailure:evidence.firstFailure??null,error:evidence.error??null}));
 if(evidence.status!=='verified')process.exitCode=2;
}
