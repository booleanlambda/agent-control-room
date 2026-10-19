// Accept only independently well-formed MODEL-AUTHORED node entries.
// One malformed task must not discard the other valid tasks. Never synthesize
// issue/acceptance text, mutate the public acceptance oracle, or use hidden tests.
const safeText=x=>typeof x==='string'&&x.trim().length>=8&&x.trim().length<=1000?x.trim():null;
const field=x=>typeof x==='string'?safeText(x):
 Array.isArray(x)&&x.length>0&&x.every(y=>typeof y==='string')?safeText(x.join('; ')):null;
export function selectValidModelOwnedNodes(answer,{maxTasks=6}={}){
 const values=answer?.tasks;
 if(!Array.isArray(values)||values.length<2||values.length>maxTasks)
  return {tasks:[],sourceCount:Array.isArray(values)?values.length:0,
   rejectedCount:Array.isArray(values)?values.length:0,reason:'INVALID_MODEL_NODE_CONTAINER'};
 const tasks=[],seen=new Set(),rejectionReasons=[];
 for(const item of values){
  const issue=field(item?.issue),acceptance=field(item?.acceptance);
  if(!issue||!acceptance){rejectionReasons.push('EMPTY_OR_OVERSIZED_NODE_TEXT');continue;}
  const fingerprint=issue.toLowerCase().replace(/\s+/g,' ');
  if(seen.has(fingerprint)){rejectionReasons.push('DUPLICATE_NODE_ISSUE');continue}
  seen.add(fingerprint);
  tasks.push({id:tasks.length+1,issue,acceptance});
 }
 return {tasks,sourceCount:values.length,
  rejectedCount:rejectionReasons.length,
  rejectionCounts:Object.fromEntries(Array.from(new Set(rejectionReasons)).map(x=>[
   x,rejectionReasons.filter(y=>y===x).length])),
  reason:tasks.length>=2?'MODEL_NODES_PARTIALLY_OR_FULLY_VALID':'INSUFFICIENT_VALID_MODEL_NODES'};
}
