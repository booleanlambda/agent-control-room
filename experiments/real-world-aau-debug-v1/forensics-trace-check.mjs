import {createHash} from 'node:crypto';

// Read-only verification of the recorded forensic chain and decisions.
function inspectAlternativeGroups(report,events,decisions,calls){
 const groups=report?.branchGroups??[],issues=[];
 if(!Array.isArray(groups))return ['ALTERNATIVE_GROUP_RECORD_INVALID'];
 const decIds=new Set(decisions.map(x=>x.id)),ids=new Set();
 for(const g of groups){
  const groupId=g?.id,summary=g?.summary;
  if(typeof groupId!=='string'||!/^alternatives_[1-9][0-9]{0,3}$/.test(groupId)||
   ids.has(groupId)||!summary||summary.required!==3||summary.proposed!==3||
   summary.branches?.length!==3||summary.attempts?.length>3){
   issues.push('ALTERNATIVE_GROUP_INVALID');continue;
  }
  ids.add(groupId);
  if(!decIds.has(g.proposalDecisionId)||!events.some(e=>e.kind==='ALTERNATIVES_PROPOSED'&&
    e.branchGroupId===groupId&&e.decisionId===g.proposalDecisionId))
   issues.push('ALTERNATIVE_PROPOSAL_UNLINKED');
  if(summary.baselineSha256!==g.baselineCandidateSha256||
    new Set(summary.branches.map(x=>x.approachSha256)).size!==3)
   issues.push('ALTERNATIVE_DISTINCTNESS_OR_BASELINE_INVALID');
  const selected=events.filter(e=>e.kind==='ALTERNATIVE_SELECTED'&&e.branchGroupId===groupId);
  const settled=events.filter(e=>e.kind==='ALTERNATIVE_SETTLED'&&e.branchGroupId===groupId);
  const skipped=events.filter(e=>e.kind==='ALTERNATIVE_SKIPPED'&&e.branchGroupId===groupId);
  if(selected.length!==summary.selectedCount||settled.length!==summary.settledCount||
    summary.attempts?.length!==settled.length||
    selected.some((x,i)=>x.alternativeId!==i+1)||
    settled.some((x,i)=>x.alternativeId!==i+1))
   issues.push('ALTERNATIVE_ORDER_OR_COVERAGE_INVALID');
  const passed=summary.attempts.some(a=>a.verdict==='PASS');
  if(passed&&(skipped.length!==3-summary.selectedCount||
    skipped.some((x,i)=>x.alternativeId!==summary.selectedCount+i+1)))
   issues.push('ALTERNATIVE_SKIP_AUDIT_MISSING');
  if(g.status==='COMPLETED'){
   if(summary.activeId!==null||!events.some(e=>e.kind==='ALTERNATIVES_COMPLETED'&&e.branchGroupId===groupId)||
    (!passed&&summary.settledCount!==3))
    issues.push('ALTERNATIVE_COMPLETION_INVALID');
  }else if(g.status==='BLOCKED'){
   if(!events.some(e=>e.kind==='ALTERNATIVE_INTERRUPTED'&&e.branchGroupId===groupId))
    issues.push('ALTERNATIVE_BLOCKER_UNRECORDED');
  }else issues.push('ALTERNATIVE_GROUP_UNFINISHED');
  for(const a of summary.attempts){
   const stage='alternative_patch_'+groupId.slice(13)+'_'+a.id;
   if(!decIds.has(a.decisionId)||!calls.some(c=>c.stage===stage&&
      c.forensicDecisionId===a.decisionId)||
      !settled.some(e=>e.alternativeId===a.id&&e.decisionId===a.decisionId))
    issues.push('ALTERNATIVE_DECISION_UNLINKED');
   if(a.verdict!=='INVALID_PATCH'&&
    !(report.tests??[]).some(t=>t.suite==='public'&&t.candidateSha256===a.trialSha256))
    issues.push('ALTERNATIVE_VERIFIER_RECEIPT_MISSING');
  }
 }
 return [...new Set(issues)];
}

