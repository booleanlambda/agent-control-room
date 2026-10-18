import {createHash} from 'node:crypto';

// Read-only verification of the recorded forensic chain and decisions.
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
