// Schema-adaptive parsing of a MODEL-AUTHORED decomposition.
// Only normalizes equivalent labels, never writes subproblems or criteria for Kimi.
const listFrom=x=>Array.isArray(x)?x: x&&typeof x==='object'
 ?(x.tasks||x.steps||x.subtasks||x.items||x.phases):null;
const firstString=(x,names)=>{
 for(const n of names)if(typeof x?.[n]==='string'&&x[n].trim())return x[n].trim();
 return null;
};
export function parseModelOwnedPlan(output){
 const tasks=listFrom(output?.tasks)||listFrom(output?.subtasks)||
  listFrom(output?.steps)||listFrom(output?.plan)||
  listFrom(output?.decomposition)||listFrom(output?.workstreams)||
  listFrom(output?.phases);
 if(!Array.isArray(tasks)||tasks.length<2||tasks.length>6)
  throw Error('MODEL_PLAN_INVALID_COUNT');
 const out=tasks.map((item,i)=>{
  if(!item||typeof item!=='object'||Array.isArray(item))throw Error('MODEL_PLAN_INVALID_NODE');
  const issue=firstString(item,[
   'issue','problem','task','focus','goal','objective','work','description',
   'action','hypothesis','title','step','diagnosis','subproblem'
  ]);
  const acceptance=firstString(item,[
   'acceptance','acceptanceCriterion','acceptance_criterion',
   'criterion','criteria','verification','validation','test','testCriterion',
   'test_criterion','successCondition','success_condition',
   'successCriteria','success_criteria','successMetric','success_metric',
   'expectedOutcome','expected_outcome','doneWhen','done_when'
  ]);
  if(!issue||issue.length<8||issue.length>500||
     !acceptance||acceptance.length<8||acceptance.length>500)
   throw Error('MODEL_PLAN_INVALID_NODE');
  return {id:i+1,issue,acceptance};
 });
 if(new Set(out.map(x=>x.issue.toLowerCase())).size!==out.length)
  throw Error('DUPLICATE_PLAN_NODE');
 return out;
}
