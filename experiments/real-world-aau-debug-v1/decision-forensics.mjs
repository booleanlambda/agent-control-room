import {createHash} from 'node:crypto';
// AAU decision forensics v1: concise MODEL-AUTHORED justifications +
// deterministic independent runtime observations. Never save reasoning_content,
// raw prompts, source patches, provider messages, or unverifiable model thoughts.
// This is an audit trail of stated decisions, not a reproduction of reasoning.
export const FORENSICS_SCHEMA='aau-decision-forensics-v1';
const allowedSources=new Set([
 'original_source','public_verifier','provider_receipt','node_context',
 'prior_attempt','compute_budget'
]);
const allowedCases=new Set(['received','malformed','http_error','timeout']);
const unsafe=/PRIVATE_CANARY|SECRET_URL|bearer\s+|(?:api[_-]?key|password|secret|token)\s*[:=]|https?:\/\/|(?:[a-z0-9-]+\.)+(?:com|net|org|ai)(?:[\/:?#]|$)|BEGIN\s+(?:RSA|OPENSSH|PRIVATE)\s+KEY|(?:sk|pk)_[A-Za-z0-9_-]{15,}/i;
function clean(x,max){
 if(typeof x!=='string')return null;
 const s=x.trim();
 if(s.length<12||s.length>max||unsafe.test(s)||/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/.test(s))return null;
 return s;
}
const obj=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const safeId=x=>typeof x==='string'&&/^[a-z_][a-z0-9_]{1,71}$/.test(x)?x:null;
const safeHash=x=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x)?x:null;
const safeNode=x=>Number.isInteger(x)&&x>=0&&x<=100000?x:null;

export const MODEL_FORENSICS_INSTRUCTIONS=
 'Include decisionForensics in EVERY JSON response with: choice (short description), '+
 'rationale (brief decision summary, not private chain of thought), '+
 'evidence [{sourceId,caseId,observation}], alternatives [{option,rejection}], '+
 'expectedOutcome, uncertainty. sourceId must be one of: original_source, public_verifier, '+
 'provider_receipt, node_context, prior_attempt, compute_budget. caseId is a PUBLIC test name '+
 '(received, malformed, http_error, timeout) or null. Cite only evidence supplied to you; '+
 'acknowledge missing data as uncertainty. Name at least one alternative and why you declined it. '+
 'Keep each statement 1-2 sentences; no step-by-step hidden reasoning, credentials, '+
 'private reasoning_content, source code, quoted error payloads or URLs.';

export function validateModelDecision(answer){
 const d=answer?.decisionForensics;
 if(!obj(d))return {ok:false,reason:'MISSING_MODEL_DECISION_FORENSICS'};
 const choice=clean(d.choice,240),rationale=clean(d.rationale,420);
 const expectedOutcome=clean(d.expectedOutcome,280),uncertainty=clean(d.uncertainty,240);
 if(!choice||!rationale||!expectedOutcome||!uncertainty)
  return {ok:false,reason:'INVALID_MODEL_FORENSIC_SUMMARY'};
 if(!Array.isArray(d.evidence)||d.evidence.length<1||d.evidence.length>5)
  return {ok:false,reason:'INVALID_MODEL_FORENSIC_EVIDENCE'};
 const evidence=[];
 for(const v of d.evidence){
  const sourceId=allowedSources.has(v?.sourceId)?v.sourceId:null;
  const caseId=v?.caseId==null?null:allowedCases.has(v.caseId)?v.caseId:null;
  const observation=clean(v?.observation,280);
  if(!sourceId||!observation||(v?.caseId!=null&&!caseId))
   return {ok:false,reason:'INVALID_MODEL_FORENSIC_EVIDENCE'};
  evidence.push({sourceId,caseId,observation});
 }
 if(!Array.isArray(d.alternatives)||d.alternatives.length<1||d.alternatives.length>3)
  return {ok:false,reason:'MISSING_MODEL_FORENSIC_ALTERNATIVE'};
 const alternatives=[];
 for(const v of d.alternatives){
  const option=clean(v?.option,200),rejection=clean(v?.rejection,280);
  if(!option||!rejection)return {ok:false,reason:'INVALID_MODEL_FORENSIC_ALTERNATIVE'};
  alternatives.push({option,rejection});
 }
 return {ok:true,decision:{choice,rationale,evidence,alternatives,expectedOutcome,uncertainty}};
}

export function makeForensicLedger(){return {schema:FORENSICS_SCHEMA,modelDecisions:[],events:[]}}
function entryLimit(ledger){
 if(ledger.modelDecisions.length>=500||ledger.events.length>=2400)
  throw Error('FORENSIC_LEDGER_CAP_REACHED');
}
export function attachModelDecision(ledger,answer,{stage,nodeId=null,parentId=null,
 requestHash,responseHash}){
 entryLimit(ledger);
 const parsed=validateModelDecision(answer);
 if(!parsed.ok)return {ok:false,reason:parsed.reason};
 const stageId=safeId(stage);
 if(!stageId)return {ok:false,reason:'INVALID_MODEL_FORENSIC_STAGE'};
 const id='decision_'+(ledger.modelDecisions.length+1);
 const entry={id,stage:stageId,recordedAt:new Date().toISOString(),
  nodeId:safeNode(nodeId),parentId:safeNode(parentId),
  requestSha256:safeHash(requestHash),responseSha256:safeHash(responseHash),
  ...parsed.decision,
  modelClaimSha256:createHash('sha256').update(JSON.stringify(parsed.decision)).digest('hex'),
  modelStated:true,independentlyVerified:false,
  outcome:'AWAITING_INDEPENDENT_CHECK'};
 ledger.modelDecisions.push(entry);
 return {ok:true,id};
}
const allowedCodes=/^[A-Z][A-Z0-9_]{2,75}$/;
export function auditEvent(ledger,{kind,stage,decisionId=null,nodeId=null,parentId=null,
 candidateSha256=null,verification=null,budget=null,caseId=null,reasonCode=null}){
 entryLimit(ledger);
 const k=allowedCodes.test(kind??'')?kind:null,st=safeId(stage);
 if(!k||!st)throw Error('INVALID_FORENSIC_EVENT');
 const permittedVerdicts=new Set([
  'PASS','FAIL','NOT_RUN','PROGRESS','REGRESSION','NO_PROGRESS',
  'REJECTED','PENDING','BLOCKED'
 ]);
 const data={
  seq:ledger.events.length+1,recordedAt:new Date().toISOString(),
  kind:k,stage:st,
  caseId:allowedCases.has(caseId)?caseId:null,
  reasonCode:allowedCodes.test(reasonCode??'')?reasonCode:null,
  decisionId:typeof decisionId==='string'&&/^decision_[0-9]{1,5}$/.test(decisionId)?decisionId:null,
  nodeId:safeNode(nodeId),parentId:safeNode(parentId),
  modelClaimSha256:ledger.modelDecisions.find(x=>x.id===decisionId)?.modelClaimSha256??null,
  candidateSha256:safeHash(candidateSha256),
  verification:verification&&permittedVerdicts.has(verification.verdict)?{
   verdict:verification.verdict,
   suite:['public','hidden'].includes(verification.suite)?verification.suite:null,
   casesExecuted:Number.isSafeInteger(verification.casesExecuted)?verification.casesExecuted:null,
   casesPassed:Number.isSafeInteger(verification.casesPassed)?verification.casesPassed:null
  }:null,
  budget:Number.isSafeInteger(budget)&&budget>=0?budget:null
 };
 const last=ledger.events[ledger.events.length-1];
 data.prevHash=last?.hash??'GENESIS';
 data.hash=createHash('sha256').update(JSON.stringify(data)).digest('hex');
 ledger.events.push(data);
 return data;
}
export function resolveModelDecision(ledger,id,{outcome,verified}={}){
 const d=ledger.modelDecisions.find(x=>x.id===id);
 if(!d)return false;
 if(!new Set(['PASS','FAIL','PROGRESS','NO_PROGRESS','REGRESSION','REJECTED',
  'BLOCKED','ACCEPTED_FOR_TEST','DECOMPOSITION_QUEUED']).has(outcome))return false;
 d.outcome=outcome;
 d.independentlyVerified=verified===true;
 return true;
}
