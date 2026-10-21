// Controlled unfamiliar-fault study. These are INJECTED faults, not organic
// failures attributed to Kimi. Their locations, changes, and hidden examples
// are sealed from the model; all sources were originally written by Kimi.
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {TASKS,grade} from './unseen-python-benchmarks.mjs';
import {runIsolatedPython} from './unseen-python-sandbox.mjs';
const hash=x=>createHash('sha256').update(String(x)).digest('hex');
export const FAULTS=[
 {id:'assignment',class:'hidden_switched_cost_condition',
  sourceKind:'v5',
  hash:'732f54bc7b428ef7d670c721c669060b2d0cf1741a339bdc0d33120862d5042b',
  find:'if m!=last_m:',replacement:'if m==last_m:'},
 {id:'routing',class:'energy_not_deducted_from_edge',
  sourceKind:'initial',
  hash:'dd10e494f4d82e3f11e7ee98d64afb887d037631c54185f6eb40eefb1fe2b9eb',
  find:'new_e = e - energy_needed',replacement:'new_e = e'},
 {id:'number-theory',class:'reversed_congruence_condition',
  sourceKind:'initial',
  hash:'a8e14b765deaf6a7fdc7e7b2d4aeead9ed19cdd8f4415b8709bb1fbe1babcd16',
  find:'if (x * x + 3 * y + 2 * z) % 17 != modTarget:',
  replacement:'if (x * x + 3 * y + 2 * z) % 17 == modTarget:'},
];
export function sourceFromArtifacts(caseId){
 const info=FAULTS.find(x=>x.id===caseId);
 if(!info)throw Error('UNKNOWN_FAULT');
 let code;
 if(info.sourceKind==='v5'){
  const p=JSON.parse(readFileSync('prior-v5/self-remediation-v2-report.json','utf8'));
  if(p.model!=='kimi-k2.6'||p.status!=='manual_hold')throw Error('INVALID_V5_ARTIFACT');
  code=p.latestCode;
 }else{
  const p=JSON.parse(readFileSync('unseen-python-kimi-report.json','utf8'));
  if(p.model!=='kimi-k2.6')throw Error('INVALID_INITIAL_ARTIFACT');
  code=p.suites.find(x=>x.id===caseId)?.submissions?.[0]?.code;
 }
 if(typeof code!=='string'||hash(code)!==info.hash)
  throw Error('MODEL_SOURCE_SHA_MISMATCH_'+caseId);
 const locations=code.split(info.find);
 if(locations.length!==2)throw Error('NON_UNIQUE_FAULT_INJECTION_ANCHOR_'+caseId);
 const corrupted=code.replace(info.find,info.replacement);
 return {info,original:code,corrupted,
   originalHash:hash(code),faultyHash:hash(corrupted)};
}
export async function preflightCase(caseId){
 const task=TASKS.find(x=>x.id===caseId),src=sourceFromArtifacts(caseId);
 const healthyPublic=await runIsolatedPython(src.original,task.public);
 const healthyHidden=await runIsolatedPython(src.original,task.hidden);
 if(!healthyPublic.ok||!healthyHidden.ok||
 !grade(caseId,task.public,healthyPublic.result).passed||
 !grade(caseId,task.hidden,healthyHidden.result).passed)
   throw Error('NON_WORKING_BASELINE_'+caseId);
 const failing=await runIsolatedPython(src.corrupted,task.public);
 const audit=failing.ok?grade(caseId,task.public,failing.result):null;
 if(failing.ok&&audit.passed)
  throw Error('FAULT_NOT_OBSERVABLE_ON_PUBLIC_CASE_'+caseId);
 return {caseId,healthyPublic:healthyPublic.result,
  healthyHidden:healthyHidden.result,
  faultedPublic:failing.ok?failing.result:null,
  observable:{runCompleted:failing.ok,
   failureKind:failing.ok?'wrong_or_invalid_result':failing.error,
   publicOutput:failing.ok?failing.result:null,
   observedValidation:failing.ok?audit.observed:null,
   executionStderr:failing.ok?null:String(failing.stderr||'').slice(0,1200)},
  corruptedSource:src.corrupted,
  evidence:{originalHash:src.originalHash,faultyHash:src.faultyHash,
   injectedFaultClass:src.info.class,
   injectedAnchor:src.info.find,
   injectedReplacement:src.info.replacement}};
}
