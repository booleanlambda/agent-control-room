// Synthetic storage-contract tests only. Never wake or alter an agent.
import {strict as assert} from 'node:assert';
import {encodeNodeDecisionPayload,decodeNodeDecisionPayload} from
  './cognition-node-payload-spillover.js';

export function probeCognitionNodePayloadSpillover(){
  let checks=0;
  const eq=(a,b,msg)=>{assert.deepEqual(a,b,msg);checks++;};
  const throws=(fn,msg)=>{assert.throws(fn,undefined,msg);checks++;};
  const small={routing_protocol:'agent_owned',reason:'a short decision'};
  const inline=encodeNodeDecisionPayload(small,{nodePath:'R.001'});
  eq(inline.archived,false,'small decision stays inline');
  eq(decodeNodeDecisionPayload(inline.inline_payload,[],{nodePath:'R.001'}),
     small,'inline replay unchanged');
  const original={routing_discovery_checkpoint:{
    decision:'SPLIT',
    reason:'Need evidence reconciliation without changing calculations.',
    quoted_evidence:'₵ and 📊 and Ω '.repeat(8000),
    context_fingerprint:'a'.repeat(64),
  },synthesis_failure:{prior_child_hashes:['b'.repeat(64)]},
    self_remediation_in_progress:true};
  const encoded=encodeNodeDecisionPayload(original,{nodePath:'R.002.002.001.001'});
  eq(encoded.archived,true,'oversized decision archived');
  eq(encoded.checkpoint_parts.length>1,true,'multiple chunks survive');
  eq(encoded.checkpoint_parts.every(x=>Buffer.byteLength(x.artifact)<=49000),
     true,'each checkpoint respects database byte limit');
  eq(Buffer.byteLength(JSON.stringify(encoded.inline_payload))<14000,
     true,'reference remains safely below 20 KB');
  const rows=encoded.checkpoint_parts.map(x=>({
    step_key:x.step_key,artifact:x.artifact,
  }));
  const decoded=decodeNodeDecisionPayload(encoded.inline_payload,rows,{
    nodePath:'R.002.002.001.001',
  });
  eq(decoded,original,'exact decoded state including unicode and evidence');
  eq(encodeNodeDecisionPayload(original,{nodePath:'R.002.002.001.001'})
    .inline_payload,encoded.inline_payload,'deterministic replay identity');
  throws(()=>decodeNodeDecisionPayload(encoded.inline_payload,rows.slice(1),{
    nodePath:'R.002.002.001.001',
  }),'a missing checkpoint must fail closed');
  const tampered=rows.map(x=>({...x}));
  tampered[0].artifact=tampered[0].artifact.replace('base64','base65');
  throws(()=>decodeNodeDecisionPayload(encoded.inline_payload,tampered,{
    nodePath:'R.002.002.001.001',
  }),'a changed checkpoint must fail closed');
  throws(()=>decodeNodeDecisionPayload(encoded.inline_payload,rows,{
    nodePath:'R.999',
  }),'cross-node replay must fail closed');
  return {ok:true,checks,synthetic:true,agent_wakes:0,provider_calls:0,
    contract:'node_decision_payload_checkpoint_v0_1'};
}
