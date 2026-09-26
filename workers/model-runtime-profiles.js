// AAU model runtime capability registry v0.1
//
// Model capability variables are separate from task budgets.
// A caller may ask for less than these limits, never more.
// Unknown models fail closed until explicitly registered.

const KiB = 1024;

export const MODEL_RUNTIME_PROFILES = Object.freeze({
  'google/gemma-4-31b-it': Object.freeze({
    provider: 'nvidia',
    declared_context_window_tokens: 131072,
    operational_context_limit_tokens: 131072,
    max_output_tokens: 16384,
    input_safety_margin_tokens: 8192,
    estimated_chars_per_token: 3.2,
    supports_thinking: true,
    reasoning_counts_against_output: true,
    supports_json_mode: true,
    max_request_timeout_ms: 900000,
    profile_source: 'provider_observed_context_limit_2026-09-26',
  }),
  'nvidia/nemotron-3.5-lightning-30b-a3b': Object.freeze({
    provider: 'nvidia',
    declared_context_window_tokens: null,
    operational_context_limit_tokens: 32768,
    max_output_tokens: 8192,
    input_safety_margin_tokens: 4096,
    estimated_chars_per_token: 3.2,
    supports_thinking: true,
    reasoning_counts_against_output: true,
    supports_json_mode: true,
    max_request_timeout_ms: 300000,
    profile_source: 'conservative_operational_floor',
  }),
  'moonshotai/kimi-k3': Object.freeze({
    provider: 'nvidia',
    declared_context_window_tokens: null,
    operational_context_limit_tokens: 32768,
    max_output_tokens: 8192,
    input_safety_margin_tokens: 4096,
    estimated_chars_per_token: 3.2,
    supports_thinking: true,
    reasoning_counts_against_output: true,
    supports_json_mode: false,
    max_request_timeout_ms: 180000,
    profile_source: 'conservative_operational_floor',
  }),
  'meta/muse-glimmer-30b': Object.freeze({
    provider: 'nvidia',
    declared_context_window_tokens: null,
    operational_context_limit_tokens: 32768,
    max_output_tokens: 8192,
    input_safety_margin_tokens: 4096,
    estimated_chars_per_token: 3.2,
    supports_thinking: true,
    reasoning_counts_against_output: true,
    supports_json_mode: false,
    max_request_timeout_ms: 180000,
    profile_source: 'conservative_operational_floor',
  }),
  'meta/llama-3.1-70b-instruct': Object.freeze({
    provider: 'nvidia',
    declared_context_window_tokens: null,
    operational_context_limit_tokens: 32768,
    max_output_tokens: 8192,
    input_safety_margin_tokens: 4096,
    estimated_chars_per_token: 3.2,
    supports_thinking: false,
    reasoning_counts_against_output: false,
    supports_json_mode: true,
    max_request_timeout_ms: 180000,
    profile_source: 'conservative_operational_floor',
  }),
  'openai/gpt-oss-20b': Object.freeze({
    provider: 'nvidia',
    declared_context_window_tokens: null,
    operational_context_limit_tokens: 32768,
    max_output_tokens: 8192,
    input_safety_margin_tokens: 4096,
    estimated_chars_per_token: 3.2,
    supports_thinking: true,
    reasoning_counts_against_output: true,
    supports_json_mode: false,
    max_request_timeout_ms: 180000,
    profile_source: 'conservative_operational_floor',
  }),
  'z-ai/glm-5.3': Object.freeze({
    provider: 'nvidia',
    declared_context_window_tokens: null,
    operational_context_limit_tokens: 32768,
    max_output_tokens: 8192,
    input_safety_margin_tokens: 4096,
    estimated_chars_per_token: 3.2,
    supports_thinking: true,
    reasoning_counts_against_output: true,
    supports_json_mode: true,
    max_request_timeout_ms: 180000,
    profile_source: 'conservative_operational_floor',
  }),
  'deepseek-ai/deepseek-v4-flash-0731': Object.freeze({
    provider: 'nvidia',
    declared_context_window_tokens: null,
    operational_context_limit_tokens: 32768,
    max_output_tokens: 8192,
    input_safety_margin_tokens: 4096,
    estimated_chars_per_token: 3.2,
    supports_thinking: true,
    reasoning_counts_against_output: true,
    supports_json_mode: false,
    max_request_timeout_ms: 180000,
    profile_source: 'conservative_operational_floor',
  }),
  'meta/llama-3.2-11b-vision-instruct': Object.freeze({
    provider: 'nvidia',
    declared_context_window_tokens: null,
    operational_context_limit_tokens: 16384,
    max_output_tokens: 4096,
    input_safety_margin_tokens: 2048,
    estimated_chars_per_token: 3.2,
    supports_thinking: false,
    reasoning_counts_against_output: false,
    supports_json_mode: false,
    max_request_timeout_ms: 180000,
    profile_source: 'conservative_operational_floor',
  }),
  'gpt-5.6-luna': Object.freeze({
    provider: 'openai',
    declared_context_window_tokens: null,
    operational_context_limit_tokens: 32768,
    max_output_tokens: 8192,
    input_safety_margin_tokens: 4096,
    estimated_chars_per_token: 3.2,
    supports_thinking: true,
    reasoning_counts_against_output: false,
    supports_json_mode: true,
    max_request_timeout_ms: 300000,
    profile_source: 'conservative_operational_floor_non_nvidia',
  }),
});

