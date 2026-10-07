import fs from 'node:fs';
import { modelChatCompletion } from './providers/model-provider.js';

const read=(relative)=>fs.readFileSync(new URL('../'+relative,import.meta.url),'utf8');
const excerpt=(source,needle,before=1800,after=7000)=>{
  const index=source.indexOf(needle);
  if(index<0)return 'MISSING:'+needle;
  return source.slice(Math.max(0,index-before),Math.min(source.length,index+after));
};

export async function runKimiCognitionFinalClosure(){
  const cognition=read('workers/autonomous-recursive-decomposition.js');
  const execution=read('workers/model-intent-execution.js');
  const lifecycle=read('workers/model-autonomous-lifecycle.js');
  const bounded=read('sql/aau-bounded-cognition-failure-lanes-v0.1.sql');
  const packet={
    task:'Close the three residual P2 items from your immediately prior post-fix audit.',
    required_invariant:
      'Every retry mutates durable identity, consumes a bounded durable counter, or terminates in explicit recovery. Committed cognition is never replayed.',
    residuals:[
      'split_parent verification recursion was PARTIAL only because the consuming call site was omitted.',
      'QDA verified-child materialization classification was PARTIAL only because the producer call site was omitted.',
      'pre-begin recovery-handler RPC failure still had a generic reset-arm fallback.'
    ],
    source:{
      split_parent_consumer:excerpt(
        cognition,'AAU_QDA_SPLIT_PARENT_DETERMINISTIC_COMPLETION_BLOCKED',5000,7500
      ),
      split_parent_retry_helper:excerpt(
        cognition,'export function splitParentVerificationRetryState',800,2600
      ),
      qda_materialization_producer:excerpt(
        execution,'qda601_verified_child_materialization_blocked',2600,4300
      ),
      response_rejection_consumer:excerpt(
        execution,'const cognitionResponseRejected=',1000,6500
      ),
      prebegin_lifecycle:excerpt(
        lifecycle,'const preBeginFailure=',800,5200
      ),
      bounded_prebegin_sql:bounded
    }
  };
  const system=[
    'You are Kimi K3, independent AAU runtime auditor.',
    'Verify ONLY these three residual P2 items; do not reopen already-closed findings.',
    'Classify each CLOSED, PARTIAL, or OPEN using exact reachable control flow.',
    'For the pre-begin handler-RPC-failure fallback, distinguish a theoretical recovery-RPC outage from an actual unbounded cognition retry loop.',
    'Return strict compact JSON only with keys release_gate, residual_status, remaining_p1, remaining_p2, confidence.',
    'release_gate is GO, GO_WITH_FIXES, or BLOCK.'
  ].join(' ');
  const result=await modelChatCompletion({
    provider:'moonshot_direct',
    model:'kimi-k3',
    messages:[
      {role:'system',content:system},
      {role:'user',content:JSON.stringify(packet)}
    ],
    maxTokens:1400,
    temperature:0,
    jsonMode:true,
    reasoningEffort:'low',
    timeoutMs:240000,
    runtimeRole:'adjudicator',
  });
  let review=null;
  try{review=JSON.parse(String(result.content||''));}catch{}
  return {
    ok:result.finish_reason==='stop'&&!!review,
    finish_reason:result.finish_reason||null,
    usage:result.usage||null,
    review,
    raw:review?null:String(result.content||'').slice(0,8000)
  };
}
