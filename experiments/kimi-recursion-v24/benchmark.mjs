// V24 nested cognitive task: ten progressively revealed dependent requirements.
// One depth-10 chain, each child retains EVERY verified ancestor invariant.
// Exact exhaustive oracle is external to model-authored Python. No synthetic bug injection.
import {publicProblem as seed,hiddenProblems as priorHidden,sha as digest} from '../kimi-one-thread-v23/benchmark.mjs';
export const sha=digest;
export const LEVELS=[
 {id:'coverage',rule:'Select controls covering every requiredTags value at minimum total cost. Output sorted IDs and exact cost.'},
 {id:'mandatory',rule:'Also honor mandatory IDs, even when they do not improve coverage.'},
 {id:'dependencies',rule:'Every selected control must include the transitive closure of all its requires IDs.'},
 {id:'exclusions',rule:'Every selected control excludes all listed conflicting IDs (whether conflict is one-sided or reciprocal).'},
 {id:'minimum_counts',rule:'Honor atLeast: at least count selected controls with the named tag.'},
 {id:'maximum_counts',rule:'Honor atMost: no more than count selected controls with the named tag.'},
 {id:'alternative_groups',rule:'Honor anyOf: for every group at least one ID must be selected.'},
 {id:'budget',rule:'Enforce total cost <= budget. If no feasible subset, return {selected:[],cost:null}.'},
 {id:'exact_tag_counts',rule:'NEW SCHEMA FIELD exactly: every {tag,count} requires exactly that many selected controls with the tag.'},
 {id:'conditional_alternatives',rule:'NEW SCHEMA FIELD requiresAny: every {id,oneOf} requires at least one oneOf ID when id is selected; among all minimum cost solutions return lexicographically first sorted IDs.'}
];
const clone=x=>structuredClone(x);
export function stageProblem(depth,variant=0){
 if(!Number.isSafeInteger(depth)||depth<0||depth>9||![0,1,2,3,4].includes(variant))throw Error('BAD_STAGE');
 const p=clone(seed);
 if(variant){
  p.controls.find(x=>x.id==='B').cost+=variant*2;
  p.controls.find(x=>x.id==='A').cost+=variant%2? -2:1;
  p.controls.find(x=>x.id==='F').cost-=variant%2?2:0;
  p.controls.find(x=>x.id==='I').cost+=variant%3;
 }
 // Reveal incremental schema only after the corresponding depth.
 p.requiredTags=['audit','privacy','rollback','export','analytics'];
 p.mandatory=depth>=1?['D']:[];
 if(depth<2)for(const c of p.controls)c.requires=[];
 if(depth<3)for(const c of p.controls)c.excludes=[];
 p.atLeast=depth>=4?[{tag:'resilience',count:1},{tag:'core',count:1}]:[];
 p.atMost=depth>=5?[{tag:'console',count:1},{tag:'monitor',count:2}]:[];
 p.anyOf=depth>=6?[['B','F','K'],['C','H']]:[];
 p.budget=depth>=7?45:999;
 p.exactly=depth>=8?[{tag:'console',count:1}]:[];
 p.requiresAny=depth>=9?[{id:'H',oneOf:['B','F','K']}]:[];
 if(variant===2&&depth>=7)p.budget=23; // Intentionally valid infeasibility test; no fault injection.
 if(variant===4&&depth>=8)p.exactly=[{tag:'console',count:0}];
 return p;
}
export const publicCasesFor=depth=>[stageProblem(depth,0),stageProblem(depth,1),stageProblem(depth,2)];
export const hiddenCases=[stageProblem(9,3),stageProblem(9,4)];
export function feasibility(problem,selected){
 if(!Array.isArray(selected)||selected.some(x=>typeof x!=='string')||
  JSON.stringify(selected)!==JSON.stringify([...new Set(selected)].sort()))
  return {valid:false,reason:'INVALID_SORTED_SELECTION'};
 const all=new Map(problem.controls.map(c=>[c.id,c])),set=new Set(selected);
 if(selected.some(x=>!all.has(x)))return {valid:false,reason:'UNKNOWN_CONTROL'};
 const cost=selected.reduce((n,id)=>n+all.get(id).cost,0);
 const count=tag=>selected.reduce((n,id)=>n+(all.get(id).tags.includes(tag)?1:0),0);
 for(const id of selected){
  const c=all.get(id);
  for(const dep of c.requires||[])if(!set.has(dep))return {valid:false,reason:'MISSING_DEPENDENCY',id,dependency:dep};
  for(const ex of c.excludes||[])if(set.has(ex))return {valid:false,reason:'EXCLUSION_VIOLATION',id,excluded:ex};
 }
 for(const id of problem.mandatory||[])if(!set.has(id))return {valid:false,reason:'MANDATORY_MISSING',id};
 for(const t of problem.requiredTags||[])if(count(t)<1)return {valid:false,reason:'COVERAGE_MISSING',tag:t};
 for(const x of problem.atLeast||[])if(count(x.tag)<x.count)
  return {valid:false,reason:'MINIMUM_TAG_COUNT',tag:x.tag,required:x.count,actual:count(x.tag)};
 for(const x of problem.atMost||[])if(count(x.tag)>x.count)
  return {valid:false,reason:'MAXIMUM_TAG_COUNT',tag:x.tag,allowed:x.count,actual:count(x.tag)};
 for(const group of problem.anyOf||[])if(!group.some(id=>set.has(id)))
  return {valid:false,reason:'ALTERNATIVE_MISSING',group};
 for(const x of problem.exactly||[])if(count(x.tag)!==x.count)
  return {valid:false,reason:'EXACT_TAG_COUNT',tag:x.tag,required:x.count,actual:count(x.tag)};
 for(const x of problem.requiresAny||[])if(set.has(x.id)&&!x.oneOf.some(id=>set.has(id)))
  return {valid:false,reason:'CONDITIONAL_ALTERNATIVE',id:x.id,oneOf:x.oneOf};
 if(cost>problem.budget)return {valid:false,reason:'BUDGET_EXCEEDED',cost,budget:problem.budget};
 return {valid:true,cost};
}
function lexicalLess(a,b){
 for(let i=0;i<Math.min(a.length,b.length);i++)if(a[i]!==b[i])return a[i]<b[i];
 return a.length<b.length;
}
export function exactOracle(problem){
 if(problem.controls.length>16)throw Error('ORACLE_TOO_LARGE');
 const ids=problem.controls.map(x=>x.id);
 let best=null,count=0;
 for(let mask=0;mask<2**ids.length;mask++){
  const sel=ids.filter((_,i)=>mask&(1<<i)).sort();
  const f=feasibility(problem,sel);
  if(!f.valid)continue;
  count++;
  if(!best||f.cost<best.cost||
    f.cost===best.cost&&lexicalLess(sel,best.selected))
   best={selected:sel,cost:f.cost};
 }
 return {selected:best?.selected??[],cost:best?.cost??null,feasibleSubsets:count};
}
export function assess(problem,answer,{revealOptimum=false}={}){
 if(!answer||typeof answer!=='object'||!Array.isArray(answer.selected))
  return {passed:false,reason:'MALFORMED_OUTPUT'};
 const opt=exactOracle(problem);
 if(opt.cost===null){
  return answer.cost===null&&answer.selected.length===0?
   {passed:true,reason:'CORRECT_INFEASIBLE'}:
   {passed:false,reason:'INCORRECT_INFEASIBILITY',observed:answer,oracleCost:revealOptimum?null:undefined};
 }
 const check=feasibility(problem,answer.selected);
 if(!check.valid)return {passed:false,...check};
 if(answer.cost!==check.cost)return {passed:false,reason:'COST_MISMATCH',actual:check.cost,reported:answer.cost};
 if(check.cost!==opt.cost)return {passed:false,reason:'NONOPTIMAL_COST',actual:check.cost,...(revealOptimum?{optimal:opt.cost}:{})};
 if(JSON.stringify(answer.selected)!==JSON.stringify(opt.selected))
  return {passed:false,reason:'LEXICOGRAPHIC_TIE_BREAK',... (revealOptimum?{optimalSelection:opt.selected}:{})};
 return {passed:true,reason:'EXACT_VERIFIED',cost:check.cost};
}
export function stageHash(depth){return sha({depth,public:publicCasesFor(depth).map(sha),level:LEVELS[depth]})}
