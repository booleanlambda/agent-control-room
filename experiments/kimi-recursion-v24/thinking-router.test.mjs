import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {kimiStageMode,kimiStageRequest,kimiResponseAcceptable} from './thinking-router.mjs';

test('exact phase routing: repairs think ON and all routine Kimi phases remain OFF',()=>{
 for(let i=0;i<10;i++){
  const repair=kimiStageRequest('repair_'+i,3600);
  assert.equal(repair.model,'kimi-k2.6');
  assert.deepEqual(repair.thinking,{type:'enabled'});
  assert.equal(repair.temperature,1.0);
  assert.equal(repair.max_tokens,32768);
  assert.equal(repair.timeoutMs,720000);
  const ordinary=kimiStageRequest('level_'+i,3100);
  assert.deepEqual(ordinary.thinking,{type:'disabled'});
  assert.equal(ordinary.temperature,0.6);
  assert.equal(ordinary.max_tokens,4096);
  assert.equal(ordinary.timeoutMs,175000);
  for(const phase of ['decompose_'+i,'repair_piece_'+i]){
   const child=kimiStageRequest(phase,1024);
   assert.equal(child.thinking.type,'disabled');
   assert.equal(child.max_tokens,4096);
  }
 }
 assert.equal(kimiStageMode('synthesize'),'disabled');
 assert.equal(kimiStageRequest('synthesize',1450).max_tokens,4096);
 assert.throws(()=>kimiStageMode('verify_1'),/UNRECOGNIZED_MODEL_STAGE/);
 assert.throws(()=>kimiStageMode('diagnose_1'),/UNRECOGNIZED_MODEL_STAGE/);
 assert.throws(()=>kimiStageMode('repair_10'),/UNRECOGNIZED_MODEL_STAGE/);
 assert.throws(()=>kimiStageMode('repair_0_and_level_1'),/UNRECOGNIZED_MODEL_STAGE/);
});
test('accept actual thinking-mode reply containing reasoning_content while disallowing it during ordinary phases',()=>{
 const withReason={finish_reason:'stop',message:{content:'{"old":"x","replacement":"y"}',reasoning_content:'provider-side thinking'}};
 assert.equal(kimiResponseAcceptable('repair_0',withReason),true);
 assert.equal(kimiResponseAcceptable('level_0',withReason),false);
 assert.equal(kimiResponseAcceptable('synthesize',withReason),false);
 assert.equal(kimiResponseAcceptable('repair_0',{...withReason,finish_reason:'length'}),false);
 assert.equal(kimiResponseAcceptable('repair_0',{finish_reason:'stop',message:{content:'',reasoning_content:'something'}}),false);
});
test('full V27 research thread uses centralized router and unchanged public + hidden acceptance gates',()=>{
 const src=readFileSync(new URL('./live.mjs',import.meta.url),'utf8');
 assert.match(src,/const cfg=kimiStageRequest\(stage,max_tokens\)/);
 assert.match(src,/thinking:cfg.thinking/);
 assert.match(src,/temperature:cfg.temperature/);
 assert.match(src,/cfg.max_tokens/);
 assert.match(src,/cfg.timeoutMs/);
 assert.match(src,/kimiResponseAcceptable\(stage,choice\)/);
 assert.match(src,/thinkingOnlyDuringRepair=/);
 assert.match(src,/state.thinkingReceipt/);
 assert.match(src,/const answer=await model\(label,attempt,state/);
 assert.match(src,/await allAncestors\(state.source,i\)/);
 assert.match(src,/for\(const input of hiddenCases\)/);
 assert.match(src,/if\(state.verifiedDepth!==10\|\|state.nodes.length!==10/);
 assert.doesNotMatch(src,/thinking:\{type:'enabled'\},temperature:0\.6/);
});
