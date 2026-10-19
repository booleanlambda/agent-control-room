import test from 'node:test';
import assert from 'node:assert/strict';
import {parseModelOwnedPlan,normalizeModelOwnedPatches,safeStructureSummary} from './output-normalizer.mjs';
const a={issue:'Preserve provider finish reason',acceptance:'Exact length must trigger specialized path'};
const b={issue:'Avoid clobbering token usage',acceptance:'Every received usage value is checkpointed'};
test('canonical plan preserved',()=>assert.equal(parseModelOwnedPlan({tasks:[a,b]}).length,2));
test('nested thinking-off JSON with alternate names and explicit criteria',()=>{
 const result=parseModelOwnedPlan({result:{decomposition:{sub_tasks:[
  {goal:'Preserve the valid finish reason',success_criteria:['Keep finish stop','Handle length separately']},
  {focus:'Retain token receipts',verification:{text:'Never overwrite reported token usage'}}
 ]}}});
 assert.deepEqual(result,[{id:1,issue:'Preserve the valid finish reason',acceptance:'Keep finish stop; Handle length separately'},
  {id:2,issue:'Retain token receipts',acceptance:'Never overwrite reported token usage'}]);
});
test('reject truly missing acceptance, ambiguous plans, duplicates, invalid counts',()=>{
 assert.throws(()=>parseModelOwnedPlan({tasks:[{goal:'Track provider status'},b]}),/MODEL_PLAN_INVALID_NODE/);
 assert.throws(()=>parseModelOwnedPlan({plan:{steps:[a,b]},tasks:[a,b]}),/MODEL_OUTPUT_AMBIGUOUS_CONTAINERS/);
 assert.throws(()=>parseModelOwnedPlan({tasks:[a]}),/MODEL_PLAN_INVALID_COUNT/);
 assert.throws(()=>parseModelOwnedPlan({tasks:[a,a]}),/DUPLICATE_PLAN_NODE/);
});
test('patch alias normalization still requires model-authored exact source spans',()=>{
 assert.deepEqual(normalizeModelOwnedPatches({output:{edits:[{
  find:'exact unique original source',replace:'replacement source code goes here'
 }]}}),[{old:'exact unique original source',replacement:'replacement source code goes here'}]);
 assert.throws(()=>normalizeModelOwnedPatches({edits:[{find:'original but no replacement'}]}),/MODEL_PATCH_BAD_SPAN/);
});
test('exact patch whitespace survives untouched',()=>{
 const old='\n  if(foo){\n  return 1;\n  }\n';
 const replacement='\n  if(foo){\n  return 2;\n  }\n';
 assert.deepEqual(normalizeModelOwnedPatches({patches:[{before:old,after:replacement}]}),[{old,replacement}]);
});
test('safe format receipt includes structure only, never private content',()=>{
 const s=safeStructureSummary({result:{steps:[
  {goal:'Bearer SECRET',test:'api key SECRET'},b
 ]}});
 assert.equal(s.topLevelKeys[0],'result');
 assert.equal(s.taskContainers[0].path,'$.result.steps');
 assert.equal(JSON.stringify(s).includes('SECRET'),false);
});
