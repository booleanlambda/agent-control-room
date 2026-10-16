// AAU isolated ten-level recursion extension. No AAU DB/queue/provider access.
// 16 representative Silas diagnostics are expanded as synthetic, independently
// addressable test cases. This is NOT a 2,048-call provider benchmark.
import {createHash} from 'node:crypto';
import {CASES} from './engine.mjs';
export const deepConfig=(shape='balanced',budget=1800000)=> {
  if(!['balanced','spine'].includes(shape)||!Number.isSafeInteger(budget)||budget<0)
    throw Error('invalid_deep_config');
  return Object.freeze({shape,depthLimit:10,budget,caseCount:shape==='balanced'?1024:11,
    maxNodes:2047,maxCalls:4094,maxAttempts:2,outputCap:480});
};
const fingerprint=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
const item=i=>({id:'CASE-'+String(i+1).padStart(4,'0'),error:CASES[i%CASES.length].error,
  expected:CASES[i%CASES.length].expected,sourceTemplate:i%CASES.length});
export function newDeepTree(config=deepConfig()){
  return {config,spent:0,calls:0,seq:0,ledger:[],queue:['R'],nodes:{
    R:{path:'R',parent:null,depth:0,start:0,end:config.caseCount,
      status:'pending',attempts:0,children:[],result:null,hash:null},
  },complete:false};
}
export const lightModelDouble=async(node,config)=>{
  if(node.end-node.start>1)return {action:'SPLIT',
    splitAt:config.shape==='spine'?node.start+1:Math.floor((node.start+node.end)/2)};
  return {action:'ATOMIC',id:item(node.start).id,classification:item(node.start).expected};
};
export function authenticateDeep(node,answer,config){
  if(!answer||typeof answer!=='object'||Array.isArray(answer))
    return {ok:false,reason:'invalid_response'};
  if(answer.action==='SPLIT'){
    // Compact stage-10 protocol accepts one split boundary only. If the model
    // also supplies an explicit (possibly incomplete) child manifest, reject
    // it rather than silently ignoring the contradictory claim.
    if(Object.prototype.hasOwnProperty.call(answer,'children'))
      return {ok:false,reason:'unexpected_children_payload'};
    if(node.depth>=config.depthLimit)return {ok:false,reason:'depth_limit'};
    if(!Number.isSafeInteger(answer.splitAt)||answer.splitAt<=node.start||answer.splitAt>=node.end)
      return {ok:false,reason:'invalid_partition'};
    return {ok:true,action:'SPLIT',splitAt:answer.splitAt};
  }
  if(answer.action==='ATOMIC'){
    const f=item(node.start);
    if(node.end-node.start!==1||answer.id!==f.id||answer.classification!==f.expected)
      return {ok:false,reason:'oracle_mismatch'};
    return {ok:true,action:'ATOMIC',result:{id:f.id,classification:f.expected},
      hash:fingerprint({id:f.id,classification:f.expected})};
  }
  return {ok:false,reason:'invalid_action'};
}
const event=(s,path,kind,units=0,details={})=>s.ledger.push({
  id:'lab-'+(++s.seq),path,kind,units,...details
});
export async function nextDeep(s,model=lightModelDouble,{fault=null,stale=false}={}){
  const path=s.queue.shift();if(!path)return null;
  const n=s.nodes[path];if(!n||n.status!=='pending')return {status:'stale',path};
  if(stale){s.queue.unshift(path);event(s,path,'stale');return {status:'stale',path};}
  // Same fixed-size descriptor and conservative reserve as the local explorer.
  const prompt={path,depth:n.depth,start:n.start,end:n.end,
    fixture:n.end-n.start===1?item(n.start):null,
    limits:{depth:s.config.depthLimit,output:s.config.outputCap}};
  const charge=Math.ceil(JSON.stringify(prompt).length/3.2)+s.config.outputCap+90;
  if(s.spent+charge>s.config.budget||s.calls>=s.config.maxCalls){
    n.status='blocked';event(s,path,'budget_denied');return {status:'budget_denied',path};
  }
  n.attempts++;s.calls++;s.spent+=charge;event(s,path,'reserved',charge);
  let answer;
  try{
    if(fault)throw Error(fault);
    answer=await model({...n,item:n.end-n.start===1?item(n.start):null},s.config);
  }catch(e){
    const msg=String(e?.message||e);
    // Permanent missing-model, invalid-request and auth failures must NOT
    // be retried as though they were transient 504 or timeout errors.
    const permanent=/(?:NVIDIA|MOONSHOT)_HTTP_(?:400|401|403|404|422)(?:\\b|:)|MODEL_NOT_AVAILABLE|MODEL_REQUEST_INVALID/.test(msg);
    event(s,path,permanent?'permanent_provider_error':'transport',0,{message:msg.slice(0,220)});
    if(permanent)n.status='blocked';
    else if(n.attempts<s.config.maxAttempts)s.queue.push(path);
    else n.status='blocked';
    return {status:permanent?'permanent_provider_failure':
      n.status==='blocked'?'blocked':'retry',path};
  }
  const v=authenticateDeep(n,answer,s.config);
  if(!v.ok){
    event(s,path,'rejected',0,{reason:v.reason});
    if(n.attempts<s.config.maxAttempts)s.queue.push(path);else n.status='blocked';
    return {status:n.status==='blocked'?'blocked':'retry',path};
  }
  if(v.action==='SPLIT'){
    if(Object.keys(s.nodes).length+2>s.config.maxNodes)throw Error('node_ceiling');
    n.children=[path+'.001',path+'.002'];
    for(const [i,p] of n.children.entries()){
      if(s.nodes[p])throw Error('duplicate_path');
      s.nodes[p]={path:p,parent:path,depth:n.depth+1,
        start:i===0?n.start:v.splitAt,end:i===0?v.splitAt:n.end,
        status:'pending',attempts:0,children:[],result:null,hash:null};
      s.queue.push(p);
    }
    n.status='split';event(s,path,'split',0,{children:[...n.children]});
  }else{
    n.status='complete';n.result=v.result;n.hash=v.hash;
    event(s,path,'authenticated',0,{hash:v.hash});
  }
  return {status:n.status,path};
}
export function getDeepNode(s,path){
  const node=s.nodes[path];if(!node)return null;
  const ancestors=[];let parent=node.parent;
  while(parent){ancestors.push(parent);parent=s.nodes[parent]?.parent??null;}
  return {path,parent:node.parent,children:[...node.children],
    ancestors,depth:node.depth,range:[node.start,node.end],
    status:node.status,hash:node.hash};
}
export function verifyDeepTree(s,{requireComplete=true}={}){
  const bfs=[],dfs=[],all=Object.keys(s.nodes);
  for(const mode of ['bfs','dfs']){
    const seen=new Set(),todo=['R'],order=mode==='bfs'?bfs:dfs;
    while(todo.length){
      const p=mode==='bfs'?todo.shift():todo.pop();
      if(seen.has(p))throw Error('revisited_node');
      seen.add(p);order.push(p);
      const n=s.nodes[p];if(!n)throw Error('missing_node');
      if(n.path!==p||n.depth!==p.split('.').length-1||n.depth>10)
        throw Error('wrong_depth_or_path');
      if(n.parent&&!s.nodes[n.parent]?.children.includes(p))throw Error('broken_parent');
      if(n.children.length){
        if(n.children.length!==2||n.status!=='split')throw Error('bad_branch');
        const a=s.nodes[n.children[0]],b=s.nodes[n.children[1]];
        if(!a||!b||a.parent!==p||b.parent!==p||
          a.depth!==n.depth+1||b.depth!==n.depth+1||
          a.start!==n.start||a.end!==b.start||b.end!==n.end||a.start>=a.end||b.start>=b.end||
          n.children[0]!==p+'.001'||n.children[1]!==p+'.002')
          throw Error('broken_child_coverage');
        if(mode==='bfs')todo.push(...n.children);
        else todo.push(n.children[1],n.children[0]);
      }else if(requireComplete&&n.status!=='complete')throw Error('incomplete_leaf');
      if(n.status==='complete'){
        const f=item(n.start);
        if(n.end-n.start!==1||n.result?.id!==f.id||
          n.result?.classification!==f.expected||
          n.hash!==fingerprint({id:f.id,classification:f.expected}))throw Error('invalid_leaf_hash');
      }
      if(n.attempts>s.config.maxAttempts)throw Error('over_attempt_limit');
    }
    if(seen.size!==all.length)throw Error('unreachable_node');
  }
  if(bfs.length!==dfs.length||new Set(dfs).size!==all.length)throw Error('traversal_inconsistent');
  if(s.ledger.reduce((a,e)=>a+e.units,0)!==s.spent||
    s.spent>s.config.budget||s.calls>s.config.maxCalls||s.seq!==s.ledger.length||
    new Set(s.ledger.map(e=>e.id)).size!==s.ledger.length)
    throw Error('budget_or_event_ledger_corrupt');
  return {reachable:bfs.length,depth:Math.max(...all.map(p=>s.nodes[p].depth)),
    nodes:all.length,splits:all.filter(p=>s.nodes[p].status==='split').length,
    leaves:all.filter(p=>s.nodes[p].status==='complete').length,
    orphans:0,calls:s.calls,spent:s.spent,remaining:s.config.budget-s.spent,
    bfsHash:fingerprint(bfs),dfsHash:fingerprint(dfs)};
}
export async function executeDeep(s,model=lightModelDouble){
  for(let n=0;s.queue.length&&n<s.config.maxCalls+10;n++)await nextDeep(s,model);
  s.complete=!s.queue.length&&Object.values(s.nodes).every(n=>['complete','split'].includes(n.status));
  return {complete:s.complete,...verifyDeepTree(s,{requireComplete:s.complete})};
}