export const MODEL_ROLE_POLICIES = Object.freeze({
  agent: Object.freeze({
    default_timeout_ms: 900000,
    default_output_tokens: 7000,
    default_thinking: true,
    max_retries: 2,
  }),
  candidate: Object.freeze({
    default_timeout_ms: 120000,
    default_output_tokens: 1800,
    default_thinking: null,
    max_retries: 3,
  }),
  authenticator: Object.freeze({
    default_timeout_ms: 120000,
    default_output_tokens: 1800,
    default_thinking: null,
    max_retries: 2,
  }),
  adjudicator: Object.freeze({
    default_timeout_ms: 120000,
    default_output_tokens: 1800,
    default_thinking: null,
    max_retries: 2,
  }),
  serializer: Object.freeze({
    default_timeout_ms: 120000,
    default_output_tokens: 900,
    default_thinking: false,
    max_retries: 2,
  }),
  vision: Object.freeze({
    default_timeout_ms: 180000,
    default_output_tokens: 2048,
    default_thinking: false,
    max_retries: 2,
  }),
  generic: Object.freeze({
    default_timeout_ms: 120000,
    default_output_tokens: 2048,
    default_thinking: null,
    max_retries: 2,
  }),
});

function clean(v){ return String(v || '').trim(); }

export function getModelRuntimeProfile(modelId){
  const id=clean(modelId);
  const profile=MODEL_RUNTIME_PROFILES[id];
  if(!profile){
    const error=new Error('model_runtime_profile_missing:'+id);
    error.code='MODEL_RUNTIME_PROFILE_MISSING';
    error.modelId=id;
    throw error;
  }
  return profile;
}

export function getModelRolePolicy(role='generic'){
  return MODEL_ROLE_POLICIES[clean(role)] || MODEL_ROLE_POLICIES.generic;
}

export function resolveModelRuntimeContract(modelId,role='generic'){
  const profile=getModelRuntimeProfile(modelId);
  const policy=getModelRolePolicy(role);
  const timeout=Math.min(
    Number(policy.default_timeout_ms)||120000,
    Number(profile.max_request_timeout_ms)||900000
  );
  const output=Math.min(
    Number(policy.default_output_tokens)||2048,
    Number(profile.max_output_tokens)||8192
  );
  return Object.freeze({
    model_id:clean(modelId),
    role:clean(role)||'generic',
    ...profile,
    role_default_timeout_ms:timeout,
    role_default_output_tokens:output,
    role_default_thinking:policy.default_thinking,
    role_max_retries:policy.max_retries,
  });
}

export function estimateMessageTokens(messages,contract){
  const chars=Array.isArray(messages)
    ? messages.reduce((sum,m)=>sum+String(m?.role||'').length+String(m?.content||'').length+8,0)
    : String(messages||'').length;
  const charsPerToken=Math.max(1.5,Number(contract?.estimated_chars_per_token)||3.2);
  // Fixed framing reserve avoids pretending this is an exact tokenizer.
  return Math.ceil(chars/charsPerToken)+256;
}

export function modelInputBudgetTokens(contract,requestedOutputTokens=null){
  const output=Math.max(
    1,
    Math.min(
      Number(requestedOutputTokens)||Number(contract?.role_default_output_tokens)||2048,
      Number(contract?.max_output_tokens)||8192
    )
  );
  return Math.max(
    0,
    Number(contract?.operational_context_limit_tokens||0)
      - Number(contract?.input_safety_margin_tokens||0)
      - output
  );
}

export function assertModelRequestWithinBudget({messages,contract,requestedOutputTokens=null}){
  const estimatedInputTokens=estimateMessageTokens(messages,contract);
  const maxInputTokens=modelInputBudgetTokens(contract,requestedOutputTokens);
  if(maxInputTokens>0 && estimatedInputTokens>maxInputTokens){
    const error=new Error(
      'model_context_budget_exceeded:'+contract.model_id
      +':estimated_input='+estimatedInputTokens
      +':max_input='+maxInputTokens
    );
    error.code='MODEL_CONTEXT_BUDGET_EXCEEDED';
    error.modelId=contract.model_id;
    error.role=contract.role;
    error.estimatedInputTokens=estimatedInputTokens;
    error.maxInputTokens=maxInputTokens;
    error.operationalContextLimitTokens=contract.operational_context_limit_tokens;
    error.requestedOutputTokens=Math.min(
      Number(requestedOutputTokens)||contract.role_default_output_tokens,
      contract.max_output_tokens
    );
    throw error;
  }
  return {estimated_input_tokens:estimatedInputTokens,max_input_tokens:maxInputTokens};
}

export function modelRuntimeRegistryStatus(){
  return {
    version:'model_runtime_profiles_v0_1',
    models:Object.entries(MODEL_RUNTIME_PROFILES).map(([model_id,p])=>({
      model_id,
      provider:p.provider,
      declared_context_window_tokens:p.declared_context_window_tokens,
      operational_context_limit_tokens:p.operational_context_limit_tokens,
      max_output_tokens:p.max_output_tokens,
      input_safety_margin_tokens:p.input_safety_margin_tokens,
      supports_thinking:p.supports_thinking,
      reasoning_counts_against_output:p.reasoning_counts_against_output,
      supports_json_mode:p.supports_json_mode,
      max_request_timeout_ms:p.max_request_timeout_ms,
      profile_source:p.profile_source,
    })),
    roles:MODEL_ROLE_POLICIES,
  };
}
