import {createAlternativeBranches,selectNextAlternative,settleAlternative,alternativeSummary} from './alternative-branches.mjs';

export function createAlternativeExecutor({report,callModel,currentDecision,digest,resolveModelDecision,audit,save,
 normalizeModelOwnedPatches,applyModelPatch,runPublicVerification,focusedPatchDecision}){
const allowedLocalPatchErrors=new Set(['MODEL_PATCH_BAD_SPAN','MODEL_PATCH_NOT_EXACTLY_ONE_SPAN',
 'MODEL_PATCH_NOOP','MODEL_PATCH_TOO_LONG','MODEL_PATCH_NO_CHANGE',
 'MODEL_PATCH_COUNT_INVALID','FOCUSED_PATCH_TOO_MANY_EDITS','MODEL_OUTPUT_AMBIGUOUS_CONTAINERS']);
// A failed PUBLIC result triggers exactly three Kimi-authored, ranked repair approaches.
// Every approach is attempted only after an independent verifier judges its predecessor;
// non-progress/regression edits are rolled back. Partial progress is checkpointed.
// The user-facing "branches of thought" are observable hypotheses, NOT private reasoning.
async function runThreeAlternatives({candidate,check,triggerStage,node=null}){
 if(check.receipt.pass||!check.receipt.allCasesExecuted)throw Error('ALTERNATIVES_REQUIRE_FAILED_PUBLIC_SUITE');
 const ordinal=report.branchGroups.length+1,proposalStage='propose_alternatives_'+ordinal;
 const baseHash=digest(candidate.code),triggerDecisionId=currentDecision();
 const answer=await callModel(proposalStage,{
  incident:'The previous model-authored patch FAILED the independent PUBLIC verifier. Suggest EXACTLY THREE distinct alternative ways to repair the observed failure. Ranked from most promising to least. Explain each hypothesis and falsifiable acceptance criterion, without a source patch yet.',
  triggerStage,priorDecisionId:triggerDecisionId,currentCandidate:candidate.code,
  currentCandidateSha256:baseHash,publicFailures:check.publicFeedback,
  node:node?{id:node.id,depth:node.depth,issue:node.issue,acceptance:node.acceptance}:null,
  instruction:'Output JSON {branches:[{approach,hypothesis,acceptance},{approach,hypothesis,acceptance},{approach,hypothesis,acceptance}],decisionForensics:{...}}. Three different causal mechanisms, three testable approaches, and model-authored evidence. Do not modify independent tests or use hidden information.'
 },false);
 const proposalDecisionId=currentDecision();
 let state;
 try{state=createAlternativeBranches(answer,baseHash);}
 catch(e){
  if(!['THREE_ALTERNATIVES_REQUIRED','ALTERNATIVE_NODE_INVALID',
       'ALTERNATIVE_APPROACH_DUPLICATED','ALTERNATIVE_BASELINE_HASH_INVALID'].includes(e?.message))throw e;
  resolveModelDecision(report.forensics,proposalDecisionId,{outcome:'REJECTED'});
  audit({kind:'ALTERNATIVES_PROPOSAL_REJECTED',stage:proposalStage,
   decisionId:proposalDecisionId,reasonCode:e.message,candidateSha256:baseHash});
  throw Error('MODEL_ALTERNATIVES_INVALID');
 }
 const groupId='alternatives_'+ordinal;
 const group={id:groupId,triggerStage,triggerDecisionId,proposalDecisionId,
  baselineCandidateSha256:baseHash,status:'ACTIVE',nodeId:node?.id??null,
  summary:alternativeSummary(state)};
 report.branchGroups.push(group);
 resolveModelDecision(report.forensics,proposalDecisionId,{outcome:'DECOMPOSITION_QUEUED'});
 audit({kind:'ALTERNATIVES_PROPOSED',stage:proposalStage,decisionId:proposalDecisionId,
  candidateSha256:baseHash,branchGroupId:groupId});
 save();
 let acceptedAny=false;
 while(!check.receipt.pass){
  const option=selectNextAlternative(state);if(!option)break;
  const stage='alternative_patch_'+ordinal+'_'+option.id;
  const oldCandidate=candidate.code,oldCheck=check,sourceHash=digest(oldCandidate);
  audit({kind:'ALTERNATIVE_SELECTED',stage,
   decisionId:proposalDecisionId,branchGroupId:groupId,alternativeId:option.id,
   candidateSha256:sourceHash});
  group.summary=alternativeSummary(state);save();
  let suggestion;
  try{
   suggestion=await callModel(stage,{
    incident:'Implement the selected ALTERNATIVE approach, NOT the preceding failed one. Only a verifier can decide success.',
    currentCandidate:oldCandidate,currentCandidateSha256:sourceHash,
    selectedAlternative:option,publicFailures:oldCheck.publicFeedback,
    previousBranchResults:state.records.map(x=>({id:x.id,verdict:x.verdict,
     beforePassed:x.beforePassed,afterPassed:x.afterPassed,
     beforeProblems:x.beforeProblems,afterProblems:x.afterProblems})),
    instruction:'Return JSON {replacements:[{old:exact unique source span,replacement:new source},...],diagnosis:string,decisionForensics:{...}}. At most 3 edits, all model-authored; preserve previous public passes. No test changes, no raw provider secrets, no retry of ambiguous calls.'
   },false);
  }catch(e){
   // A provider, schema or compute-budget hold must never trigger paid replay.
   group.status='BLOCKED';group.summary=alternativeSummary(state);
   audit({kind:'ALTERNATIVE_INTERRUPTED',stage,
    branchGroupId:groupId,alternativeId:option.id,decisionId:proposalDecisionId,
    reasonCode:'MODEL_CALL_UNCERTAIN_OR_BLOCKED'});save();throw e;
  }
  const decisionId=currentDecision();
  let verdict='INVALID_PATCH',reason='MODEL_AUTHORED_PATCH_INVALID',trialSha=null;
  let beforePassed=null,afterPassed=null,beforeProblems=null,afterProblems=null;
  try{
   if(normalizeModelOwnedPatches(suggestion).length>3)throw Error('FOCUSED_PATCH_TOO_MANY_EDITS');
   const trial=applyModelPatch(oldCandidate,suggestion);trialSha=digest(trial.code);
   const verified=runPublicVerification(trial.code,'public');
   const comparison=focusedPatchDecision(oldCheck.receipt,verified.receipt);
   if(verified.receipt.pass&&!comparison.accept)throw Error('INDEPENDENT_VERIFIER_INCONSISTENT');
   beforePassed=comparison.previousPassed??null;afterPassed=comparison.currentPassed??null;
   beforeProblems=comparison.previousProblems??null;afterProblems=comparison.currentProblems??null;
   reason=comparison.reason;
   verdict=verified.receipt.pass?'PASS':comparison.accept?'PROGRESS':
    comparison.reason==='PUBLIC_REGRESSION'?'REGRESSION':'NO_PROGRESS';
   resolveModelDecision(report.forensics,decisionId,{outcome:verdict==='PASS'?'PASS':
    verdict==='PROGRESS'?'PROGRESS':verdict==='REGRESSION'?'REGRESSION':'NO_PROGRESS',verified:true});
   if(comparison.accept){candidate=trial;check=verified;acceptedAny=true;}
  }catch(e){
   if(!allowedLocalPatchErrors.has(e?.message))throw e;
   reason=e.message;
   resolveModelDecision(report.forensics,decisionId,{outcome:'REJECTED',verified:false});
   audit({kind:'ALTERNATIVE_INVALID_PATCH',stage,decisionId,reasonCode:reason,
    branchGroupId:groupId,alternativeId:option.id,candidateSha256:sourceHash});
  }
  settleAlternative(state,{id:option.id,verdict,decisionId,
   sourceSha256:sourceHash,trialSha256:trialSha,
   beforePassed,afterPassed,beforeProblems,afterProblems});
  group.summary=alternativeSummary(state);
  audit({kind:'ALTERNATIVE_SETTLED',stage,branchGroupId:groupId,alternativeId:option.id,
   decisionId,candidateSha256:trialSha,
   reasonCode:verdict==='PASS'?'ALTERNATIVE_PUBLIC_PASS':verdict==='PROGRESS'?'ALTERNATIVE_PROGRESS':
    verdict==='REGRESSION'?'ALTERNATIVE_REGRESSION':
    verdict==='INVALID_PATCH'?'ALTERNATIVE_INVALID_PATCH':'ALTERNATIVE_NO_PROGRESS'});
  save();
 }
 // Retain explicit forensic explanation of why any untried proposals were skipped.
 if(check.receipt.pass)for(const skipped of state.branches.slice(state.cursor))
  audit({kind:'ALTERNATIVE_SKIPPED',stage:proposalStage,decisionId:proposalDecisionId,
   branchGroupId:groupId,alternativeId:skipped.id,reasonCode:'EARLIER_ALTERNATIVE_PASSED'});
 group.status='COMPLETED';group.summary=alternativeSummary(state);
 audit({kind:'ALTERNATIVES_COMPLETED',stage:proposalStage,decisionId:proposalDecisionId,
  branchGroupId:groupId,candidateSha256:digest(candidate.code),
  reasonCode:check.receipt.pass?'PUBLIC_SUITE_PASSED':
   acceptedAny?'PARTIAL_PROGRESS':'ALL_ALTERNATIVES_FAILED'});
 save();return {candidate,check,acceptedAny};
}

return runThreeAlternatives;
}
