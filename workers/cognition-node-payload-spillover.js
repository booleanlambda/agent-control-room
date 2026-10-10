// Lossless, immutable overflow storage for node decision state.
// No semantic summarization, drop rules, or altered cognition decisions.
import {createHash} from 'node:crypto';

export const NODE_DECISION_SPILLOVER_CONTRACT='node_decision_payload_checkpoint_v0_1';
const INLINE_BUDGET_BYTES=14000; // Postgres jsonb::text adds whitespace to JSON.
const SNAPSHOT_CHUNK_BYTES=30000; // Base64 + wrapper stays under 50KB step limit.
const MAX_SNAPSHOT_CHUNKS=128;
const digest=x=>createHash('sha256').update(x).digest('hex');
const object=x=>x&&typeof x==='object'&&!Array.isArray(x)?x:null;

export function encodeNodeDecisionPayload(payload,{nodePath='R'}={}){
  const full=object(payload);
  if(!full)throw new Error('node_decision_state_invalid_object');
  const raw=Buffer.from(JSON.stringify(full),'utf8');
  if(raw.length<=INLINE_BUDGET_BYTES)
    return {inline_payload:payload,archived:false,checkpoint_parts:[],
      original_bytes:raw.length};
  const fullHash=digest(raw);
  const count=Math.ceil(raw.length/SNAPSHOT_CHUNK_BYTES);
  if(count>MAX_SNAPSHOT_CHUNKS)
    throw new Error('node_decision_snapshot_too_large_for_safe_storage');
  const checkpoint_parts=[];
  const manifest_parts=[];
  for(let index=0;index<count;index++){
    const chunk=raw.subarray(index*SNAPSHOT_CHUNK_BYTES,
      (index+1)*SNAPSHOT_CHUNK_BYTES);
    const step_key='nodepayload:'+digest(
      NODE_DECISION_SPILLOVER_CONTRACT+'|'+nodePath+'|'+fullHash+'|'+index
    ).slice(0,56);
    const artifact=JSON.stringify({
      contract:NODE_DECISION_SPILLOVER_CONTRACT,node_path:nodePath,
      full_hash:fullHash,index,count,encoding:'base64',
      chunk_hash:digest(chunk),chunk:chunk.toString('base64'),
    });
    if(Buffer.byteLength(artifact)>49000)
      throw new Error('node_decision_chunk_exceeds_checkpoint_limit');
    checkpoint_parts.push({step_key,artifact,artifact_hash:digest(artifact)});
    manifest_parts.push({step_key,artifact_hash:digest(artifact)});
  }
  const inline_payload={
    decision_state_checkpoint_ref:{
      contract:NODE_DECISION_SPILLOVER_CONTRACT,node_path:nodePath,
      full_hash:fullHash,original_bytes:raw.length,parts:manifest_parts,
    },
  };
  if(Buffer.byteLength(JSON.stringify(inline_payload))>INLINE_BUDGET_BYTES)
    throw new Error('node_decision_manifest_exceeds_inline_limit');
  return {inline_payload,archived:true,checkpoint_parts,
    original_bytes:raw.length};
}

export function decodeNodeDecisionPayload(inline,checkpointRows=[],{nodePath=null}={}){
  const data=object(inline);
  if(!data)throw new Error('node_decision_inline_state_invalid');
  const ref=object(data.decision_state_checkpoint_ref);
  if(!ref)return data;
  if(ref.contract!==NODE_DECISION_SPILLOVER_CONTRACT
    ||(nodePath&&ref.node_path!==nodePath)
    ||!Array.isArray(ref.parts)||!ref.parts.length
    ||ref.parts.length>MAX_SNAPSHOT_CHUNKS
    ||checkpointRows.length!==ref.parts.length)
    throw new Error('node_decision_manifest_invalid');
  const buffers=[];
  for(let index=0;index<ref.parts.length;index++){
    const expected=ref.parts[index];
    const row=checkpointRows[index];
    if(!row||row.step_key!==expected.step_key
      ||digest(String(row.artifact||''))!==expected.artifact_hash)
      throw new Error('node_decision_checkpoint_integrity_mismatch');
    let parsed;
    try{parsed=JSON.parse(row.artifact);}catch{
      throw new Error('node_decision_checkpoint_invalid_json');
    }
    if(parsed.contract!==NODE_DECISION_SPILLOVER_CONTRACT
      ||parsed.node_path!==ref.node_path||parsed.full_hash!==ref.full_hash
      ||parsed.index!==index||parsed.count!==ref.parts.length
      ||parsed.encoding!=='base64'
      ||typeof parsed.chunk!=='string')
      throw new Error('node_decision_chunk_metadata_mismatch');
    const buf=Buffer.from(parsed.chunk,'base64');
    if(digest(buf)!==parsed.chunk_hash)
      throw new Error('node_decision_chunk_hash_mismatch');
    buffers.push(buf);
  }
  const restored=Buffer.concat(buffers);
  if(restored.length!==ref.original_bytes||digest(restored)!==ref.full_hash)
    throw new Error('node_decision_full_snapshot_hash_mismatch');
  let result;
  try{result=JSON.parse(restored.toString('utf8'));}catch{
    throw new Error('node_decision_full_snapshot_invalid_json');
  }
  if(!object(result))throw new Error('node_decision_full_snapshot_not_object');
  return result;
}
