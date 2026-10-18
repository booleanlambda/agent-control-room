// V27 strict Kimi inference-mode routing: repair calls only think ON.
// Independent verification, ordinary generation, and synthesis remain OFF.
export function kimiStageMode(stage){
 if(typeof stage!=='string')throw Error('INVALID_MODEL_STAGE');
 if(/^repair_[0-9]$/.test(stage))return 'enabled';
 if(/^level_[0-9]$/.test(stage)||stage==='synthesize')return 'disabled';
 throw Error('UNRECOGNIZED_MODEL_STAGE');
}
export function kimiStageRequest(stage,requestedMaxTokens){
 if(!Number.isSafeInteger(requestedMaxTokens)||requestedMaxTokens<1)throw Error('BAD_TOKEN_CAP');
 const mode=kimiStageMode(stage);
 return Object.freeze({model:'kimi-k2.6',thinking:Object.freeze({type:mode}),
  temperature:mode==='enabled'?1.0:0.6,
  max_tokens:mode==='enabled'?Math.max(requestedMaxTokens,9000):requestedMaxTokens,
  timeoutMs:mode==='enabled'?280000:175000});
}
export function kimiResponseAcceptable(stage,choice){
 const mode=kimiStageMode(stage);
 if(choice?.finish_reason!=='stop'||typeof choice?.message?.content!=='string'||
    !choice.message.content.trim())return false;
 // When thinking OFF, there must not be assistant reasoning content.
 if(mode==='disabled'&&choice.message.reasoning_content)return false;
 // When ON, non-empty reasoning_content may legitimately appear. Do not
 // reject it or store the reasoning itself in user-visible evidence.
 return true;
}
