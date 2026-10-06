// One-shot, read-only Moonshot review of a captured AAU cognition runtime fault.
// It never reads agent secrets, mutates agent state, retries a wake, or applies code.
import { modelChatCompletion } from './providers/model-provider.js';

const faultPacket={
  incident:{
    agent_label:'Silas',
    wake_request_id:'9e64f322-61dd-4ce7-8730-8c39faad798d',
    qda_unit:'QDA601-M8-U1',
    terminal_error:'autonomous_decomposition_split_requires_child:R.001',
    failure_class:'cognition_runtime_fault',
  },
  event_sequence:[
    'R.001 began as an authoritative QDA curriculum child with decision_type ATOMIC.',
    'Its first atomic execution returned provider HTTP 200 but finish_reason length; runtime rejected it as COGNITION_RESPONSE_REJECTED:TRUNCATED_RESPONSE.',
    'The runtime reopened R.001 and constrained recovery routing to SPLIT.',
    'Bound-agent discovery chose SPLIT, explicitly proposing variable-by-variable narrower children because the atomic answer had overflowed.',
    'The SPLIT route checkpoint was durably persisted.',
    'The child-formulation model call completed successfully.',
    'The durable child proposal checkpoint contains status DONE, coverage_note "Remaining uncovered work is terminal synthesis/formatting/submission owned by the runtime under runtime_owned_terminal_synthesis_v0_2.", and _runtime_terminal_synthesis_collapsed=true.',
    'No child existed under R.001, so authorChildren threw autonomous_decomposition_split_requires_child:R.001.',
    'Sibling R.002 and R.003 completed normally.'
  ],
  relevant_code:[
    "runtimeOwnedTerminalSynthesisChild(candidate) normalizes candidate.requirement then returns true when it begins with /^(synthesize|synthesise|format|submit|compile|merge|reconcile|assemble|convert)\\b/.",
    "When that predicate is true, authorChildren replaces the CHILD proposal with status DONE and _runtime_terminal_synthesis_collapsed=true.",
    "Later, status DONE with authored.length < 1 throws autonomous_decomposition_split_requires_child:<node>.",
    "The documented child-authoring failure policy says failed child authoring must return the parent to pending with reconsider_decomposition=true rather than fail the wake.",
    "Atomic-overflow recovery currently exposes only SPLIT when the single allowed atomic execution fails by truncation."
  ],
  constraints:[
    'Do not diagnose Silas competence; diagnose runtime control flow only.',
    'Do not propose changing the authoritative QDA task or fabricating a child.',
    'Preserve bound-agent ownership of semantic decomposition.',
    'Prefer the smallest systemic repair that prevents this class of fatal wake while preserving the terminal-synthesis ownership guard.',
    'Distinguish primary root cause from contributing policy tension.'
  ]
};

export async function reviewSilasRuntimeFaultWithKimi(){
  const system=[
    'You are an independent AAU runtime adjudicator reviewing a captured control-flow fault.',
    'Use only the supplied incident packet. Do not modify anything and do not infer hidden facts.',
    'Identify the violated invariant and the narrowest systemic repair.',
    'Return strict JSON only with keys root_cause, contributing_factor, violated_invariant, minimal_fix, regression_tests, confidence.',
    'minimal_fix must be implementation-specific but concise. regression_tests must be an array of 2-4 concise cases. confidence is 0..1.'
  ].join(' ');
  const user=JSON.stringify(faultPacket);
  const started=Date.now();
  const result=await modelChatCompletion({
    provider:'moonshot_direct',
    model:'kimi-k3',
    messages:[{role:'system',content:system},{role:'user',content:user}],
    maxTokens:900,
    temperature:0,
    jsonMode:true,
    reasoningEffort:'low',
    timeoutMs:120000,
    runtimeRole:'adjudicator',
  });
  let parsed=null;
  try{parsed=JSON.parse(String(result.content||''));}catch{}
  return {
    ok:result.finish_reason==='stop'&&!!parsed,
    model:result.model_returned||'kimi-k3',
    provider:result.provider||'moonshot_direct',
    finish_reason:result.finish_reason||null,
    latency_ms:Date.now()-started,
    usage:result.usage||null,
    review:parsed,
    raw:parsed?null:String(result.content||'').slice(0,4000),
  };
}
