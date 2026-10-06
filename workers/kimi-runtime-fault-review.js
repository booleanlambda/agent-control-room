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


const childOverlapPacket={
  incident:{
    agent_label:'Silas',
    qda_unit:'QDA601-M8-U1',
    node_path:'R.001',
    parent_requirement:'Create a canonical ledger with variable, value, unit, period, evidence state, source, and confidence.',
    accepted_children:[
      {node_path:'R.001.001',scope:'ACV',status:'pending'},
      {node_path:'R.001.002',scope:'CAC + churn_monthly',status:'pending'},
    ],
    authoritative_parent_variables:['CAC','ACV','churn_monthly','gross_margin'],
    uncovered_variable:'gross_margin',
    latest_rejection:{
      ordinal:3,
      reason:'COGNITION_CHILD_OVERLAP',
      similarity:0.9054054054054054,
      rejection_threshold:0.78,
      overlaps_sibling_ordinal:2,
    },
    child_authoring_failure_count:25,
  },
  observed_behavior:[
    'The overlap guard correctly rejects materially duplicated child requirements.',
    'After rejection, the runtime tells the bound model to treat the overlapping sibling as already assigned and to author only uncovered parent scope or return DONE.',
    'Despite that prose guidance, subsequent fresh discovery/formulation cycles keep proposing an overlapping ordinal-3 child.',
    'The model is spending roughly 14k-15k provider tokens per formulation attempt, plus discovery calls, without creating new semantic coverage.',
    'The current runtime tracks accepted siblings but does not expose an authoritative machine-readable remaining-scope set derived from the parent task and accepted child scopes.',
    'QDA601-M8-U1 Problem 1 explicitly supplies four variables in its authoritative exercise-pack reports: CAC, ACV, churn_monthly, gross_margin.',
  ],
  proposed_fix:{
    principle:'Preserve agent ownership of semantic decomposition while making already-covered scope explicit and bounded.',
    changes:[
      'Maintain a deterministic remaining-scope ledger for structured parent tasks: authoritative parent scope minus accepted child scope.',
      'For the next formulation call, provide machine-readable already_covered_scope and remaining_scope. For this incident remaining_scope=[gross_margin].',
      'The model still chooses CHILD or DONE and authors the child wording; the runtime does not fabricate the semantic child.',
      'After an overlap rejection, allow one corrected formulation attempt against the explicit remaining scope. If it still overlaps, return the parent to reconsider_decomposition instead of starting another broad loop.',
      'Reset child_authoring_failure_count after a child is accepted or a new semantic epoch begins; keep lifetime rejection evidence separately.',
      'Do not lower the 0.78 overlap threshold merely to force progress.'
    ]
  },
  constraints:[
    'Do not solve the QDA exercise.',
    'Do not recommend fabricating a child or hard-coding gross_margin as a special-case answer.',
    'The runtime may derive set subtraction only from authoritative structured task scope and already accepted child coverage.',
    'Bound-agent model must retain the semantic decision to author a child or declare DONE.',
    'Prefer a systemic fix that generalizes beyond this one unit.',
    'Assess whether failure-count reset is safe and how it should be bounded.'
  ]
};

export async function reviewSilasChildOverlapFixWithKimi(){
  const system=[
    'You are an independent AAU runtime adjudicator reviewing a proposed control-flow repair.',
    'Evaluate whether the proposed fix preserves agent autonomy while preventing repeated duplicate child authoring.',
    'Use only the supplied packet. Do not modify state or solve the underlying exercise.',
    'Return strict JSON only with keys verdict, root_cause, proposed_fix_assessment, required_changes, failure_counter_policy, regression_tests, confidence.',
    'verdict must be APPROVE, APPROVE_WITH_CHANGES, or REJECT.',
    'required_changes and regression_tests must be concise arrays.'
  ].join(' ');
  const started=Date.now();
  const result=await modelChatCompletion({
    provider:'moonshot_direct',
    model:'kimi-k3',
    messages:[{role:'system',content:system},{role:'user',content:JSON.stringify(childOverlapPacket)}],
    maxTokens:1000,
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
    raw:parsed?null:String(result.content||'').slice(0,5000),
  };
}
