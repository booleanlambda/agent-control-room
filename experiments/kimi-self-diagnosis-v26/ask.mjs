// V26 one-time, non-mutating retrospective. Ask the SAME thinking-OFF Kimi model
// why its actual V25 level-one repair failed, using only archival public evidence.
// NO new solver, no retries, no hidden solutions, no production credentials.
import {Pool} from 'pg';
import {writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
const sha=x=>createHash('sha256').update(typeof x==='string'?x:JSON.stringify(x)).digest('hex');
if(process.env.GITHUB_ACTIONS!=='true'||process.env.AAU_V26_ONE_SHOT!=='yes')
 throw Error('ISOLATED_RESEARCH_CI_ONLY');
const runId='485862c5-8525-4b74-92ed-d242e6fbc277';
const report={experiment:'AAU_V26_KIMI_SELF_DIAGNOSIS_AFTER_V25_FAILED_TIE_REPAIR',
 sourceRun:runId,model:'kimi-k2.6',thinking:'disabled',callsAttempted:0,
 mutatesResearchState:false,mutatesProduction:false,providesGoldAnswers:false,
 includesHiddenProblems:false,status:'preflight',answer:null,startedAt:new Date().toISOString(),
 limitations:['This is a retrospective explanation, not a controlled observation of model internal reasoning',
 'The initial V25 model-authored Python is not persisted; only the last failed patched program and original two text diagnoses are available',
 'No code repair was requested or executed; no verified ability improvement is implied']};
const save=()=>writeFileSync('v26-kimi-self-diagnosis.json',JSON.stringify(report,null,2)+'\n');
let pool=null;
try{
 const url=String(process.env.NEON_V19_DATABASE_URL||'');
 const key=String(process.env.MOONSHOT_API_KEY||'');
 if(!/^postgres(?:ql)?:\/\//.test(url)||!key)throw Error('RESEARCH_CREDENTIAL_UNAVAILABLE');
 pool=new Pool({connectionString:url,ssl:{rejectUnauthorized:true},max:1,
  connectionTimeoutMillis:10000,statement_timeout:12000,
  application_name:'AAU_V26_POSTMORTEM_READ_ONLY'});
 const scope=await pool.query('select branch_id,marker from aau_research_v19.integration_scope');
 if(scope.rowCount!==1||scope.rows[0].branch_id!=='br-cold-rice-b4m3l9qu'||
   scope.rows[0].marker!=='AAU_V20_ISOLATED_LIVE_WORKER')
  throw Error('ISOLATED_NEON_BRANCH_MISMATCH');
 const data=await pool.query('select status,seq,state from aau_research_v23.runs where run_id=$1',[runId]);
 if(data.rowCount!==1||data.rows[0].status!=='failed'||data.rows[0].seq!==6)
  throw Error('SOURCE_PROVENANCE_INVALID');
 const state=data.rows[0].state;
 const source=state.source;
 if(typeof source!=='string'||source.length<50||state.providerCalls!==3||
    state.verifiedDepth!==0||state.repairs?.length!==2||
    state.repairs.some(x=>x.feedbackReason!=='LEXICOGRAPHIC_TIE_BREAK'))
  throw Error('SOURCE_FAILURE_MISMATCH');
 const failure=state.lastFailure;
 if(failure?.reason!=='LEXICOGRAPHIC_TIE_BREAK')throw Error('SOURCE_VERIFIER_DISAGREES');
 // Historical data are used as an audit record, never instructions for runtime.
 const record={
  userQuestion:'Why did you miss the tie-breaking invariant and why did both self-repair patches fail?',
  rule:'Among all minimum-total-cost feasible subsets, select the lexicographically smallest ASCENDING list of IDs. Arbitrary enumeration order is not a proof of lexicographic optimality.',
  failure:{reason:failure.reason,details:failure.details,caseIndex:failure.caseIndex??null},
  yourTwoContemporaneousDiagnoses:state.repairs.map(x=>({
    attempt:x.attempt,diagnosis:x.diagnosis,beforeCodeSha:x.beforeHash,
    afterCodeSha:x.afterHash,patchMode:x.patchMode})),
  finalFailedPython:source,
  unavailable:'The ORIGINAL pre-repair Python was not persisted, so do not claim to have inspected it. The displayed source is AFTER both attempted repairs.',
  requestedResponse:{
    problemMechanism:'Identify the exact decision or pruning code pattern that made a lexicographic tie failure possible; distinguish evidence from guess.',
    diagnosisOfTwoRepairs:'For each repair explain why its diagnosis or code edit did not result in a passing implementation; say when evidence is insufficient.',
    reasonSelfRemediationWasInsufficient:'What limitation of the repair workflow amplified the problem?',
    minimumGeneralArchitecturalChange:'Suggest one architecture-level check that would detect this problem WITHOUT supplying the gold answer and without hardcoding this family.',
    uncertainty:'State which claims cannot be concluded from these artifacts.'
  }
 };
 report.sourceHash=sha(source);
 report.promptEvidenceHash=sha(record);
 report.publicFailureReason=failure.reason;
 const messages=[{role:'system',content:'You are Kimi K2.6 with thinking OFF. This is a postmortem on YOUR own previous failed software reasoning attempt. Do not assume that you can inspect your historical hidden internal reasoning. Do not claim access to original Python when only the final patched version is shown. No expected oracle answer or hidden benchmark is provided. Do NOT repair or generate new code. Give specific, falsifiable code-path analysis and separate evidence from hypotheses. Reply ONE JSON object with keys problemMechanism, diagnosisOfTwoRepairs, reasonSelfRemediationWasInsufficient, minimumGeneralArchitecturalChange, uncertainty.'},
 {role:'user',content:JSON.stringify(record)}];
 const body={model:'kimi-k2.6',thinking:{type:'disabled'},temperature:0,
  max_tokens:1700,stream:false,response_format:{type:'json_object'},messages};
 report.requestHash=sha(body);
 report.status='model_attempt_sent_or_uncertain';
 report.callsAttempted=1;save(); // Durable local CI evidence BEFORE potentially billable request.
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),175000);
 try{
  const res=await fetch('https://api.moonshot.ai/v1/chat/completions',
   {method:'POST',redirect:'manual',signal:controller.signal,
    headers:{authorization:'Bearer '+key,'content-type':'application/json',accept:'application/json'},body:JSON.stringify(body)});
  const j=await res.json().catch(()=>({}));
  report.providerTokens=j?.usage?.total_tokens??null;
  report.finishReason=j?.choices?.[0]?.finish_reason??null;
  const m=j?.choices?.[0]?.message;
  if(!res.ok||report.finishReason!=='stop'||m?.reasoning_content)throw Error('PROVIDER_RESPONSE_INCOMPLETE');
  const parsed=JSON.parse(m?.content||'');
  const keys=['problemMechanism','diagnosisOfTwoRepairs','reasonSelfRemediationWasInsufficient','minimumGeneralArchitecturalChange','uncertainty'];
  if(!parsed||typeof parsed!=='object'||keys.some(k=>!(k in parsed)))throw Error('MODEL_RESPONSE_SCHEMA_INVALID');
  report.answer=parsed;report.answerHash=sha(parsed);report.status='received';
 }finally{clearTimeout(timer)}
}catch(e){report.error=String(e.message||e).replace(/[^A-Z0-9_]/g,'').slice(0,90);
 if(report.status==='model_attempt_sent_or_uncertain')report.status='manual_hold';else report.status='failed';
}finally{
 if(pool)await pool.end().catch(()=>{});
 report.finishedAt=new Date().toISOString();save();
 console.log('V26_KIMI_POSTMORTEM='+JSON.stringify({status:report.status,
 model:report.model,thinking:report.thinking,providerCalls:report.callsAttempted,
 tokens:report.providerTokens??null,sourceRun:report.sourceRun,answer:report.answer??null,
 error:report.error??null}));
 if(report.status!=='received')process.exitCode=2;
}
