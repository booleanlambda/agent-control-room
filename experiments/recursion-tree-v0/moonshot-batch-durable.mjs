// Isolated one-time Kimi K2.6 durable batch experiment. No production access.
// Submit ONCE, save batch_id to disk, exit process; a separate Node process
// retrieves it. Never recreate an uncertain batch after a lost create response.
// Official Moonshot Batch API, 4 independent leaf diagnostics, 24h SLA.
import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {CASES} from './engine.mjs';

const MODE=process.argv[2];
const OUT='kimi-batch-recovery-checkpoint.json';
const REPORT='kimi-batch-recovery-report.json';
const KEY=String(process.env.MOONSHOT_API_KEY||'').trim();
const BASE='https://api.moonshot.ai/v1';
const JOB_CASES=CASES.slice(0,4);
const MODEL='kimi-k2.6';
const now=()=>new Date().toISOString();
const sha=x=>createHash('sha256').update(String(x)).digest('hex');
const sleep=n=>new Promise(r=>setTimeout(r,n));
if(!KEY||!['submit','resume'].includes(MODE)||process.env.AAU_EXPERIMENT_BATCH!=='yes')
  throw Error('UNAUTHORIZED_BATCH_EXPERIMENT');
const prompt=c=>[
  {role:'system',content:'Classify runtime errors. Return EXACTLY one lowercase label from budget, provider, cognition, evidence, scheduler, unknown. No commentary.'},
  {role:'user',content:'Classify the error: '+c.error},
];
const load=()=>JSON.parse(readFileSync(OUT,'utf8'));
const persist=o=>writeFileSync(OUT,JSON.stringify(o,null,2)+'\n');
const saveReport=o=>writeFileSync(REPORT,JSON.stringify(o,null,2)+'\n');
async function api(path,{method='GET',body,timeout=30000,headers={}}={}){
  const ctl=new AbortController(),timer=setTimeout(()=>ctl.abort(),timeout);
  try{
    const r=await fetch(BASE+path,{method,headers:{
      authorization:'Bearer '+KEY,accept:'application/json',...headers},body,
      signal:ctl.signal,redirect:'manual'});
    const text=await r.text();
    let data={};try{data=JSON.parse(text)}catch{}
    return {ok:r.ok,status:r.status,data,raw:text};
  }finally{clearTimeout(timer)}
}
const usage=x=>({
  input:Number(x?.prompt_tokens||0),output:Number(x?.completion_tokens||0),
  cached:Number(x?.prompt_tokens_details?.cached_tokens||0),
  total:Number(x?.total_tokens||0)});
