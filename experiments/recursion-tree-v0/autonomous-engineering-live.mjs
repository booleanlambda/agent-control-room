// One-time LIVE autonomous engineering assessment (Kimi/Nemotron).
// No prescribed split boundaries or task DAG; the model authors its own
// plans and chooses tools. The optimum stays outside all model messages.
import {writeFileSync} from 'node:fs';
import {PROBLEM_TEXT,evaluate,enumerateExact,exactDp,acceptFormulation}
 from './autonomous-engineering-benchmark.mjs';
const PROVIDER=process.argv[2]||'kimi';
if(!['kimi','nemotron'].includes(PROVIDER))throw Error('provider_unknown');
if(process.env.AAU_COGNITION_LIVE_EXPERIMENT!=='yes')throw Error('LIVE_NOT_AUTHORIZED');
const configs={
 kimi:{model:'kimi-k2.6',endpoint:'https://api.moonshot.ai/v1/chat/completions',
  key:process.env.MOONSHOT_API_KEY||process.env.MOONSHOT_APIKEY,
  options:{temperature:0.6,thinking:{type:'disabled'}}},
 nemotron:{model:'nvidia/nemotron-3.5-lightning-30b-a3b',
  endpoint:'https://integrate.api.nvidia.com/v1/chat/completions',
  key:process.env.NVIDIA_API_KEY,
  options:{temperature:0.2,chat_template_kwargs:{enable_thinking:false}}},
};
const c=configs[PROVIDER];
if(!String(c.key||'').trim())throw Error('PROVIDER_KEY_MISSING');
const MAX_CALLS=12,MAX_TOKENS=24000,DEADLINE=Date.now()+13*60*1000;
const GAP=PROVIDER==='kimi'?23000:4000;
let nextAllowed=Date.now()+(PROVIDER==='kimi'?65000:0);
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const history=[],modelTrace=[],tools=[],plans=[];
let calls=0,tokens=0,done=null,failure=null,finalAttempts=0;
let dpExposed=false;
const constraints=`You are an autonomous engineering analyst with a bounded external
calculation companion. You must choose your own approach and can create
subtasks if helpful. DO NOT assume a predetermined recursion tree exists.
Work towards an EXACT globally minimum-cost schedule with a defensible
proof, not merely a plausible schedule.

Available response actions (ONE JSON object per turn):
{"action":"plan","subtasks":[{"goal":"...","dependsOn":[]},...],"reason":"..."}
{"action":"evaluate","schedules":[[8 integer g values],...],"reason":"..."}
{"action":"optimize","stateVariables":["..."],"recurrence":"Explain exact state, transitions, objective and terminal feasibility in natural math prose.","reason":"..."}
{"action":"final","generator":[8 integer g values],"claimedCost":integer,"method":"...","proof":"...","limitations":"..."}

The evaluate tool checks up to 8 proposed sequences for all constraints;
it does not reveal a reference optimum. The optimize tool runs a
deterministic exact dynamic program, BUT ONLY if YOU independently identify
the complete sufficient DP state and describe a recurrence that handles all
constraints. A complete DP state must encode every past quantity needed to
decide future feasibility and cost. No particular split boundaries, task
count or shape are prescribed. You choose whether to plan, evaluate,
optimize or conclude. Do not fabricate tool observations.

The tool may compute the optimum, but you must still synthesize a final
engineering answer and explain why the recurrence certifies global
optimality. If a final answer is rejected by the hidden verifier you may
correct it from feedback. Never claim an output is proved simply because
you have a number.

Return valid JSON only, without Markdown code fences or prefatory text.`;
history.push({role:'system',content:constraints});
history.push({role:'user',content:PROBLEM_TEXT});
const summaryError=x=>String(x?.message||x||'error')
 .replace(/Bearer\s+\S+/gi,'Bearer [redacted]')
 .replace(/ak-[^\s"']+/gi,'ak-[redacted]')
 .slice(0,180);
async function callModel(){
 if(calls>=MAX_CALLS)throw Error('call_limit');
 if(Date.now()>DEADLINE)throw Error('wall_deadline');
 if(tokens>=MAX_TOKENS)throw Error('token_ceiling');
 const wait=Math.max(0,nextAllowed-Date.now());
 if(Date.now()+wait>DEADLINE)throw Error('rate_wait_exceeds_deadline');
 if(wait)await sleep(wait);
 nextAllowed=Date.now()+GAP;
 const start=Date.now();
 calls++;
 const ctl=new AbortController(),timer=setTimeout(()=>ctl.abort(),80000);
 let usage={total_tokens:0},status=null,finish=null,error=null,
  content=null,thinkingContent=false;
 try{
  const response=await fetch(c.endpoint,{method:'POST',
   headers:{authorization:'Bearer '+String(c.key).trim(),
    'content-type':'application/json',accept:'application/json'},
   body:JSON.stringify({model:c.model,messages:history,
    response_format:{type:'json_object'},stream:false,max_tokens:1100,
    ...c.options}),signal:ctl.signal,redirect:'manual'});
  status=response.status;
  let packet={};
  try{packet=await response.json()}catch{}
  if(!response.ok)throw Error('provider_http_'+status+':'+String(packet?.error?.type||packet?.error?.code||'unknown'));
  usage=packet?.usage||usage;
  tokens+=Number(usage.total_tokens)||0;
  const choice=packet?.choices?.[0]||{};
  finish=choice.finish_reason||null;
  thinkingContent=Boolean(choice.message?.reasoning_content);
  if(finish!=='stop')throw Error('incomplete_response_'+finish);
  if(thinkingContent)throw Error('thinking_disabled_not_honored');
  content=choice.message?.content;
  if(typeof content!=='string'||!content.trim())throw Error('no_final_text_content');
  const answer=JSON.parse(content);
  if(!answer||typeof answer!=='object'||Array.isArray(answer))throw Error('invalid_json_response');
  history.push({role:'assistant',content:JSON.stringify(answer)});
  return answer;
 }catch(e){error=summaryError(e);throw e;}
 finally{
  clearTimeout(timer);
  modelTrace.push({call:calls,latencyMs:Date.now()-start,http:status,
   finish_reason:finish,thinkingContent,providerReportedUsage:{
    prompt:usage.prompt_tokens||0,completion:usage.completion_tokens||0,
    total:usage.total_tokens||0},error,
   contentLength:typeof content==='string'?content.length:0});
 }
}
function toolResult(name,result){
 tools.push({tool:name,result});
 history.push({role:'user',content:'Verified tool feedback: '+JSON.stringify(result).slice(0,5000)+
 '\nChoose your next independent action. Return one JSON object.'});
}
const refCheck=enumerateExact(),independentDp=exactDp();
if(refCheck.optimalCost!==independentDp.cost||
 JSON.stringify(refCheck.optimalSchedules[0])!==JSON.stringify(independentDp.path))
 throw Error('INDEPENDENT_REFERENCE_DISAGREEMENT');
try{
 for(let i=0;i<MAX_CALLS;i++){
  const reply=await callModel();
  const action=String(reply.action||'unknown').toLowerCase();
  if(action==='plan'){
    const tasks=Array.isArray(reply.subtasks)?reply.subtasks:[];
    const valid=tasks.length>=1&&tasks.length<=8&&
      tasks.every(t=>t&&typeof t.goal==='string'&&t.goal.length>=12&&t.goal.length<=500);
    if(valid)plans.push({call:calls,tasks:tasks.map(t=>({goal:t.goal,dependsOn:t.dependsOn||[]})),
      reason:String(reply.reason||'').slice(0,450)});
    toolResult('plan_ack',{accepted:valid,registeredTasks:valid?tasks.length:0,
      detail:valid?'You designed these goals; you may revise or execute them as you choose':
        'Provide 1 to 8 nonempty goals with at least 12 characters'});
    continue;
  }
  if(action==='evaluate'){
    const schedules=Array.isArray(reply.schedules)?reply.schedules:[];
    if(schedules.length<1||schedules.length>8){
      toolResult('evaluate',{accepted:false,reason:'1_to_8_candidates_required'});
      continue;
    }
    const evaluated=schedules.map(s=>({generator:s,audit:evaluate(s)}));
    toolResult('evaluate',{accepted:true,evaluated});
    continue;
  }
  if(action==='optimize'){
    const a=acceptFormulation(reply);
    if(!a.valid){
      toolResult('optimize',{accepted:false,reason:'insufficient_state_or_recurrence',
        stateChecks:a.stateChecks,
        hint:'Time, battery state, previous generator output, cumulative generation/emissions and a Bellman recurrence are necessary.'});
      continue;
    }
    dpExposed=true;
    toolResult('optimize',{accepted:true,method:'exact_memoized_dynamic_program',
      stateVariables:reply.stateVariables,
      optimalCost:independentDp.cost,
      optimalGenerator:independentDp.path,
      statesEvaluated:independentDp.states,transitionsExamined:independentDp.transitions,
      verification:'Independent exhaustive certification withheld until final submission.'});
    continue;
  }
  if(action==='final'){
    finalAttempts++;
    const candidate=evaluate(reply.generator);
    const claimed=Number(reply.claimedCost);
    const optimum=Number.isFinite(candidate.totalCost)&&
      candidate.totalCost===refCheck.optimalCost&&
      claimed===candidate.totalCost;
    const proof=String(reply.proof||'');
    const articulation=proof.length>=45&&String(reply.method||'').length>=12;
    const audit={generator:reply.generator,claimedCost:claimed,candidate,
      globallyOptimal:optimum,hasMethodAndProof:articulation,
      proofText:proof.slice(0,1500),method:String(reply.method||'').slice(0,1200),
      limitations:String(reply.limitations||'').slice(0,550)};
    if(optimum&&articulation){done={status:'accepted',...audit};break}
    toolResult('hidden_independent_audit',{accepted:false,
      candidateFeasible:candidate.feasible,
      candidateCost:candidate.totalCost??null,
      claimedCostMatches:Boolean(candidate.feasible&&candidate.totalCost===claimed),
      proofSufficientlyExplained:articulation,
      reason:!candidate.feasible?candidate.reason:
        !articulation?'need_method_and_proof':
        'not_proven_global_optimum',
      note:'No true optimum is disclosed by this audit. Re-evaluate your approach.'});
    if(finalAttempts>=2){done={status:'rejected_after_two_final_attempts',...audit};break}
    continue;
  }
  toolResult('invalid_action',{accepted:false,allowed:['plan','evaluate','optimize','final']});
 }
}catch(e){failure=summaryError(e)}
const answer=done||{status:failure?'transport_or_runtime_stop':'call_limit_stop'};
const report={
 experiment:'AAU_AUTONOMOUS_MICROGRID_COGNITION_V1',
 provider:PROVIDER,model:c.model,thinkingDisabled:true,
 notPredeterminedTaskTree:true,
 sourceFixture:'eight-hour_integer_microgrid_min_cost',
 liveInference:true,
 maxCalls:MAX_CALLS,maxTokens:MAX_TOKENS,
 modelCalls:calls,modelTokens:tokens,modelTrace,
 elapsedFromFirstToLastCallMs:modelTrace.reduce((a,x)=>a+x.latencyMs,0),
 selfAuthoredPlans:plans,planCount:plans.length,
 optimizeToolWasUsed:dpExposed,toolSequence:tools,
 finalAnswer:answer,
 independentReference:{
  exactCost:refCheck.optimalCost,
  exhaustiveFeasibleSchedules:refCheck.feasibleCount,
  optimalScheduleCount:refCheck.optimalSchedules.length,
  uniqueOptimalSchedule:refCheck.optimalSchedules[0],
  dpOptimalCost:independentDp.cost,dpStates:independentDp.states,
  dpTransitions:independentDp.transitions,
  exactScheduleAudit:evaluate(refCheck.optimalSchedules[0])},
 failure,passes:Boolean(done?.status==='accepted'),
 caveats:[
  'Fixed one engineering problem; not proof of broad mathematical generalization',
  dpExposed?
  'Tool-augmented result: deterministic solver computed optimum after model authored a DP formulation':
  'No exact optimizer tool was used; model arrived at answer with its own steps/evaluations',
  'External calls are subject to billing despite a transport failure; no automatic retries',
 ]};
writeFileSync('autonomous-engineering-'+PROVIDER+'-report.json',JSON.stringify(report,null,2)+'\n');
console.log('AUTONOMOUS_ENG_RESULT='+JSON.stringify({
 provider:PROVIDER,model:c.model,passes:report.passes,
 modelCalls:calls,modelTokens:tokens,planCount:plans.length,
 toolSequence:tools.map(x=>x.tool),
 solveUsed:dpExposed,
 final:done&&{status:done.status,claimedCost:done.claimedCost,
  generatedSchedule:done.generator,candidateCost:done.candidate?.totalCost},
 referenceCost:refCheck.optimalCost,feasibleSchedules:refCheck.feasibleCount,
 failure,
}));
if(!report.passes)process.exitCode=2;
