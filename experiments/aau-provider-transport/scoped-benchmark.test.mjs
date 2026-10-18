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
test('bounded five distinct stage calls and no catch-based resend',()=>{
 assert.match(code,/const MAX_CALLS=MAX_RESEARCH_CALLS/);
 assert.match(code,/thinking\?32768:4096/);
 assert.match(code,/stream:false/);
 assert.match(code,/status:'sent_or_uncertain'/);
 assert.equal((code.match(/await providerFetch\(/g)||[]).length,1);
 assert.equal((code.match(/await callModel\(/g)||[]).length,5);
});
