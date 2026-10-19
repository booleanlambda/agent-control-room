// Executable research-only branch-of-thought orchestrator.
// Kimi supplies three DIFFERENT hypotheses. Deterministic source isolation,
// oracle verdicts, fallbacks and forensic receipts decide what survives.
// This is not recording the model's private chain of thought.
import {createAlternativeBranches,selectNextAlternative,settleAlternative,alternativeSummary}
 from './alternative-branches.mjs';
const localPatchErrors=new Set([
 'MODEL_PATCH_BAD_SPAN','MODEL_PATCH_NOT_EXACTLY_ONE_SPAN','MODEL_PATCH_NOOP',
 'MODEL_PATCH_TOO_LONG','MODEL_PATCH_NO_CHANGE','MODEL_PATCH_COUNT_INVALID',
 'FOCUSED_PATCH_TOO_MANY_EDITS','MODEL_OUTPUT_AMBIGUOUS_CONTAINERS'
]);
const proposalErrors=new Set([
 'THREE_ALTERNATIVES_REQUIRED','ALTERNATIVE_NODE_INVALID',
 'ALTERNATIVE_APPROACH_DUPLICATED','ALTERNATIVE_BASELINE_HASH_INVALID'
]);
export async function runThreeAlternativeRepair({
 base,initialCandidate,initialCheck,plan,callModel,applyModelPatch,
 runPublicVerification,focusedPatchDecision,normalizeModelOwnedPatches,
 currentDecision,digest,audit,resolveDecision,report,save
}){
 let candidate=initialCandidate,check=initialCheck;
 if(check.receipt.pass)return {candidate,check,summary:null};
 const suggested=await callModel('propose_three_alternatives',{
  incident:'The first repair FAILED independent public tests. Propose three genuinely different competing ways to repair those failures; not three smaller subtasks.',
  originalSource:base,currentCandidate:candidate.code,
  publicFailures:check.publicFeedback,previousPlan:plan,
  instruction:'Return JSON {branches:[{approach,hypothesis,acceptance}, {approach,hypothesis,acceptance}, {approach,hypothesis,acceptance}]} AND top-level decisionForensics. Exactly three DISTINCT actionable solution approaches ordered by preference, each grounded in supplied PUBLIC failed-case evidence and independently testable; no patch yet, no inferred passing results.'
 },false);
 const proposalDecision=currentDecision();
 let state;
 try{state=createAlternativeBranches(suggested,digest(candidate.code))}
 catch(e){
  const reason=String(e?.message);
  if(!proposalErrors.has(reason))throw e;
  resolveDecision(proposalDecision,{outcome:'REJECTED',verified:false});
  audit({kind:'ALTERNATIVE_PLAN_REJECTED',stage:'propose_three_alternatives',
   decisionId:proposalDecision,reasonCode:reason});
  throw e;
 }
 resolveDecision(proposalDecision,{outcome:'DECOMPOSITION_QUEUED',verified:false});
 audit({kind:'ALTERNATIVE_PLAN_ACCEPTED',stage:'propose_three_alternatives',
  decisionId:proposalDecision,candidateSha256:digest(candidate.code)});
 report.alternativeBranches=alternativeSummary(state);save();
 while(!check.receipt.pass){
  const branch=selectNextAlternative(state);
  if(!branch)break;
  const stage='try_alternative_'+branch.id;
  const sourceSha=digest(candidate.code), before=check;
  audit({kind:'ALTERNATIVE_SELECTED',stage,branchId:branch.id,
   decisionId:proposalDecision,candidateSha256:sourceSha});
  let verdict='INVALID_PATCH',decisionId=null,trialSha=null,gate=null;
  try{
   const answer=await callModel(stage,{
    incident:'Attempt the SELECTED one of three alternative model-authored repair hypotheses. Do not combine three untested patches.',
    selectedAlternative:{id:branch.id,approach:branch.approach,
     hypothesis:branch.hypothesis,acceptance:branch.acceptance},
    currentCandidate:candidate.code,currentCandidateSha256:sourceSha,
    publicFailures:check.publicFeedback,
    priorAlternativeOutcomes:state.records.map(x=>({id:x.id,verdict:x.verdict,
     beforePassed:x.beforePassed,afterPassed:x.afterPassed})),
    instruction:'Return JSON {replacements:[{old:EXACT UNIQUE currentCandidate span,replacement:NEW SOURCE},...],diagnosis:string} with top-level decisionForensics. Up to 3 exact, model-authored changes. No tests changed, no private errors, no automatic paid replay.'
   },false);
   decisionId=currentDecision();
   if(normalizeModelOwnedPatches(answer).length>3)throw Error('FOCUSED_PATCH_TOO_MANY_EDITS');
   const trial=applyModelPatch(candidate.code,answer);
   trialSha=digest(trial.code);
   audit({kind:'ALTERNATIVE_PATCH_BUILT',stage,branchId:branch.id,
    decisionId,candidateSha256:trialSha});
   const observed=runPublicVerification(trial.code,'public');
   gate=focusedPatchDecision(before.receipt,observed.receipt);
   verdict=gate.accept?(observed.receipt.pass?'PASS':'PROGRESS'):
    gate.reason==='PUBLIC_REGRESSION'?'REGRESSION':'NO_PROGRESS';
   resolveDecision(decisionId,{
    outcome:verdict==='PASS'?'PASS':verdict==='PROGRESS'?'PROGRESS':
     verdict==='REGRESSION'?'REGRESSION':'NO_PROGRESS',verified:true});
   audit({kind:gate.accept?'ALTERNATIVE_PATCH_ACCEPTED':'ALTERNATIVE_PATCH_REJECTED',
    stage,branchId:branch.id,decisionId,candidateSha256:trialSha,
    reasonCode:gate.reason,verification:{verdict:gate.accept?'PROGRESS':'NO_PROGRESS',
     suite:'public',casesExecuted:observed.receipt.cases.length,
     casesPassed:observed.receipt.cases.filter(x=>x.passed).length}});
   if(gate.accept){candidate=trial;check=observed;}
  }catch(e){
   const reason=String(e?.message);
   if(!localPatchErrors.has(reason))throw e;
   decisionId=decisionId??currentDecision();
   resolveDecision(decisionId,{outcome:'REJECTED',verified:false});
   audit({kind:'ALTERNATIVE_PATCH_INVALID',stage,branchId:branch.id,
    decisionId,candidateSha256:sourceSha,reasonCode:reason});
  }
  const result=settleAlternative(state,{id:branch.id,verdict,decisionId,
   sourceSha256:sourceSha,trialSha256:trialSha,
   beforePassed:gate?.previousPassed,afterPassed:gate?.currentPassed,
   beforeProblems:gate?.previousProblems,afterProblems:gate?.currentProblems});
  audit({kind:'ALTERNATIVE_SETTLED',stage,branchId:branch.id,
   decisionId,candidateSha256:digest(candidate.code),reasonCode:'BRANCH_'+verdict});
  report.alternativeBranches=alternativeSummary(state);save();
  if(result.tryNext){
   audit({kind:'ALTERNATIVE_FALLBACK',stage,branchId:branch.id,
    decisionId,candidateSha256:digest(candidate.code),
    reasonCode:verdict==='PROGRESS'?'PUBLIC_TESTS_REMAIN_FAILING':'PREVIOUS_ALTERNATIVE_FAILED'});
  }else{
   audit({kind:check.receipt.pass?'ALTERNATIVE_SOLUTION_VERIFIED':'ALTERNATIVES_EXHAUSTED',
    stage,branchId:branch.id,decisionId,candidateSha256:digest(candidate.code),
    reasonCode:check.receipt.pass?'VERIFIED_PUBLIC_PASS':'THREE_BRANCHES_SETTLED'});
  }
 }
 return {candidate,check,summary:alternativeSummary(state)};
}
