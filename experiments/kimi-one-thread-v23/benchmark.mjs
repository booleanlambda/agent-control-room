// Novel v23 benchmark: dependency-constrained security control selection.
// Reference oracle is withheld from Kimi and never model-accessible as a solver.
import {createHash} from 'node:crypto';
export const sha=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
export const specification="Input JSON has controls [{id,cost,tags,requires,excludes}], requiredTags, atLeast and atMost [{tag,count}], mandatory IDs, anyOf groups (each needs at least one selected), budget. Choose a subset with minimum total cost. Every selected control requires ALL dependencies; exclusions forbid both controls; tags count number of selected controls carrying that tag; requiredTags need count>=1; atLeast/atMost thresholds must hold. All constraints and budget must hold. Among equal minimum-cost subsets return lexicographically first ascending list of IDs. Output ONE JSON object {\"selected\":[\"A\",...],\"cost\":INTEGER} sorted ascending. On infeasibility return {\"selected\":[],\"cost\":null}. Read one JSON object from stdin, print exactly one JSON object on stdout. Generalize: hidden inputs change control costs, thresholds and requirements.";
const controls=[
 {id:'A',cost:8,tags:['audit','monitor'],requires:['D'],excludes:[]},
 {id:'B',cost:5,tags:['export','console'],requires:[],excludes:['F']},
 {id:'C',cost:6,tags:['rollback','resilience'],requires:['E'],excludes:[]},
 {id:'D',cost:2,tags:['core'],requires:[],excludes:[]},
 {id:'E',cost:4,tags:['storage','privacy'],requires:[],excludes:['G']},
 {id:'F',cost:9,tags:['export','privacy'],requires:['D'],excludes:['B']},
 {id:'G',cost:3,tags:['analytics','monitor'],requires:[],excludes:['E']},
 {id:'H',cost:7,tags:['audit','rollback'],requires:['D'],excludes:[]},
 {id:'I',cost:6,tags:['resilience','analytics'],requires:['E'],excludes:[]},
 {id:'J',cost:4,tags:['privacy','console'],requires:[],excludes:[]},
 {id:'K',cost:7,tags:['monitor','export'],requires:['C'],excludes:[]},
 {id:'L',cost:3,tags:['core','storage'],requires:[],excludes:[]},
];
const copy=x=>structuredClone(x);
export const publicProblem={
 controls:copy(controls),requiredTags:['audit','export','rollback','privacy','analytics'],
 atLeast:[{tag:'resilience',count:1},{tag:'core',count:1}],
 atMost:[{tag:'console',count:1},{tag:'monitor',count:2}],
 mandatory:[],anyOf:[['B','F','K'],['H','C']],budget:45
};
const hidden1=copy(publicProblem);
hidden1.controls.find(x=>x.id==='B').cost=12;
hidden1.controls.find(x=>x.id==='F').cost=5;
hidden1.controls.find(x=>x.id==='I').cost=8;
hidden1.requiredTags.push('storage');
hidden1.atLeast=[{tag:'resilience',count:1},{tag:'core',count:1},{tag:'monitor',count:1}];
hidden1.budget=44;
const hidden2=copy(publicProblem);
hidden2.controls.find(x=>x.id==='A').cost=3;
hidden2.controls.find(x=>x.id==='G').cost=9;
hidden2.controls.find(x=>x.id==='J').cost=2;
hidden2.requiredTags=['audit','export','rollback','privacy','resilience','console'];
hidden2.atMost=[{tag:'console',count:1},{tag:'monitor',count:1}];
hidden2.mandatory=['D'];
hidden2.anyOf=[['B','F','K'],['A','H']];
hidden2.budget=45;
export const hiddenProblems=[hidden1,hidden2];
export function grade(problem,answer){
 if(!answer||!Array.isArray(answer.selected)||!answer.selected.every(x=>typeof x==='string')||
  JSON.stringify(answer.selected)!==JSON.stringify([...new Set(answer.selected)].sort()))
  return {passed:false,kind:'malformed_selected'};
 const byId=new Map(problem.controls.map(c=>[c.id,c]));
 if(answer.selected.some(x=>!byId.has(x)))return {passed:false,kind:'unknown_control'};
 const selected=new Set(answer.selected);
 const cost=answer.selected.reduce((s,id)=>s+byId.get(id).cost,0);
 if(answer.cost!==cost)return {passed:false,kind:'cost_mismatch',actual:cost,reported:answer.cost};
 for(const id of answer.selected){
  const c=byId.get(id);
  for(const dep of c.requires)if(!selected.has(dep))
   return {passed:false,kind:'dependency_missing',id,required:dep};
  for(const ban of c.excludes)if(selected.has(ban))
   return {passed:false,kind:'exclusion_violated',id,other:ban};
 }
 for(const id of problem.mandatory)if(!selected.has(id))
  return {passed:false,kind:'mandatory_missing',id};
 for(const group of problem.anyOf)if(!group.some(id=>selected.has(id)))
  return {passed:false,kind:'group_unsatisfied',group};
 const count=tag=>answer.selected.filter(id=>byId.get(id).tags.includes(tag)).length;
 for(const tag of problem.requiredTags)if(count(tag)<1)
  return {passed:false,kind:'required_tag_missing',tag};
 for(const x of problem.atLeast)if(count(x.tag)<x.count)
  return {passed:false,kind:'minimum_tag_failed',tag:x.tag,minimum:x.count,actual:count(x.tag)};
 for(const x of problem.atMost)if(count(x.tag)>x.count)
  return {passed:false,kind:'maximum_tag_failed',tag:x.tag,maximum:x.count,actual:count(x.tag)};
 if(cost>problem.budget)return {passed:false,kind:'budget_exceeded',cost,budget:problem.budget};
 return {passed:true,cost,selected:answer.selected};
}
export function exactOracle(problem){
 if(problem.controls.length>18)throw Error('ORACLE_SCOPE');
 const ids=problem.controls.map(c=>c.id);
 let best=null,examined=0,feasible=0;
 for(let mask=0;mask<2**ids.length;mask++){
  const selected=ids.filter((_,i)=>(mask&2**i)!==0).sort();
  const cost=selected.reduce((v,id)=>v+problem.controls.find(c=>c.id===id).cost,0);
  const r=grade(problem,{selected,cost});
  examined++;
  if(!r.passed)continue;
  feasible++;
  if(!best||cost<best.cost||(cost===best.cost&&selected.join(',')<best.selected.join(',')))
   best={selected,cost};
 }
 if(!best)throw Error('BENCHMARK_INFEASIBLE');
 return {...best,examined,feasible};
}
export function assessPublic(problem,answer){
 const g=grade(problem,answer);
 if(!g.passed)return {passed:false,reason:g.kind,details:g};
 const best=exactOracle(problem);
 return {passed:g.cost===best.cost&&JSON.stringify(g.selected)===JSON.stringify(best.selected),
  reason:g.cost!==best.cost?'not_minimum_cost':JSON.stringify(g.selected)!==JSON.stringify(best.selected)?'wrong_tie_break':'verified_optimum',
  submittedCost:g.cost,oracleCost:best.cost,selected:g.selected};
}
