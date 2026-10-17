// AAU isolated execution-integrity lab: durable intent/lease/inbox simulator.
// No provider requests, database writes, AAU worker imports or background loops.
// Injected faults model provider 504, timeout, orphaned wake and crash/replay.
import {createHash} from 'node:crypto';
import {newDeepTree,deepConfig,authenticateDeep,lightModelDouble,verifyDeepTree}
  from './depth10-traversability.mjs';
import {auditCognitiveTree,scriptedSynthesis} from './cognitive-integrity.mjs';
import {bindAndAuthenticateSynthesis} from './synthesis-slots.mjs';

const hash=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
const err=x=>String(x?.message||x||'unknown').slice(0,130);
const WAIT_MS=60*60*1000;
const CHARGE_LIMIT=650;
const MAX_PROVIDER_ATTEMPTS=6; // Three, wait 60m, three more; no cycle lock.
const ROLLING_BATCH_SIZE=3;
const isPermanent=m=>/(?:HTTP_|_HTTP_)(?:400|401|403|404|422)(?:\b|:)|MODEL_NOT_AVAILABLE/.test(m);
const isRateLimit=m=>/(?:HTTP_|_HTTP_)429(?:\b|:)/.test(m);

function event(s,path,kind,units=0,details={}){
  s.tree.seq++;
  s.tree.ledger.push({id:'lab-'+s.tree.seq,path,kind,units,...details});
}
function debit(s,path,units,details={}){
  s.tree.spent+=units;s.tree.calls++;event(s,path,'reserved',units,details);
}
const nextToken=s=>'lease-'+(++s.tokenNo);
const publicNode=(s,path)=>s.tree.nodes[path];

