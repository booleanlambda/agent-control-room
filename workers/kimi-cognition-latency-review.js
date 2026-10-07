import { modelChatCompletion } from './providers/model-provider.js';

export async function runKimiCognitionLatencyReview(){
  const evidence={
    unit:'QDA601-M9-U3 Simulation and Uncertainty',
    observed:[
      'Root R split decision committed in under one second.',
      'R.001 remained unresolved for roughly 19 minutes before stabilizing as ATOMIC.',
      'R.002.001 repeatedly cycled DISCOVERY -> ROUTE_COMMIT -> ATOMIC_EXECUTION -> DISCOVERY over roughly an hour.',
      'The same branch created multiple durable checkpoints rather than converging.',
      'Rejected attempts included TRUNCATED_RESPONSE with finish_reason=length.',
      'Provider transport returned HTTP 504 during req_R_001_atomic_1 and again during statistics contract repair.',
      'The wake eventually terminated with SEMANTIC_BUDGET_EXHAUSTED.',
      'The following wake correctly reused a durable checkpoint rather than restarting from zero.',
      'Deep-mode packet size was approximately 178 KB after reduction from approximately 750 KB original state.',
      'The task is quantitative simulation where deterministic Python execution is available.'
    ],
    constraints:[
      'Do not reduce correctness, independent verification, restart safety, or durable checkpoint integrity.',
      'Do not solve the curriculum unit.',
      'Distinguish useful reasoning latency from orchestration/retry waste.',
      'Prefer enforceable state-machine/runtime changes over prompt-only advice.',
      'Silas should still be allowed to decompose genuinely complex tasks.'
    ]
  };
  const system=[
    'You are Kimi K3 acting as an independent senior runtime performance auditor for AAU.',
    'Review the supplied live incident evidence only.',
    'Diagnose why cognition took so long and recommend the smallest safe runtime changes that improve speed without reducing reasoning quality.',
    'Pay special attention to rediscovery loops, ATOMIC commitment semantics, truncation handling, transport retry behavior, deterministic Python routing, context size, semantic budget accounting, and convergence.',
    'Return strict JSON only.'
  ].join(' ');
  const user=JSON.stringify({
    evidence,
    required_output:{
      diagnosis:'short string',
      useful_reasoning_vs_waste:'object',
      ranked_causes:'array of {rank,cause,evidence,confidence}',
      recommended_changes:'array of {priority,change,why,safety_invariant,expected_effect}',
      do_not_change:'array',
      regression_tests:'array',
      overall_recommendation:'short string',
      confidence:'0..1'
    }
  });
  const started=Date.now();
  const result=await modelChatCompletion({
    provider:'moonshot_direct',
    model:'kimi-k3',
    messages:[{role:'system',content:system},{role:'user',content:user}],
    maxTokens:2600,
    temperature:0,
    jsonMode:true,
    reasoningEffort:'low',
    timeoutMs:300000,
    runtimeRole:'adjudicator',
  });
  let review=null;
  try{review=JSON.parse(String(result.content||''));}catch{}
  return {
    ok:result.finish_reason==='stop'&&!!review,
    latency_ms:Date.now()-started,
    finish_reason:result.finish_reason||null,
    usage:result.usage||null,
    review,
    raw:review?null:String(result.content||'').slice(0,12000),
  };
}
