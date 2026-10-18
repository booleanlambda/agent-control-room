// V28 thinking ON only for direct repair. Confirmation of 32K completion
// exhaustion switches to bounded thinking-OFF decomposition and child repair.
import {THINKING_MAX_COMPLETION_TOKENS,INSTANT_MAX_COMPLETION_TOKENS} from './budget-recovery.mjs';
export function kimiStageMode(stage){
 if(typeof stage!=='string')throw Error('INVALID_MODEL_STAGE');
 if(/^repair_[0-9]$/.test(stage))return 'enabled';
 if(/^(level|decompose|repair_piece)_[0-9]$/.test(stage)||stage==='synthesize')
  return 'disabled';
 throw Error('UNRECOGNIZED_MODEL_STAGE');
}
export function kimiStageRequest(stage,requestedMaxTokens){
 if(!Number.isSafeInteger(requestedMaxTokens)||requestedMaxTokens<1)
  throw Error('BAD_TOKEN_CAP');
 const mode=kimiStageMode(stage);
 return Object.freeze({model:'kimi-k2.6',thinking:Object.freeze({type:mode}),
  temperature:mode==='enabled'?1.0:0.6,
  max_tokens:mode==='enabled'?THINKING_MAX_COMPLETION_TOKENS:INSTANT_MAX_COMPLETION_TOKENS,
  timeoutMs:mode==='enabled'?720000:175000});
}
export function kimiResponseAcceptable(stage,choice){
 const mode=kimiStageMode(stage);
 if(choice?.finish_reason!=='stop'||typeof choice?.message?.content!=='string'||
    !choice.message.content.trim())return false;
 if(mode==='disabled'&&choice.message.reasoning_content)return false;
 // ON reasoning content is expected and NOT retained; only final JSON parsed.
 return true;
}
