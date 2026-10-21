// Standalone runner: --mode=mock|stress|live, --stage=1|2|3.
// No imports from production workers and no Supabase/queue writes.
import {writeFileSync} from 'node:fs';
import {CASES,BASELINE,settings,createExperiment,run,report,step,
  scriptedLightweight,silasFaultHistogram} from './engine.mjs';

const args=Object.fromEntries(process.argv.slice(2).map(v=>{
  const [k,...parts]=v.replace(/^--/,'').split('=');
  return [k,parts.join('=')||'true'];
}));
const mode=args.mode||'mock';
const stage=Number(args.stage||1);
if(!['mock','stress','live'].includes(mode))throw Error('unsupported_mode');
const config=settings(stage);
if(mode==='live'&&stage!==1&&process.env.AAU_EXPERIMENT_DEEPER_STAGE!=='true')
  throw Error('deeper_live_stage_needs_explicit_opt_in');
const data=CASES.map(({id,error})=>({id,error}));
function parseModelJSON(raw){
  const text=String(raw||'').trim().replace(/^\`\`\`(?:json)?\s*/i,'').replace(/\`\`\`$/,'').trim();
  const value=JSON.parse(text);
  if(!value||typeof value!=='object'||Array.isArray(value))throw Error('invalid_model_response');
  return value;
}
async function liveNemotron(node,limits){
  const key=String(process.env.NVIDIA_API_KEY||'').trim();
  if(!key)throw Error('NVIDIA_API_KEY_MISSING: no mock fallback in live test');
  // The agent chooses the partition/classifications. Authenticator, not model,
  // decides whether an artifact satisfies the mechanical/exact-label oracle.
  const messages=[
    {role:'system',content:`You are the lightweight reasoning worker in a controlled AAU tree experiment. Return EXACTLY one valid JSON object, with no markdown or extra keys. Follow these hard conditions, in this order:
1. When there are MORE THAN ${limits.maxLeafSize} cases, action MUST equal "SPLIT". Respond {"action":"SPLIT","children":[["E01","E02"],["E03","E04"]]} with two NONEMPTY lists that together contain each input ID EXACTLY once. You must not attempt ATOMIC at this size.
2. When there are AT MOST ${limits.maxLeafSize} cases, action MUST equal "ATOMIC". Respond {"action":"ATOMIC","results":[{"id":"E01","classification":"budget"}]} with exactly one result for every input ID.
3. Classification choices are exclusively "budget", "provider", "cognition", "evidence", "scheduler", "unknown". Use the ERROR MESSAGE, not the path, to classify: budget exhaustion, bucket rollover, cycle locks = budget; provider HTTP 504, transport timeout = provider; autonomous_decomposition_split_requires_child, invalid action, empty synthesis and discovery failures = cognition; QDA materialization, missing verification, bad checks, schema or provenance = evidence; orphaned running intent, lease, scheduler = scheduler.
4. Do not make up IDs, omit IDs or declare an incorrect category just to complete a task. JSON keys, quoted strings and classifications are mandatory. No explanation.`},
    {role:'user',content:JSON.stringify({task:'Classify Silas runtime incident diagnostics',
      path:node.path,depth:node.depth,depthLimit:limits.depthLimit,
      cases:node.cases,outputLimit:limits.outputLimit})},
  ];
  const controller=new AbortController();
  const timeout=setTimeout(()=>controller.abort(),90000);
  try{
    const response=await fetch('https://integrate.api.nvidia.com/v1/chat/completions',{
      method:'POST',headers:{authorization:'Bearer '+key,'content-type':'application/json',accept:'application/json'},
      signal:controller.signal,
      body:JSON.stringify({
        model:'nvidia/nemotron-3.5-lightning-30b-a3b',messages,
        max_tokens:limits.outputLimit,temperature:0.2,stream:false,
        chat_template_kwargs:{enable_thinking:false},
        response_format:{type:'json_object'},
      }),
    });
    const raw=await response.text();
    if(!response.ok)throw Error('NVIDIA_HTTP_'+response.status+':'+raw.slice(0,240));
    const packet=JSON.parse(raw);
    const choice=packet?.choices?.[0];
    if(!choice||choice.finish_reason!=='stop')throw Error('MODEL_INCOMPLETE:'+String(choice?.finish_reason));
    const content=choice.message?.content;
    if(!content)throw Error('MODEL_EMPTY_CONTENT');
    return parseModelJSON(content);
  } finally {clearTimeout(timeout);}
}
function save(name,obj){
  const file='recursion-tree-'+name+'.json';
  writeFileSync(file,JSON.stringify(obj,null,2)+'\n');
  console.log('ARTIFACT='+file);
}
async function stress(){
  const observed=silasFaultHistogram(71);
  const outcomes={complete:0,blocked:0};
  const rows=[];
  for(let i=0;i<observed.length;i++){
    const fault=observed[i];
    const budget=fault==='budget'?600:config.budgetTokens;
    const exp=createExperiment(settings(1,{budgetTokens:budget}),['E01','E02']);
    let calls=0;
    const model=async(n,c)=>{
      calls++;
      if(fault==='other')return {action:'SPLIT',children:[['E01'],['E02']]};
      if(fault==='evidence')return {action:'ATOMIC',results:[
        {id:'E01',classification:'provider'},{id:'E02',classification:'provider'}]};
      return scriptedLightweight(n,c);
    };
    if(fault==='scheduler')await step(exp,model,{stale:true});
    if(fault==='provider')await step(exp,model,{injectedFailure:'model_provider_http_504'});
    const result=await run(exp,model);
    const final=result.complete?'complete':'blocked';
    outcomes[final]++;
    rows.push({caseNo:i+1,injected:fault,outcome:final,calls:exp.calls,spent:exp.spent,
      nodes:result.nodes.length});
  }
  const out={kind:'synthetic_fault_injection',observedBaseline:BASELINE,
    explicitAssumptions:[
      'one provider fault followed by a healthy retry',
      'one stale scheduler wake followed by a healthy resume',
      'budget failure is terminal without replenishment',
      'persistent protocol and evidence violations reject on both attempts',
      'fixed deterministic oracle for labeled incident fixtures',
    ],outcomes,categoryCounts:Object.fromEntries(
      ['completed',...Object.keys(BASELINE.errors)].map(x=>[x,observed.filter(y=>y===x).length])),
    rows};
  save('stress',out);
  console.log('STRESS_RESULT='+JSON.stringify({outcomes,categoryCounts:out.categoryCounts}));
}
if(mode==='stress')await stress();
else {
  const exp=createExperiment(config);
  const solver=mode==='live'?liveNemotron:async(n,c)=>scriptedLightweight(n,c);
  const output=await run(exp,solver);
  const result={mode,model:mode==='live'?'nvidia/nemotron-3.5-lightning-30b-a3b':
      'deterministic_scripted_test_double_not_an_llm',
    baseline:BASELINE,limits:config,...output};
  save(mode+'-stage'+stage,result);
  console.log('TREE_RESULT='+JSON.stringify({mode,model:result.model,complete:result.complete,
    nodes:result.nodes.length,calls:result.calls,spent:result.spent,
    budget:result.budget,remaining:result.remaining,
    blocked:result.nodes.filter(n=>n.status==='blocked').map(n=>n.path)}));
  if(!output.complete)process.exitCode=mode==='live'?2:1;
}
