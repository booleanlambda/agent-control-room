// V25 independent behavioral counterexample catalog.
// Each tiny scenario has a provable minimum that CHANGES when the newly
// introduced invariant is removed. No withheld V24B inputs or optimums are used.
import {exactOracle,sha} from './benchmark.mjs';
const c=(id,cost,tags,requires=[],excludes=[])=>({id,cost,tags,requires,excludes});
const build=(controls,requiredTags,extra={})=>({
 controls,requiredTags,mandatory:[],atLeast:[],atMost:[],anyOf:[],
 budget:999,exactly:[],requiresAny:[],...extra});
const raw=[
 {id:'coverage_and_tie',level:0,key:'requiredTags',
  input:build([c('A',1,['audit']),c('B',1,['audit']),c('C',1,['privacy'])],['audit','privacy'])},
 {id:'mandatory_not_covering_tags',level:1,key:'mandatory',
  input:build([c('A',1,['audit']),c('B',1,['privacy']),c('M',3,['unrelated'])],['audit','privacy'],{mandatory:['M']})},
 {id:'transitive_dependency_closure',level:2,key:'requires',
  input:build([c('A',1,['audit'],['D']),c('B',5,['audit']),c('C',1,['privacy']),c('D',3,['dependency'])],['audit','privacy'])},
 {id:'mutual_exclusion',level:3,key:'excludes',
  input:build([c('A',1,['audit'],[],['B']),c('B',1,['privacy']),c('C',4,['audit']),c('D',4,['privacy'])],['audit','privacy'])},
 {id:'minimum_count_on_optional_tag',level:4,key:'atLeast',
  input:build([c('A',1,['audit']),c('B',1,['privacy']),c('C',2,['backup'])],['audit','privacy'],{atLeast:[{tag:'backup',count:1}]})},
 {id:'maximum_tag_count',level:5,key:'atMost',
  input:build([c('A',1,['audit','console']),c('B',1,['privacy','console']),c('C',3,['privacy']),c('D',3,['audit'])],['audit','privacy'],{atMost:[{tag:'console',count:1}]})},
 {id:'alternative_group_optional_control',level:6,key:'anyOf',
  input:build([c('A',1,['audit']),c('B',1,['privacy']),c('C',3,['backup'])],['audit','privacy'],{anyOf:[['C']]})},
 {id:'infeasible_budget',level:7,key:'budget',
  input:build([c('A',4,['audit']),c('B',4,['privacy'])],['audit','privacy'],{budget:7})},
 {id:'exactly_zero_console',level:8,key:'exactly',
  input:build([c('A',1,['audit','console']),c('B',4,['audit'])],['audit'],{exactly:[{tag:'console',count:0}]})},
 {id:'conditional_selected_trigger',level:9,key:'requiresAny',
  input:build([c('A',1,['audit']),c('B',4,['backup'])],['audit'],{mandatory:['A'],requiresAny:[{id:'A',oneOf:['B']}]})},
 {id:'exactly_one_console_inverse',level:8,key:'exactly',
  input:build([c('A',1,['audit']),c('B',4,['audit','console'])],['audit'],{exactly:[{tag:'console',count:1}]})},
 {id:'conditional_changes_optimal_choice',level:9,key:'requiresAny',
  input:build([c('A',1,['audit']),c('B',10,['backup']),c('C',4,['audit'])],['audit'],{requiresAny:[{id:'A',oneOf:['B']}]})},
];
function withoutRule(test){
 const p=structuredClone(test.input);
 switch(test.key){
  case 'requiredTags':p.requiredTags=[];break;
  case 'requires':for(const x of p.controls)x.requires=[];break;
  case 'excludes':for(const x of p.controls)x.excludes=[];break;
  case 'budget':p.budget=999;break;
  default:p[test.key]=[];
 }
 return p;
}
export function behaviorCatalog(){
 return raw.map(t=>({id:t.id,level:t.level,input:structuredClone(t.input)}));
}
export function behaviorProbesAt(level){
 if(!Number.isInteger(level)||level<0||level>9)throw Error('INVALID_PROBE_LEVEL');
 return behaviorCatalog().filter(x=>x.level===level);
}
export function verifyDiscrimination(){
 const receipts=[];
 for(const test of raw){
  const strict=exactOracle(test.input),ablated=exactOracle(withoutRule(test));
  // The oracle supports impossible cases through cost:null.
  if(strict.cost===ablated.cost&&JSON.stringify(strict.selected)===JSON.stringify(ablated.selected))
   throw Error('NON_DISCRIMINATING_BEHAVIOR_PROBE:'+test.id);
  receipts.push({id:test.id,level:test.level,strictHash:sha(strict),
   ablatedHash:sha(ablated),publicProbeHash:sha(test.input)});
 }
 return receipts;
}
