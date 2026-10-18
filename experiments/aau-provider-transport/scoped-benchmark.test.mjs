import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const code=readFileSync(new URL('../real-world-aau-debug-v1/live.mjs',import.meta.url),'utf8');
test('only thinking-ON uses isolated Undici fetch/dispatcher; thinking-OFF stays unchanged',()=>{
 assert.match(code,/const scopedAgent=thinking\?makeScopedUndiciAgent\(Agent,true\):null/);
 assert.match(code,/const providerFetch=thinking\?scopedFetch:fetch/);
 assert.match(code,/\.\.\.\(scopedAgent\?\{dispatcher:scopedAgent\}:\{\}\)/);
 assert.match(code,/if\(scopedAgent\)await scopedAgent\.destroy\(\)/);
});
test('existing application deadlines unchanged and observed',()=>{
 assert.match(code,/thinking\?720000:175000/);
 assert.match(code,/requestDeadlineFired=true;controller\.abort\(\)/);
 assert.match(code,/receipt\.elapsedMs=Date\.now\(\)-requestStartedAt/);
 assert.match(code,/receipt\.httpHeadersReceived=headersReceived/);
 assert.match(code,/receipt\.requestDeadlineFired=requestDeadlineFired/);
});
test('no fixed call ceiling; full recursive OFF tree guarded by global token budget',()=>{
 assert.doesNotMatch(code,/const MAX_CALLS=/);
 assert.doesNotMatch(code,/modelCalls\.length\s*>=\s*[0-9]/);
 assert.match(code,/GLOBAL_PROVIDER_TOKEN_BUDGET/);
 assert.match(code,/const reservation=budgetReservation/);
 assert.match(code,/if\(!reservation\.permitted\)/);
 assert.match(code,/thinking\?32768:4096/);
 assert.match(code,/stream:false/);
 assert.match(code,/status:'sent_or_uncertain'/);
 assert.equal((code.match(/await providerFetch\(/g)||[]).length,1);
 assert.match(code,/while\(tree\.queue\.length>0&&\!check\.receipt\.pass\)/);
 assert.match(code,/takeRepairNode\(tree\)/);
 assert.match(code,/addChildRepairNodes\(tree,node,children\)/);
 assert.match(code,/const verdict=focusedPatchDecision\(initialPublic\.receipt,trialCheck\.receipt\)/);
 assert.ok(code.indexOf("'decompose_public_failure_tree'")<code.indexOf("'on_residual_after_off_tree'"));
});
