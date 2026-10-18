// Normalize Kimi Instant response shape without generating missing user/model content.
const obj=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const PLAN=['tasks','subtasks','sub_tasks','steps','plan','decomposition','workstreams','phases','items','workItems','work_items'];
const PATCH=['replacements','edits','patches','changes','modifications','updates','operations'];
const WRAP=['result','response','data','payload','output','answer','content'];
const ISSUE=['issue','problem','task','focus','goal','objective','work','description','action','hypothesis','title','step','diagnosis','subproblem','sub_problem'];
const ACCEPT=['acceptance','acceptanceCriterion','acceptance_criterion','criterion','criteria','verification','validation','test','testCriterion','test_criterion','successCondition','success_condition','successCriteria','success_criteria','successMetric','success_metric','expectedOutcome','expected_outcome','doneWhen','done_when','pass_condition','passCondition'];
const OLD=['old','before','original','find','search','match','target','old_text','original_text'];
const NEW=['replacement','after','new','replace','with','new_text','replacement_text','updated'];
function containers(root,keys){
 const seen=new Set(),queue=[{value:root,path:'$',depth:0}],matches=[];
 while(queue.length){
  const {value,path,depth}=queue.shift();
  if(!obj(value)||seen.has(value)||depth>4)continue;
  seen.add(value);
  for(const key of keys)if(Array.isArray(value[key])&&value[key].length)
   matches.push({path:path+'.'+key,values:value[key]});
  if(depth===4)continue;
  for(const key of [...WRAP,...PLAN,...PATCH])if(obj(value[key]))
   queue.push({value:value[key],path:path+'.'+key,depth:depth+1});
 }
 return matches;
}
function oneList(root,keys,missing){
 const matches=containers(root,keys);
 if(!matches.length)throw Error(missing);
 if(matches.length>1)throw Error('MODEL_OUTPUT_AMBIGUOUS_CONTAINERS');
 return matches[0].values;
}
function prose(item,keys){
 for(const key of keys){
  const v=item?.[key];
  if(typeof v==='string'&&v.trim())return v.trim();
  if(Array.isArray(v)&&v.length&&v.every(x=>typeof x==='string'&&x.trim()))
   return v.map(x=>x.trim()).join('; ');
  if(obj(v))for(const k of ['text','description','criterion','details','summary','value'])
   if(typeof v[k]==='string'&&v[k].trim())return v[k].trim();
 }
 return null;
}
function source(item,keys){
 for(const key of keys)if(typeof item?.[key]==='string'&&item[key].trim())return item[key];
 return null;
}
export function parseModelOwnedPlan(output){
 const tasks=oneList(output,PLAN,'MODEL_PLAN_INVALID_COUNT');
 if(tasks.length<2||tasks.length>6)throw Error('MODEL_PLAN_INVALID_COUNT');
 const normalized=tasks.map((t,i)=>{
  if(!obj(t))throw Error('MODEL_PLAN_INVALID_NODE');
  const issue=prose(t,ISSUE),acceptance=prose(t,ACCEPT);
  if(!issue||issue.length<8||issue.length>600||!acceptance||acceptance.length<8||acceptance.length>600)
   throw Error('MODEL_PLAN_INVALID_NODE');
  return {id:i+1,issue,acceptance};
 });
 if(new Set(normalized.map(x=>x.issue.toLowerCase())).size!==normalized.length)
  throw Error('DUPLICATE_PLAN_NODE');
 return normalized;
}
export function normalizeModelOwnedPatches(output){
 const patches=oneList(output,PATCH,'MODEL_PATCH_COUNT_INVALID');
 if(patches.length<1||patches.length>7)throw Error('MODEL_PATCH_COUNT_INVALID');
 return patches.map(p=>{
  if(!obj(p))throw Error('MODEL_PATCH_BAD_SPAN');
  // NEVER trim a source span; exact whitespace must survive.
  const old=source(p,OLD),replacement=source(p,NEW);
  if(!old||old.length<12||!replacement||replacement.length>6500)
   throw Error('MODEL_PATCH_BAD_SPAN');
  return {old,replacement};
 });
}
export function safeStructureSummary(output){
 const keys=x=>obj(x)?Object.keys(x).filter(k=>/^[a-zA-Z_][a-zA-Z_0-9]{0,35}$/.test(k)).slice(0,16):[];
 const summarize=m=>({path:m.path,count:m.values.length,itemKeys:keys(m.values[0])});
 return {topLevelKeys:keys(output),
  taskContainers:containers(output,PLAN).map(summarize).slice(0,6),
  patchContainers:containers(output,PATCH).map(summarize).slice(0,6)};
}
