import test from 'node:test';
import assert from 'node:assert/strict';
import {parseModelOwnedPlan} from './plan-parser.mjs';
const a={issue:'Preserve provider finish reason',acceptance:'Exact length must trigger specialized path'};
const b={issue:'Avoid clobbering token usage',acceptance:'Every received usage value is checkpointed'};
test('canonical model plan supported',()=>assert.equal(parseModelOwnedPlan({tasks:[a,b]}).length,2));
test('synonymous model-owned decomposition labels retain verbatim semantics',()=>{
 const out=parseModelOwnedPlan({plan:{steps:[
  {goal:'Record provider finish reason',success_criteria:'Exact length triggers special path'},
  {focus:'Preserve usage metadata',verification:'Tokens remain attached on failure'}
 ]}});
 assert.equal(out.length,2);assert.equal(out[0].issue,'Record provider finish reason');
 assert.equal(out[1].acceptance,'Tokens remain attached on failure');
});
test('top-level stages, workstreams and snake case accepted',()=>{
 assert.equal(parseModelOwnedPlan({workstreams:[
  {subproblem:'Distinguish HTTP transport',done_when:'Transport failure classified correctly'},
  {task:'Preserve unique durable write',acceptance_criterion:'Never write twice after ambiguity'}
 ]}).length,2);
});
test('nothing deterministic invents missing tasks or acceptance criteria',()=>{
 assert.throws(()=>parseModelOwnedPlan({tasks:[{goal:'Too brief'},b]}),/MODEL_PLAN_INVALID_NODE/);
 assert.throws(()=>parseModelOwnedPlan({tasks:[a]}),/MODEL_PLAN_INVALID_COUNT/);
 assert.throws(()=>parseModelOwnedPlan({tasks:[a,a]}),/DUPLICATE_PLAN_NODE/);
});