// Never rewrite the evidence to make missing steps look complete.
export function inspectForensicsReport(report){
 const decisions=report?.forensics?.modelDecisions;
 const events=report?.forensics?.events;
 const calls=report?.modelCalls;
 const issues=[],counts={};
 if(!Array.isArray(decisions)||!Array.isArray(events)||!Array.isArray(calls))
  return {pass:false,issues:['FORENSIC_EVIDENCE_MISSING'],counts};
 const decisionById=new Map(decisions.map(x=>[x.id,x]));
 const claimHash=d=>createHash('sha256').update(JSON.stringify({
  choice:d.choice,rationale:d.rationale,evidence:d.evidence,
  alternatives:d.alternatives,expectedOutcome:d.expectedOutcome,uncertainty:d.uncertainty
 })).digest('hex');
 let prevHash='GENESIS';
 for(const [i,event] of events.entries()){
  counts[event.kind]=(counts[event.kind]??0)+1;
  const {hash,...body}=event;
  const recomputed=createHash('sha256').update(JSON.stringify(body)).digest('hex');
  if(event.seq!==i+1||event.prevHash!==prevHash||hash!==recomputed)
   issues.push('FORENSIC_EVENT_CHAIN_INVALID');
  prevHash=hash;
  if(event.decisionId){
   const linked=decisionById.get(event.decisionId);
   if(!linked||event.modelClaimSha256!==linked.modelClaimSha256)
    issues.push('FORENSIC_EVENT_DECISION_LINK_INVALID');
  }
 }
 for(const d of decisions){
  if(d.modelStated!==true||d.modelClaimSha256!==claimHash(d))
   issues.push('MODEL_DECISION_HASH_MISMATCH');
  if(typeof d.choice!=='string'||typeof d.rationale!=='string'||
     !Array.isArray(d.evidence)||d.evidence.length===0||
     !Array.isArray(d.alternatives)||d.alternatives.length===0||
     typeof d.expectedOutcome!=='string'||typeof d.uncertainty!=='string')
   issues.push('MODEL_DECISION_REQUIRED_FIELD_MISSING');
  if(!calls.some(c=>c.forensicDecisionId===d.id&&c.stage===d.stage))
   issues.push('MODEL_DECISION_HAS_NO_CALL');
 }
 for(const c of calls){
  if(c.status==='model_decision_forensics_invalid')issues.push('PROVIDER_RESPONSE_REJECTED_MISSING_FORENSICS');
  if(c.status==='accepted'){
   if(!decisionById.has(c.forensicDecisionId)||decisionById.get(c.forensicDecisionId)?.stage!==c.stage)
    issues.push('ACCEPTED_PROVIDER_CALL_LACKS_JUSTIFICATION');
   if(!events.some(e=>e.kind==='MODEL_DECISION_RECORDED'&&e.decisionId===c.forensicDecisionId))
    issues.push('ACCEPTED_PROVIDER_CALL_MISSING_AUDIT_EVENT');
  }
  if(!events.some(e=>e.kind==='PROVIDER_CALL_PREPARED'&&e.stage===c.stage)||
     !events.some(e=>e.kind==='PROVIDER_CALL_SETTLED'&&e.stage===c.stage))
   issues.push('PROVIDER_ATTEMPT_MISSING_AUDIT');
 }
 for(const t of report?.tests??[]){
  if(!events.some(e=>e.kind==='VERIFICATION_SUITE_COMPLETED'&&
    e.candidateSha256===t.candidateSha256&&e.verification?.suite===t.suite))
   issues.push('VERIFIER_SUITE_MISSING_AUDIT');
 }
 if(events.length&&!events.some(e=>e.kind==='EXECUTION_FINISHED'))
  issues.push('FINAL_OUTCOME_MISSING_AUDIT');
 issues.push(...inspectAlternativeGroups(report,events,decisions,calls));
 const unique=Array.from(new Set(issues));
 return {
  pass:unique.length===0,issues:unique,
  acceptedCalls:calls.filter(c=>c.status==='accepted').length,
  acceptedCallsJustified:calls.filter(c=>c.status==='accepted'&&decisionById.has(c.forensicDecisionId)).length,
  modelDecisions:decisions.length,events:events.length,
  publicSuites:(report?.tests??[]).filter(t=>t.suite==='public').length,
  hiddenSuites:(report?.tests??[]).filter(t=>t.suite==='hidden').length,
  decisionsWithVerifiedOutcome:decisions.filter(d=>d.independentlyVerified===true).length,
  decisionOutcomes:decisions.map(d=>({id:d.id,stage:d.stage,
   modelClaimSha256:d.modelClaimSha256,
   outcome:d.outcome,independentlyVerified:d.independentlyVerified})),
  eventCounts:counts
 };
}
