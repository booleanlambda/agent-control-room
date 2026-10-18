// Three model-authored, distinct alternative approaches to a failed public repair.
// This state machine owns scheduling, not patch contents or hidden acceptance truth.
// Failed/regressed approaches are never admitted to the accepted source snapshot.
// Store only validated brief strategy descriptions, hashes, ordinal IDs and independently observed verdicts; never patches, private reasoning or hidden-case information.
import {createHash} from 'node:crypto';
const sha=x=>createHash('sha256').update(String(x)).digest('hex');
const forbidden=/PRIVATE_CANARY|SECRET_URL|bearer\s+|(?:api[_-]?key|password|secret|token)\s*[:=]|https?:\/\/|(?:[a-z0-9-]+\.)+(?:com|net|org|ai)(?:[\/:?#]|$)|BEGIN\s+(?:RSA|OPENSSH|PRIVATE)\s+KEY|(?:sk|pk)_[A-Za-z0-9_-]{15,}/i;
function field(value){
 if(typeof value!=='string')return null;
 const s=value.trim();
 return s.length>=12&&s.length<=800&&!forbidden.test(s)&&!/[\x00-\x08\x0B\x0C\x0E-\x1F]/.test(s)?s:null;
}
function normalized(s){return s.toLowerCase().replace(/\s+/g,' ').trim();}
const validHash=s=>typeof s==='string'&&/^[a-f0-9]{64}$/.test(s);
export const ALTERNATIVE_COUNT=3;
export function createAlternativeBranches(answer,baselineSha){
 if(!validHash(baselineSha))throw Error('ALTERNATIVE_BASELINE_HASH_INVALID');
 const input=answer?.branches;
 if(!Array.isArray(input)||input.length!==ALTERNATIVE_COUNT)
  throw Error('THREE_ALTERNATIVES_REQUIRED');
 const branches=input.map((x,i)=>{
  const approach=field(x?.approach),hypothesis=field(x?.hypothesis),
   acceptance=field(x?.acceptance);
  if(!approach||!hypothesis||!acceptance)throw Error('ALTERNATIVE_NODE_INVALID');
  return Object.freeze({id:i+1,approach,hypothesis,acceptance,
   hypothesisSha256:sha(hypothesis),approachSha256:sha(approach),
   acceptanceSha256:sha(acceptance)});
 });
 if(new Set(branches.map(x=>normalized(x.approach))).size!==ALTERNATIVE_COUNT||
    new Set(branches.map(x=>normalized(x.hypothesis))).size!==ALTERNATIVE_COUNT||
    new Set(branches.map(x=>normalized(x.acceptance))).size!==ALTERNATIVE_COUNT)
  throw Error('ALTERNATIVE_APPROACH_DUPLICATED');
 return {branches,cursor:0,active:null,records:[],baselineSha,exhausted:false};
}
export function selectNextAlternative(state){
 if(state.active)throw Error('ALTERNATIVE_STILL_ACTIVE');
 if(state.exhausted||state.cursor>=state.branches.length)return null;
 const next=state.branches[state.cursor++];
 state.active=next.id;
 return next;
}
export function settleAlternative(state,{id,verdict,decisionId,sourceSha256,trialSha256,
 beforePassed=null,afterPassed=null,beforeProblems=null,afterProblems=null}){
 if(!Number.isInteger(id)||state.active!==id)throw Error('ALTERNATIVE_ORDER_INVALID');
 if(!['PASS','PROGRESS','NO_PROGRESS','REGRESSION','INVALID_PATCH'].includes(verdict))
  throw Error('ALTERNATIVE_VERDICT_INVALID');
 if(!validHash(sourceSha256)|| (verdict!=='INVALID_PATCH'&&!validHash(trialSha256)))
  throw Error('ALTERNATIVE_CANDIDATE_HASH_INVALID');
 const accepted=verdict==='PASS'||verdict==='PROGRESS';
 const record={id,verdict,accepted,
  decisionId:typeof decisionId==='string'?decisionId:null,
  sourceSha256,trialSha256:validHash(trialSha256)?trialSha256:null,
  beforePassed:Number.isInteger(beforePassed)?beforePassed:null,
  afterPassed:Number.isInteger(afterPassed)?afterPassed:null,
  beforeProblems:Number.isInteger(beforeProblems)?beforeProblems:null,
  afterProblems:Number.isInteger(afterProblems)?afterProblems:null};
 state.records.push(record);
 state.active=null;
 // A partially improved candidate is retained, but unresolved public tests
 // justify trying the next model-authored alternative against that checkpoint.
 if(verdict==='PASS'||state.cursor>=ALTERNATIVE_COUNT)state.exhausted=true;
 return {record,tryNext:!state.exhausted,remaining:state.exhausted?0:ALTERNATIVE_COUNT-state.cursor};
}
export function alternativeSummary(state){
 return {required:ALTERNATIVE_COUNT,proposed:state.branches.length,
  baselineSha256:state.baselineSha,selectedCount:state.cursor,
  settledCount:state.records.length,remaining:state.exhausted?0:ALTERNATIVE_COUNT-state.cursor,
  exhausted:state.exhausted,activeId:state.active,
  branches:state.branches.map(x=>({id:x.id,approach:x.approach,
   hypothesis:x.hypothesis,acceptance:x.acceptance,
   approachSha256:x.approachSha256,hypothesisSha256:x.hypothesisSha256,
   acceptanceSha256:x.acceptanceSha256})),
  attempts:state.records.map(x=>({...x}))};
}