export function newExecutionLab({shape='spine',budget=55000,now=0}={}){
  const config={...deepConfig(shape,budget),maxCalls:MAX_PROVIDER_ATTEMPTS*(shape==='spine'?21:2047)};
  return {kind:'aau_execution_integrity_lab_v1',clock:now,tree:newDeepTree(config),
    tokenNo:0,attempts:{},leases:{},inbox:{},cooldown:{},synthesisInbox:{},
    syntheses:{},transportErrors:[],recoveryCount:0};
}
export const checkpoint=s=>JSON.stringify(s);
export function restore(serialized){
  const s=JSON.parse(serialized);
  assertExecution(s);
  return s;
}
export function advance(s,millis){
  if(!Number.isSafeInteger(millis)||millis<0)throw Error('invalid_time_advance');
  s.clock+=millis;return s.clock;
}
function forecastCharge(s,path){
  const node=publicNode(s,path);
  return Math.min(CHARGE_LIMIT,
    Math.ceil(JSON.stringify({path,depth:node.depth,start:node.start,end:node.end}).length/3.2)
      +s.tree.config.outputCap+90);
}
export function claim(s,path,{leaseMs=30000}={}){
  if(!Number.isSafeInteger(leaseMs)||leaseMs<1)throw Error('invalid_lease');
  const node=publicNode(s,path);
  if(!node||node.status!=='pending')return {status:'stale'};
  if(s.leases[path])return {status:'already_claimed'};
  if(!s.tree.queue.includes(path))return {status:'not_queued'};
  if(s.cooldown[path]>s.clock)return {status:'cooldown',remainingMs:s.cooldown[path]-s.clock};
  const attempts=s.attempts[path]||0;
  if(attempts>=MAX_PROVIDER_ATTEMPTS){node.status='blocked';s.tree.queue=s.tree.queue.filter(p=>p!==path);event(s,path,'provider_attempts_exhausted');return {status:'blocked'};}
  const price=forecastCharge(s,path);
  if(s.tree.spent+price>s.tree.config.budget||s.tree.calls>=s.tree.config.maxCalls){
    node.status='blocked';s.tree.queue=s.tree.queue.filter(p=>p!==path);
    event(s,path,'budget_denied',0,{needed:price});
    return {status:'budget_denied'};
  }
  s.tree.queue=s.tree.queue.filter(p=>p!==path);
  const attempt=attempts+1,token=nextToken(s),dispatch=path+'#'+attempt;
  s.attempts[path]=attempt;
  debit(s,path,price,{dispatch,attempt});
  s.leases[path]={path,token,dispatch,expiresAt:s.clock+leaseMs};
  return {status:'claimed',path,token,dispatch,attempt};
}
export function deliver(s,receipt,answer){
  const lease=s.leases[receipt?.path];
  if(!lease||lease.token!==receipt?.token||lease.dispatch!==receipt?.dispatch)
    return {status:'stale_delivery'};
  if(lease.expiresAt<=s.clock)return {status:'expired_delivery'};
  if(Object.hasOwn(s.inbox,lease.dispatch))return {status:'duplicate_delivery'};
  // Store incoming payload durably before attempting semantic commit.
  s.inbox[lease.dispatch]={answer:structuredClone(answer),receivedAt:s.clock};
  event(s,lease.path,'provider_answer_journaled',0,{dispatch:lease.dispatch,
    answerHash:hash(answer)});
  return {status:'journaled'};
}
function release(s,path){
  delete s.leases[path];
}
function enqueue(s,path){
  if(s.tree.nodes[path]?.status==='pending'&&!s.tree.queue.includes(path))
    s.tree.queue.push(path);
}
export function commit(s,receipt){
  const lease=s.leases[receipt?.path];
  if(!lease||lease.token!==receipt?.token||lease.dispatch!==receipt?.dispatch)
    return {status:'stale_commit'};
  const node=publicNode(s,lease.path);
  if(node.status!=='pending')return {status:'already_terminal'};
  const packet=s.inbox[lease.dispatch];
  if(!packet)return {status:'no_journaled_answer'};
  const verdict=authenticateDeep(node,packet.answer,s.tree.config);
  delete s.inbox[lease.dispatch];release(s,node.path);
  node.attempts++; // Cognitive decision attempts, not provider transport retries.
  if(!verdict.ok){
    event(s,node.path,'cognitive_rejected',0,{reason:verdict.reason});
    if(node.attempts>=s.tree.config.maxAttempts)node.status='blocked';
    else enqueue(s,node.path);
    return {status:node.status==='blocked'?'blocked':'cognitive_retry',reason:verdict.reason};
  }
  if(verdict.action==='SPLIT'){
    if(Object.keys(s.tree.nodes).length+2>s.tree.config.maxNodes)
      throw Error('node_ceiling');
    const children=[node.path+'.001',node.path+'.002'];
    if(children.some(p=>s.tree.nodes[p]))throw Error('duplicate_semantic_path');
    node.children=children;
    for(const [i,p] of children.entries()){
      s.tree.nodes[p]={path:p,parent:node.path,depth:node.depth+1,
        start:i===0?node.start:verdict.splitAt,
        end:i===0?verdict.splitAt:node.end,status:'pending',
        attempts:0,children:[],result:null,hash:null};
      enqueue(s,p);
    }
    node.status='split';event(s,node.path,'semantic_split_accepted',0,{children});
  }else{
    node.status='complete';node.result=verdict.result;node.hash=verdict.hash;
    event(s,node.path,'atomic_accepted',0,{digest:verdict.hash});
  }
  return {status:node.status,path:node.path};
}
export function providerError(s,receipt,error){
  const lease=s.leases[receipt?.path];
  if(!lease||lease.token!==receipt?.token)return {status:'stale_error'};
  const message=err(error),path=lease.path;
  s.transportErrors.push({path,dispatch:lease.dispatch,kind:'provider',message});
  event(s,path,'provider_transport_error',0,{dispatch:lease.dispatch,message});
  delete s.inbox[lease.dispatch];release(s,path);
  const node=publicNode(s,path);
  if(isPermanent(message)){node.status='blocked';return {status:'permanent_provider_failure'};}
  if(isRateLimit(message)){
    // Admission throttle is not a cognitive failure or proof failure.
    s.cooldown[path]=s.clock+23000;
  }else if(s.attempts[path]===ROLLING_BATCH_SIZE){
    s.cooldown[path]=s.clock+WAIT_MS;
    event(s,path,'provider_cooldown_60m');
  }
  if(s.attempts[path]>=MAX_PROVIDER_ATTEMPTS){
    node.status='blocked';event(s,path,'provider_exhausted_after_six');
    return {status:'blocked'};
  }
  enqueue(s,path);
  return {status:s.cooldown[path]>s.clock?'deferred':'retryable'};
}
export function recover(s){
  s.recoveryCount++;const outcomes=[];
  for(const [path,lease] of Object.entries(s.leases)){
    if(lease.expiresAt>s.clock)continue;
    if(s.inbox[lease.dispatch]){
      // Journal received: reclaim with a NEW fenced token and reuse receipt
      // rather than repeating provider inference or charging again.
      const oldToken=lease.token;
      lease.token=nextToken(s);lease.expiresAt=s.clock+30000;
      const receipt={path,token:lease.token,dispatch:lease.dispatch};
      const outcome=commit(s,receipt);
      outcomes.push({path,kind:'journal_recovered',oldToken,newToken:receipt.token,outcome});
    }else{
      outcomes.push({path,kind:'lease_timeout',result:providerError(s,
        {path,token:lease.token,dispatch:lease.dispatch},'MODEL_TIMEOUT')});
    }
  }
  return outcomes;
}
export function nextReady(s){
  return s.tree.queue.find(p=>s.tree.nodes[p]?.status==='pending'&&
    !s.leases[p]&&!(s.cooldown[p]>s.clock))||null;
}
export function finishState(s){
  s.tree.complete=!s.tree.queue.length&&!Object.keys(s.leases).length&&
    Object.values(s.tree.nodes).every(n=>['split','complete'].includes(n.status));
  return {complete:s.tree.complete,...verifyDeepTree(s.tree,{requireComplete:s.tree.complete})};
}
export async function drain(s,{model=lightModelDouble,faultFor=null,limit=10000}={}){
  const trace=[];
  for(let step=0;step<limit;step++){
    let path=nextReady(s);
    if(!path){
      if(!s.tree.queue.length&&!Object.keys(s.leases).length)break;
      const targetTimes=[...Object.entries(s.cooldown).filter(([p,t])=>
        s.tree.nodes[p]?.status==='pending'&&t>s.clock).map(([,t])=>t),
      ...Object.values(s.leases).map(l=>l.expiresAt)].filter(t=>t>s.clock);
      if(!targetTimes.length)break;
      s.clock=Math.min(...targetTimes);
      recover(s);continue;
    }
    const receipt=claim(s,path);
    if(receipt.status!=='claimed'){trace.push({path,...receipt});continue;}
    const fault=faultFor?.({path,depth:s.tree.nodes[path].depth,attempt:receipt.attempt,dispatch:receipt.dispatch})||null;
    if(fault==='TIMEOUT_ORPHAN'){
      s.clock=s.leases[path].expiresAt;trace.push({path,fault,recovered:recover(s)});
      continue;
    }
    if(fault==='HTTP_504'||fault==='HTTP_429'){
      trace.push({path,fault,outcome:providerError(s,receipt,fault)});continue;
    }
    const answer=await model({...s.tree.nodes[path],
      item: s.tree.nodes[path].end-s.tree.nodes[path].start===1 ?
        {id:'CASE-'+String(s.tree.nodes[path].start+1).padStart(4,'0')} :null},
        s.tree.config);
    const persisted=deliver(s,receipt,answer);
    if(fault==='CRASH_AFTER_RESPONSE'){
      s.clock=s.leases[path].expiresAt;
      trace.push({path,fault,persisted,recovered:recover(s)});
      continue;
    }
    trace.push({path,commit:commit(s,receipt)});
  }
  return {trace,...finishState(s)};
}
export function journalSynthesis(s,path,answer){
  if(s.syntheses[path])return {status:'already_accepted'};
  if(!s.tree.complete)return {status:'tree_not_complete'};
  if(s.synthesisInbox[path])return {status:'already_journaled'};
  s.synthesisInbox[path]=structuredClone(answer);
  return {status:'journaled'};
}
export function commitSynthesis(s,path){
  if(s.syntheses[path])return {status:'already_accepted',digest:s.syntheses[path].digest};
  const node=publicNode(s,path),answer=s.synthesisInbox[path];
  if(!answer)return {status:'no_journaled_synthesis'};
  const clean=auditCognitiveTree(s.tree);
  if(!clean.complete)return {status:'leaf_or_structure_invalid'};
  const children=node?.children?.map(p=>s.syntheses[p]||clean.proofs[p]);
  if(!node||node.status!=='split'||children?.some(p=>!p))
    return {status:'awaiting_child_proof'};
  const bound=bindAndAuthenticateSynthesis(node,answer,children);
  if(!bound.ok)return {status:'auth_rejected',reason:bound.reason};
  s.syntheses[path]=bound.proof;delete s.synthesisInbox[path];
  return {status:'accepted',digest:bound.proof.digest};
}
export function finishSynthesis(s){
  const audit=auditCognitiveTree(s.tree,{proposeSynthesis:n=>{
    const p=s.syntheses[n.path];
    if(!p)return {summary:'',children:[],covered:0,counts:{}};
    return {summary:p.summary,children:p.childEvidence,covered:p.covered,counts:p.counts};
  }});
  return {complete:audit.complete,rootDigest:audit.rootDigest,
    acceptedParents:audit.acceptedParents,acceptedLeaves:audit.acceptedLeaves};
}
export function assertExecution(s){
  verifyDeepTree(s.tree,{requireComplete:false});
  if(new Set(s.tree.queue).size!==s.tree.queue.length)throw Error('duplicate_queue_delivery');
  for(const [path,lease] of Object.entries(s.leases)){
    if(s.tree.queue.includes(path)||publicNode(s,path)?.status!=='pending'||
      !lease.token||!lease.dispatch)throw Error('invalid_lease_state');
  }
  for(const [path,proof] of Object.entries(s.syntheses)){
    if(!s.tree.nodes[path]||proof.path!==path||!proof.accepted)
      throw Error('invalid_synthesis_proof');
  }
  if(Object.keys(s.inbox).length>Object.keys(s.leases).length)
    throw Error('orphaned_response_journal');
  return true;
}
