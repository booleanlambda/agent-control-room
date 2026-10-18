import test from 'node:test';
import assert from 'node:assert/strict';
import {Agent} from 'undici';
import {transportTimeoutPolicy,makeScopedUndiciAgent,
 THINKING_ON_APPLICATION_MS,THINKING_OFF_APPLICATION_MS} from './transport-policy.mjs';
test('thinking-ON 720s abort occurs before the scoped 750s Undici header deadline',()=>{
 const p=transportTimeoutPolicy(true);
 assert.equal(p.appDeadlineMs,720000);
 assert.equal(p.headersTimeoutMs,750000);
 assert.equal(p.bodyTimeoutMs,750000);
 assert.ok(p.appDeadlineMs<p.headersTimeoutMs);
});
test('thinking-OFF 175s application abort is not widened',()=>{
 const p=transportTimeoutPolicy(false);
 assert.equal(p.appDeadlineMs,THINKING_OFF_APPLICATION_MS);
 assert.equal(p.headersTimeoutMs,205000);
 assert.equal(p.bodyTimeoutMs,205000);
 assert.equal(THINKING_ON_APPLICATION_MS,720000);
});
test('Undici Agent is created per scope, no global state or implicit retry',async()=>{
 const seen=[];
 class FakeAgent{constructor(options){seen.push(options)}}
 makeScopedUndiciAgent(FakeAgent,true);
 assert.deepEqual(seen,[{connections:1,headersTimeout:750000,bodyTimeout:750000}]);
 const agent=makeScopedUndiciAgent(Agent,true);
 assert.equal(typeof agent.dispatch,'function');
 await agent.close();
});
