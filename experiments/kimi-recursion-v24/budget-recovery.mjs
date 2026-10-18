// V28 frozen budget and single-exhaustion decomposition rules.
// max_tokens is a shared completion ceiling, NOT a separate guarantee
// of 32,768 private reasoning tokens plus final response.
export const THINKING_MAX_COMPLETION_TOKENS=32768;
export const INSTANT_MAX_COMPLETION_TOKENS=4096;
export const MAX_LOGICAL_PATCHES_PER_NODE=2;
export const MAX_DECOMPOSITIONS_PER_NODE=1;
export const MAX_DECOMPOSED_CHILDREN=2;

export function isKnownThinkingExhaustion(stage,choice,httpOk){
 // Only the provider's explicit length finish is an identified budget limit.
 // Timeouts, disconnects, JSON errors, provider errors are *uncertain* and
 // must be held for manual review, never reissued automatically.
 return httpOk===true&&/^repair_[0-9]$/.test(stage)&&
   choice?.finish_reason==='length';
}
export function remainingPatchSlots(state,level){
 const used=state.repairCounts?.[level]??0;
 if(!Number.isSafeInteger(used)||used<0||used>MAX_LOGICAL_PATCHES_PER_NODE)
  throw Error('LOGICAL_REPAIR_COUNTER_INVALID');
 return MAX_LOGICAL_PATCHES_PER_NODE-used;
}
export function planExhaustion(state,level){
 if(!Number.isInteger(level)||level<0||level>9)throw Error('BAD_DEPTH');
 if(state.exhaustions?.[level]||state.decompositions?.[level])
  return {allowed:false,reason:'NO_REPEAT_THINKING_EXHAUSTION'};
 if(remainingPatchSlots(state,level)===0)
  return {allowed:false,reason:'LOGICAL_REPAIR_SLOTS_EXHAUSTED'};
 return {allowed:true,nextPhase:'decompose_'+level,remaining:remainingPatchSlots(state,level)};
}
export function parseDecomposition(answer,remaining){
 if(!Number.isInteger(remaining)||remaining<1||remaining>MAX_DECOMPOSED_CHILDREN)
  throw Error('BAD_DECOMPOSITION_REMAINING');
 const tasks=answer?.tasks;
 if(!Array.isArray(tasks)||tasks.length<1||tasks.length>remaining)
  throw Error('DECOMPOSITION_TASK_COUNT_INVALID');
 const parsed=tasks.map((task,i)=>{
  if(!task||typeof task!=='object'||Array.isArray(task))throw Error('DECOMPOSITION_TASK_SHAPE');
  const focus=task.focus,acceptanceCriterion=task.acceptanceCriterion;
  if(typeof focus!=='string'||focus.trim().length<12||focus.length>280||
     typeof acceptanceCriterion!=='string'||acceptanceCriterion.trim().length<12||
     acceptanceCriterion.length>280)throw Error('DECOMPOSITION_TASK_BOUNDS');
  return {index:i,focus:focus.trim(),acceptanceCriterion:acceptanceCriterion.trim()};
 });
 if(new Set(parsed.map(x=>x.focus)).size!==parsed.length)
  throw Error('DUPLICATE_DECOMPOSITION_TASK');
 return parsed;
}
export function recoveryAfterFailedVerification(state,level){
 if(remainingPatchSlots(state,level)===0)return {nextPhase:null,status:'failed',reason:'LOGICAL_REPAIR_BUDGET_EXHAUSTED'};
 const d=state.decompositions?.[level];
 if(d){
  // Once a max-think repair is exhausted, do NOT revisit that 32K call.
  if(d.cursor<d.tasks.length)return {nextPhase:'repair_piece_'+level,status:'running',reason:'NEXT_BOUNDED_INSTANT_CHILD'};
  return {nextPhase:null,status:'blocked',reason:'DECOMPOSED_CHILDREN_EXHAUSTED'};
 }
 return {nextPhase:'repair_'+level,status:'running',reason:'THINKING_REPAIR'};
}
