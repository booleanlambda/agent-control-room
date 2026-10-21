// Trusted adapter for model-authored synthesis with *positional* child references.
// Model NEVER authors or copies full canonical node paths or evidence hashes.
import {authenticateParentSynthesis} from './cognitive-integrity.mjs';

const equal=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
export function bindAndAuthenticateSynthesis(node,answer,children){
  if(!answer||typeof answer!=='object'||Array.isArray(answer))
    return {ok:false,reason:'invalid_model_envelope'};
  if(['children','childEvidence','path','digest','parent','rootDigest'].some(k=>
    Object.prototype.hasOwnProperty.call(answer,k)))
    return {ok:false,reason:'model_authored_provenance_forbidden'};
  if(!Array.isArray(answer.slots)||!equal(answer.slots,[0,1]))
    return {ok:false,reason:'slot_coverage_invalid'};
  if(!Array.isArray(children)||children.length!==2||
     children.some(c=>!c||!c.accepted||!c.path||!c.digest))
    return {ok:false,reason:'missing_verified_children'};
  const proposal={
    summary:answer.summary,covered:answer.covered,counts:answer.counts,
    // Only already-authenticated runtime evidence can become a citation.
    children:children.map(c=>({path:c.path,digest:c.digest})),
  };
  const result=authenticateParentSynthesis(node,proposal,children);
  if(!result.ok)return result;
  return {ok:true,proposal,proof:result.proof};
}
