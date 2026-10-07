import fs from 'node:fs';
import { modelChatCompletion } from './providers/model-provider.js';

const read=(relative)=>fs.readFileSync(new URL('../'+relative,import.meta.url),'utf8');
const excerpt=(source,needle,before=1200,after=5200)=>{
  const index=source.indexOf(needle);
  if(index<0)return 'MISSING:'+needle;
  return source.slice(Math.max(0,index-before),Math.min(source.length,index+after));
};

export async function runKimiCognitionFinalClosure(){
  const lifecycle=read('workers/model-autonomous-lifecycle.js');
  const resetSql=read('sql/aau-bounded-prebegin-reset-fallback-v0.1.sql');
  const packet={
    task:'Verify the final residual P2 from your prior audit: P2-PREBEGIN-FALLBACK-UNBOUNDED.',
    prior_problem:
      'If aau_bridge_handle_prebegin_failure_v0_1 itself was unavailable, lifecycle fell back to reset_autonomous_*_arm without consuming a durable retry counter, allowing a loop under partial-deploy skew.',
    required_invariant:
      'The fallback itself must consume a bounded durable retry counter or terminate explicitly; it must never resurrect active/terminal work.',
    source:{
      lifecycle_fallback:excerpt(lifecycle,'if(!preBeginHandled)',900,4200),
      bounded_reset_fallback_sql:resetSql
    }
  };
  const system=[
    'You are Kimi K3, independent AAU runtime auditor.',
    'Verify only the single residual P2. Do not reopen previously closed findings.',
    'Classify CLOSED, PARTIAL, or OPEN using supplied reachable control flow.',
    'Return strict compact JSON only with keys release_gate, status, evidence, remaining_p1, remaining_p2, confidence.',
    'release_gate is GO, GO_WITH_FIXES, or BLOCK.'
  ].join(' ');
  const result=await modelChatCompletion({
    provider:'moonshot_direct',
    model:'kimi-k3',
    messages:[
      {role:'system',content:system},
      {role:'user',content:JSON.stringify(packet)}
    ],
    maxTokens:800,
    temperature:0,
    jsonMode:true,
    reasoningEffort:'low',
    timeoutMs:180000,
    runtimeRole:'adjudicator',
  });
  let review=null;
  try{review=JSON.parse(String(result.content||''));}catch{}
  return {
    ok:result.finish_reason==='stop'&&!!review,
    finish_reason:result.finish_reason||null,
    usage:result.usage||null,
    review,
    raw:review?null:String(result.content||'').slice(0,5000)
  };
}
