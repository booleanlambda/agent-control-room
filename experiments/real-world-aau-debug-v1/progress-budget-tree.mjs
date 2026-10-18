// Progress-driven, finite-compute repair tree for the historical AAU benchmark.
// There is deliberately NO fixed number-of-model-calls ceiling.
// Every model invocation reserves its *maximum* completion tokens plus a
// conservative prompt estimate. Nodes also have bounded recursion depth.
// All acceptance decisions are made by the frozen public executable oracle.
export const GLOBAL_PROVIDER_TOKEN_BUDGET=75000;
export const OFF_COMPLETION_LIMIT=4096;
export const ON_COMPLETION_LIMIT=32768;
export const RECURSION_DEPTH_LIMIT=3;
const estimate=x=>Math.ceil(String(x).length/3)+512;
export function budgetReservation({requestBody,thinking,reportedTokens}){
 const used=Array.isArray(reportedTokens)?
  reportedTokens.reduce((t,v)=>t+(Number.isSafeInteger(v)&&v>=0?v:0),0):0;
 const ceiling=thinking?ON_COMPLETION_LIMIT:OFF_COMPLETION_LIMIT;
 const requestTokens=estimate(typeof requestBody==='string'?requestBody:JSON.stringify(requestBody));
 const reservation=ceiling+requestTokens;
 return Object.freeze({
  permitted:used+reservation<=GLOBAL_PROVIDER_TOKEN_BUDGET,
  reason:used+reservation<=GLOBAL_PROVIDER_TOKEN_BUDGET?'WITHIN_COMPUTE_BUDGET':'GLOBAL_COMPUTE_BUDGET_EXHAUSTED',
  alreadyReportedTokens:used,promptTokenAllowance:requestTokens,
  completionCeiling:ceiling,reservation,remainingBefore:Math.max(0,GLOBAL_PROVIDER_TOKEN_BUDGET-used),
  remainingAfterReservation:Math.max(0,GLOBAL_PROVIDER_TOKEN_BUDGET-used-reservation)
 });
}
export function createRepairTree(tasks){
 if(!Array.isArray(tasks)||tasks.length<2||tasks.length>6)throw Error('MODEL_TREE_INVALID_ROOT');
 const queue=tasks.map((t,i)=>makeNode(t,0,'root',i+1));
 return {queue,seen:new Set(queue.map(x=>x.fingerprint)),visited:[],nextId:queue.length+1};
}
const normalized=x=>String(x??'').toLowerCase().replace(/\s+/g,' ').trim();
const fingerprint=t=>normalized(t.issue)+'|'+normalized(t.acceptance);
function makeNode(task,depth,parent,id){
 if(typeof task?.issue!=='string'||typeof task?.acceptance!=='string'||
  task.issue.length<8||task.acceptance.length<8)throw Error('MODEL_TREE_INVALID_NODE');
 return {id,depth,parent,issue:task.issue,acceptance:task.acceptance,
  fingerprint:fingerprint(task)};
}
export function takeRepairNode(tree){
 const node=tree.queue.shift()??null;
 if(node)tree.visited.push({id:node.id,depth:node.depth,parent:node.parent});
 return node;
}
export function addChildRepairNodes(tree,parent,tasks){
 if(!parent||!Array.isArray(tasks)||tasks.length<2||tasks.length>3)
  return {added:0,reason:'INVALID_CHILD_DECOMPOSITION'};
 if(parent.depth>=RECURSION_DEPTH_LIMIT)
  return {added:0,reason:'RECURSION_DEPTH_LIMIT'};
 let children;
 try{children=tasks.map(t=>makeNode(t,parent.depth+1,parent.id,tree.nextId++))}
 catch{return {added:0,reason:'INVALID_CHILD_DECOMPOSITION'}}
 if(children.some(x=>tree.seen.has(x.fingerprint))||
    new Set(children.map(x=>x.fingerprint)).size!==children.length)
  return {added:0,reason:'DUPLICATED_OR_RECURSIVE_NODE'};
 for(const x of children)tree.seen.add(x.fingerprint);
 // Breadth-first fairness: evaluate all independent root/sibling failures before
 // spending the entire finite budget subdividing one still-failing branch.
 tree.queue.push(...children);
 return {added:children.length,reason:'CHILD_DECOMPOSITION_QUEUED'};
}
export function treeSummary(tree){
 return {pending:tree.queue.length,visited:tree.visited.length,
  depthOfNextNode:tree.queue[0]?.depth??null,
  uniqueTasks:tree.seen.size};
}
