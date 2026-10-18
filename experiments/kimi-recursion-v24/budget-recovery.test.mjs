import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {kimiStageMode,kimiStageRequest,kimiResponseAcceptable} from './thinking-router.mjs';
import {
 THINKING_MAX_COMPLETION_TOKENS,INSTANT_MAX_COMPLETION_TOKENS,
 MAX_LOGICAL_PATCHES_PER_NODE,MAX_DECOMPOSITIONS_PER_NODE,
 MAX_DECOMPOSED_CHILDREN,isKnownThinkingExhaustion,
 remainingPatchSlots,planExhaustion,parseDecomposition,
 recoveryAfterFailedVerification
} from './budget-recovery.mjs';

test('strict budgets: thinking ON always max 32768, OFF always 4096',()=>{
 assert.equal(THINKING_MAX_COMPLETION_TOKENS,32768);
 assert.equal(INSTANT_MAX_COMPLETION_TOKENS,4096);
 for(let i=0;i<10;i++){
  const on=kimiStageRequest('repair_'+i,1);
  assert.equal(on.thinking.type,'enabled');
  assert.equal(on.max_tokens,32768);
  assert.equal(on.temperature,1);
  assert.ok(on.timeoutMs>=600000);
  for(const prefix of ['level_','decompose_','repair_piece_']){
   const off=kimiStageRequest(prefix+i,99999);
   assert.equal(off.thinking.type,'disabled');
   assert.equal(off.max_tokens,4096);
   assert.equal(off.temperature,0.6);
  }
 }
 assert.equal(kimiStageRequest('synthesize',99999).max_tokens,4096);
 assert.equal(MAX_LOGICAL_PATCHES_PER_NODE,2);
 assert.equal(MAX_DECOMPOSITIONS_PER_NODE,1);
 assert.equal(MAX_DECOMPOSED_CHILDREN,2);
 assert.throws(()=>kimiStageMode('repair_10'),/UNRECOGNIZED_MODEL_STAGE/);
 assert.throws(()=>kimiStageMode('repair_piece_10'),/UNRECOGNIZED_MODEL_STAGE/);
});
test('only definite provider ON length moves into decomposition',()=>{
 assert.equal(isKnownThinkingExhaustion('repair_0',{finish_reason:'length'},true),true);
 assert.equal(isKnownThinkingExhaustion('repair_9',{finish_reason:'length'},true),true);
 assert.equal(isKnownThinkingExhaustion('repair_0',{finish_reason:'length'},false),false);
 assert.equal(isKnownThinkingExhaustion('repair_0',{finish_reason:'stop'},true),false);
 assert.equal(isKnownThinkingExhaustion('repair_0',null,true),false);
 assert.equal(isKnownThinkingExhaustion('level_0',{finish_reason:'length'},true),false);
 assert.equal(isKnownThinkingExhaustion('repair_piece_0',{finish_reason:'length'},true),false);
 assert.equal(kimiResponseAcceptable('repair_0',{finish_reason:'length',message:{content:'{'}}),false);
});
test('budget exhaustion does not spend a logical repair attempt and can happen only once per node',()=>{
 const state={repairCounts:{2:1},exhaustions:{},decompositions:{}};
 assert.deepEqual(planExhaustion(state,2),{allowed:true,nextPhase:'decompose_2',remaining:1});
 assert.equal(remainingPatchSlots(state,2),1);
 state.exhaustions[2]={cause:'REPAIR_THINKING_32768_COMPLETION_EXHAUSTED'};
 assert.equal(planExhaustion(state,2).allowed,false);
 assert.equal(remainingPatchSlots(state,2),1);
 assert.equal(planExhaustion({repairCounts:{2:2}},2).allowed,false);
});
test('bounded instant-mode decomposition is validated and may never become a loop',()=>{
 const t={tasks:[{focus:'Locate early pruning check in subset loop',
  acceptanceCriterion:'Every equal-cost candidate survives until tie-break'}]};
 assert.equal(parseDecomposition(t,1).length,1);
 assert.throws(()=>parseDecomposition({tasks:[...t.tasks,...t.tasks]},1),/TASK_COUNT/);
 assert.throws(()=>parseDecomposition({tasks:[]},1),/TASK_COUNT/);
 assert.throws(()=>parseDecomposition({tasks:[{focus:'tiny',acceptanceCriterion:'too small'}]},1),/TASK_BOUNDS/);
 const state={repairCounts:{1:0},decompositions:{1:{tasks:t.tasks,cursor:0}}};
 assert.equal(recoveryAfterFailedVerification(state,1).nextPhase,'repair_piece_1');
 state.decompositions[1].cursor=1;
 assert.equal(recoveryAfterFailedVerification(state,1).nextPhase,null);
 assert.equal(recoveryAfterFailedVerification(state,1).status,'blocked');
 state.repairCounts[1]=2;
 assert.equal(recoveryAfterFailedVerification(state,1).status,'failed');
});
test('full stage engine checkpoints known budget exhaustion, asks OFF decomposition, then verifies all prior invariants',()=>{
 const s=readFileSync(new URL('./live.mjs',import.meta.url),'utf8');
 assert.match(s,/isKnownThinkingExhaustion\(stage,choice,res\.ok\)/);
 assert.match(s,/db\.finishCall\(run,stage,attempt,'budget_exhausted'/);
 assert.match(s,/return THINKING_EXHAUSTED/);
 assert.match(s,/if\(answer===THINKING_EXHAUSTED\)/);
 assert.match(s,/planExhaustion\(state,i\)/);
 assert.match(s,/return next\('decompose_'\+i/);
 assert.match(s,/state\.exhaustions\[i\]/);
 assert.match(s,/state\.decompositions\[i\]=/);
 assert.match(s,/parseDecomposition\(answer,Math\.min\(2,available\)\)/);
 assert.match(s,/if\(type==='repair_piece'\)/);
 assert.match(s,/state\.repairCounts\[i\]=attempt/);
 assert.match(s,/await allAncestors\(state\.source,i\)/);
 assert.match(s,/for\(const input of hiddenCases\)/);
 assert.match(s,/channel\.ack\(msg\)/);
 assert.match(s,/await db\.advance\(/);
 assert.match(s,/await db\.beginCall\(/);
 assert.match(s,/THINKING_32K_EXHAUSTED_DECOMPOSE_OFF/);
});