function price(u,factor=1){
  return Number(((u.input*0.95+u.output*4)/1e6*factor).toFixed(8));
}
function initial(){
  return {experiment:'AAU_KIMI_K26_BATCH_DURABILITY_V1',
    stage:'prepared',createdAt:now(),model:MODEL,rows:JOB_CASES.length,
    expected:Object.fromEntries(JOB_CASES.map(c=>[c.id,c.expected])),
    input_file_id:null,batch_id:null,submissionAttempts:0,
    completion_window:'24h',provider_model_responses:0,
    batchStatus:null,syncBaseline:null,syncCallAttempted:false,
    pollChecks:0,assessment:null,notes:[]};
}
async function submit(){
  if(existsSync(OUT))throw Error('CHECKPOINT_EXISTS_REFUSE_DUPLICATE_BATCH_CREATE');
  const state=initial();persist(state);
  const jsonl=JOB_CASES.map(c=>JSON.stringify({
    custom_id:c.id,method:'POST',url:'/v1/chat/completions',
    body:{model:MODEL,messages:prompt(c),thinking:{type:'disabled'},max_tokens:80,
      stream:false},
  })).join('\n')+'\n';
  if(Buffer.byteLength(jsonl)>30000)throw Error('INPUT_TOO_LARGE');
  const fd=new FormData();
  fd.set('purpose','batch');
  fd.set('file',new Blob([jsonl],{type:'application/jsonl'}),'aau-four-leaf-input.jsonl');
  state.stage='uploading';persist(state);
  let uploaded;
  try{uploaded=await api('/files',{method:'POST',body:fd,timeout:60000});}
  catch(e){state.stage='upload_uncertain';state.notes.push(String(e?.name||'transport'));persist(state);
    throw Error('UPLOAD_UNCERTAIN_DO_NOT_REUPLOAD_AUTOMATICALLY')}
  if(!uploaded.ok||!uploaded.data.id){
    state.stage='upload_rejected';state.uploadHttp=uploaded.status;
    state.uploadErrorType=String(uploaded.data?.error?.type||'').slice(0,80);
    persist(state);throw Error('FILE_UPLOAD_REJECTED_'+uploaded.status);
  }
  state.input_file_id=String(uploaded.data.id);state.stage='file_uploaded';persist(state);
  state.stage='batch_create_in_flight';state.submissionAttempts++;persist(state);
  let batch;
  try{batch=await api('/batches',{method:'POST',timeout:60000,
    headers:{'content-type':'application/json'},
    body:JSON.stringify({input_file_id:state.input_file_id,
      endpoint:'/v1/chat/completions',completion_window:'24h'})});}
  catch(e){state.stage='creation_uncertain';state.notes.push(String(e?.name||'transport'));persist(state);
    throw Error('BATCH_CREATE_UNCERTAIN_NEVER_AUTO_RESUBMIT')}
  if(!batch.ok||!batch.data.id){
    state.stage='batch_create_rejected';state.createHttp=batch.status;
    state.createErrorType=String(batch.data?.error?.type||'').slice(0,100);
    persist(state);throw Error('BATCH_CREATION_REJECTED_'+batch.status);
  }
  state.batch_id=String(batch.data.id);state.stage='created';
  state.batchStatus=String(batch.data.status||'unknown');state.createdBatchAt=now();
  persist(state); // durable ID written BEFORE any further external call
  console.log('KIMI_BATCH_SUBMITTED='+JSON.stringify({
    fileIdDigest:sha(state.input_file_id),batchIdDigest:sha(state.batch_id),
    rows:state.rows,status:state.batchStatus,submissionAttempts:state.submissionAttempts}));
  // Exactly one synchronous control sample for same CASE E01, distinct
  // request, not a retry, never used for batch recovery.
  state.syncCallAttempted=true;persist(state);
  const started=Date.now();
  try{
    const sync=await api('/chat/completions',{method:'POST',
      headers:{'content-type':'application/json'},timeout:65000,
      body:JSON.stringify({model:MODEL,messages:prompt(JOB_CASES[0]),
        thinking:{type:'disabled'},max_tokens:80,stream:false})});
    const choice=sync.data?.choices?.[0],answer=String(choice?.message?.content||'').trim().toLowerCase();
    const u=usage(sync.data?.usage);
    state.syncBaseline={http:sync.status,latencyMs:Date.now()-started,
      answerCorrect:answer===JOB_CASES[0].expected,
      accepted:sync.ok&&choice?.finish_reason==='stop'&&answer===JOB_CASES[0].expected,
      usage:u,costEstimateUsd:price(u),answerDigest:sha(answer)};
  }catch(e){state.syncBaseline={status:'transport_unknown',reason:String(e?.name||'transport_error')};}
  state.stage='submitted_client_exited';persist(state);
  // This process exits. The next CI step performs a fresh auth/network
  // handshake, reads the ID from disk and reattaches without any new batch POST.
  console.log('KIMI_BATCH_SUBMIT_EXIT='+JSON.stringify({status:state.batchStatus,
    syncBaseline:state.syncBaseline,createdBatchIdPersisted:Boolean(state.batch_id)}));
}
async function resume(){
  const state=load();
  if(!state.batch_id||state.submissionAttempts!==1||
    !['created','submitted_client_exited','checking','pending','completed','failed','expired','cancelled'].includes(state.stage))
    throw Error('UNSAFE_TO_RESUME_WITHOUT_DURABLE_BATCH_ID');
  const started=Date.now();
  const polls=[];
  let data=null,outputText=null;
  for(let i=0;i<20;i++){
    state.stage='checking';persist(state);
    const response=await api('/batches/'+encodeURIComponent(state.batch_id));
    state.pollChecks++;state.lastCheckedAt=now();
    if(!response.ok){state.stage='pending';state.notes.push('retrieve_http_'+response.status);persist(state);break;}
    data=response.data;state.batchStatus=String(data.status||'unknown');
    state.counts=data.request_counts||null;state.output_file_id=data.output_file_id||null;
    state.error_file_id=data.error_file_id||null;
    polls.push({status:state.batchStatus,counts:state.counts});
    persist(state);
    if(['completed','failed','expired','cancelled'].includes(state.batchStatus))break;
    if(i<19)await sleep(9000);
  }
  const terminal=['completed','failed','expired','cancelled'].includes(state.batchStatus);
  const rows=[];
  if(state.batchStatus==='completed'&&state.output_file_id){
    const fetched=await api('/files/'+encodeURIComponent(state.output_file_id)+'/content',
      {timeout:40000});
    if(fetched.ok){
      outputText=fetched.raw;
      for(const line of outputText.trim().split('\n')){
        if(!line.trim())continue;
        const item=JSON.parse(line),choice=item.response?.body?.choices?.[0];
        const label=String(choice?.message?.content||'').trim().toLowerCase();
        rows.push({customId:String(item.custom_id||''),http:item.response?.status_code||null,
          finishReason:choice?.finish_reason||null,
          label,reasoningPresent:Boolean(choice?.message?.reasoning_content),
          tokenUsage:usage(item.response?.body?.usage),
          errorType:String(item.error?.type||'').slice(0,70)});
      }
    }else state.notes.push('output_fetch_http_'+fetched.status);
  }
  const ids=rows.map(x=>x.customId);
  const validIds=ids.length===state.rows&&new Set(ids).size===state.rows&&
    ids.every(id=>Object.hasOwn(state.expected,id));
  const accepted=validIds&&rows.every(x=>x.http===200&&x.finishReason==='stop'&&
    !x.reasoningPresent&&x.label===state.expected[x.customId]);
  const total=rows.reduce((a,r)=>({input:a.input+r.tokenUsage.input,
    output:a.output+r.tokenUsage.output,
    cached:a.cached+r.tokenUsage.cached,total:a.total+r.tokenUsage.total}),
    {input:0,output:0,cached:0,total:0});
  state.assessment={terminal,providerStatus:state.batchStatus,
    independentLeaves:state.rows,retrievedLeafCount:rows.length,
    accepted:!!accepted,correct:rows.filter(x=>x.label===state.expected[x.customId]).length,
    safeResumeFromSavedId:true,extraBatchCreateCalls:0,
    resumedClientWallMs:Date.now()-started,
    batchLatencyFromCreationMs:state.createdBatchAt?
      Date.now()-Date.parse(state.createdBatchAt):null,
    usage:total,
    estimatedBatchCostUsd:price(total,0.6),
    equivalentSyncCostUsd:price(total,1),
    theoreticalCostReductionPct:40,
    syncBaseline:state.syncBaseline,
    outputDigest:outputText?sha(outputText):null,
    recordHashes:rows.map(x=>({id:x.customId,digest:sha(x.label),
      correct:x.label===state.expected[x.customId]})),
    polls};
  state.stage=state.batchStatus==='completed'?'completed':
    terminal?state.batchStatus:'pending';
  persist(state);
  saveReport({experiment:state.experiment,model:MODEL,
    batchIdDigest:sha(state.batch_id),inputFileIdDigest:sha(state.input_file_id),
    creationAttempts:state.submissionAttempts,batchStatus:state.batchStatus,
    creationAt:state.createdBatchAt,lastCheckAt:state.lastCheckedAt,
    pollChecks:state.pollChecks,assessment:state.assessment,notes:state.notes});
  console.log('KIMI_BATCH_RECOVERY_RESULT='+JSON.stringify({
    status:state.batchStatus,assessment:state.assessment,creationAttempts:1}));
  // A pending 24h batch is not an experimental failure or a completed pass.
  // The durable checkpoint/report are preserved as CI artifacts for later
  // separate read-only checks. NO automatic re-creation or repeated POST.
  if(state.batchStatus==='completed'&&!accepted)process.exitCode=2;
  else if(terminal&&state.batchStatus!=='completed')process.exitCode=2;
}
if(MODE==='submit')await submit();
else await resume();
