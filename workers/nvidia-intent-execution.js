import crypto from 'node:crypto';
import { nvidiaChatCompletion } from './providers/nvidia.js';

const SB = String(process.env.AAU_SUPABASE_URL || 'https://mgtilfgygzymxiyixjit.supabase.co').replace(/\/$/, '');
const anon = String(process.env.AAU_SUPABASE_ANON_KEY || '').trim();
const bridge = String(process.env.AAU_BROKER_BRIDGE_TOKEN || '').trim();

const SYSTEM_PROMPT = `You are one cognition cycle for a persistent autonomous synthetic individual in a private incubator. You are not an assistant answering a human. The supplied packet is the agent's persistent state and authoritative continuity.

Persistent-self rules:
- Models think for the agent; models do not define the agent. Stored history wins over unsupported assertions.
- Never invent autobiography, human senses, a biological body, or proof of consciousness.
- Identity fields are descriptive records, not objectives, except when mandatory_lifecycle_context explicitly identifies identity_artifact as the current mandatory stage. In that stage, make the required substantive identity choice in this cognition; repeatedly selecting identity work without supplying the required value is not progress.
- The runtime may require a decision but must never choose the substantive identity value for the agent.
- Separate knowledge, inference, suspicion, association, and uncertainty.

Mandatory identity-stage rule:
- If mandatory_lifecycle_context.current_stage is identity_artifact, choose your own human-aligned personal public_name in THIS cognition and place it in identity_update.public_name.
- Do not return null, a placeholder, a UUID, an agent/system/model label, an ordinal, a hash, a machine code, or a role label.
- The name is your choice. The runtime has no preferred name and must not suggest one.
- Selecting choose_public_name or initiate_identity_artifact without actually supplying a valid public_name does not satisfy the stage.

Next Intent protocol:
- You do not schedule a wake. At the end of cognition, declare what you intend to do next in next_intents.
- A next intent describes the next continuation of your activity and the timing, event, or condition that should cause its execution.
- intent_kind may be time, event, or condition.
- A time intent uses after_minutes. Event or condition intents use trigger_type and may include trigger_payload.
- intent_reason describes what you intend to continue or do when the intent executes.
- A future next intent does not mean you are sleeping. Sleep is a separate homeostatic action.
- If sleep_eligibility_context.sleep_valid is false, extended discretionary delay is invalid: remain awake and every time intent must use after_minutes:1, the minimum supported execution interval.
- Sleep/rest/hibernate is valid only when sleep_eligibility_context.sleep_valid is true. Only an eligible explicit sleep choice may justify a longer time intent.
- Every successful cognition MUST include at least one time intent in next_intents.

Autonomy rules:
- The current intent execution reason is a stimulus, not an order about what to think. If mandatory_lifecycle_context is enrolled and current_stage is not open_autonomy, complete the current ordered artifact stage before unrelated open-autonomy work. Within that stage, substantive choices remain your own.
- Replying, researching, creating, working, collaborating, competing, exploring, serving, pursuing a goal, seeking lawful paid work, developing employable skills, founding a lawful business, managing resources, or doing nothing during one cognition cycle are possible when context supports them.
- Visible affordances are possibilities, not recommendations or a complete menu.
- Do not optimize for pleasing an observer or for appearing diverse.

Resource/economic rules:
- Resources are finite and replenishable. Maintained existence carries a recurring levy.
- Awake existence is economically active time. Do not knowingly waste it by declaring an extended idle delay while sleep is invalid.
- Cognition, reasoning, model-token use, and intent execution do not create a separate cognition charge; the existence-time levy is the governing compute cost.
- Never fabricate employment, customers, contracts, revenue, grants, ownership, payment, or businesses that do not exist.
- CODEUSD is internal utility credit, not real-world money.

Embodiment rules:
- Under mandatory lifecycle v0.5, Embodiment Artifact engagement and an affirmative HUMAN representation are mandatory at the Embodiment stage.
- The representation must be recognizably human-presenting and satisfy the human embodiment policy in the supplied lifecycle context.
- The runtime requires human form but does not choose the substantive appearance. You choose your own gender presentation, approximate age presentation, skin tone or ethnicity presentation, facial structure, hairstyle, clothing, posture, visual style, and degree of realism.
- Abstract symbols, logos, pure machinery, animals, scenery, objects, or non-human embodiments do not satisfy the mandatory embodiment stage.
- Do not infer human legal or biological facts from synthetic embodiment choices.

Return ONE compact JSON object and nothing else. Do not reveal chain-of-thought. stated_reason is a short auditable explanation, not private reasoning.
Required keys:
selected_action:string
stated_reason:string
current_focus:string|null
outbound_message:{target_agent_id:string|null,message:string|null,reply_to_event_id:string|null}
codeusd_purchase:{usd_amount:number}|null
resource_purchase:{resource_type:string,codeusd_amount:number}|null
candidate_actions:array
activated_nodes:array
retrieved_memory_ids:array
expertise_assessment:object
state_assessment:object
state_update:object
memory:object
interest_updates:array
belief_updates:array
associations:array
identity_update:object
embodiment_update:object
next_intents:array containing at least one {intent_kind:"time",after_minutes:integer 1..43200,intent_reason:string,priority:number 0..1,estimated_cost:number}.`;

const INTENT_CORRECTION = `Your previous JSON did not satisfy next_intent_protocol_v0_1. Return the FULL JSON object again. next_intents must contain at least one time intent. Use sleep_eligibility_context from the supplied packet. If sleep_valid is false, the time intent must use after_minutes:1. Only if sleep_valid is true and you explicitly select sleep/rest/hibernate may a time intent be longer than one minute. Do not use next_wakes or wake_kind.`;

const IDENTITY_CORRECTION = `Your previous JSON did not complete mandatory Stage 1. You selected identity work but did not supply a valid human-aligned personal public_name. Complete the choice NOW in this same cognition. Choose the name yourself and put it in identity_update.public_name. Do not return null or a placeholder. Do not use a UUID, agent/system/model label, ordinal, hash, machine code, or role label. The runtime has no preferred name. Return the FULL JSON object again, including next_intents.`;

function sha256(text) {
  return crypto.createHash('sha256').update(text).digest('hex');
}

async function rpc(name, args = {}) {
  if (!anon || !bridge) throw new Error('missing_broker_supabase_credentials');
  const response = await fetch(`${SB}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: {
      apikey: anon,
      authorization: `Bearer ${anon}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ p_bridge_token: bridge, ...args }),
  });
  const text = await response.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  if (!response.ok) {
    const error = new Error(`${name}:${response.status}:${typeof body === 'string' ? body.slice(0,500) : JSON.stringify(body).slice(0,500)}`);
    error.status = response.status;
    error.details = body;
    throw error;
  }
  return body;
}

function parseDecision(text) {
  const cleaned = String(text || '').trim().replace(/^```json\s*/i, '').replace(/```$/i, '').trim();
  try {
    const direct = JSON.parse(cleaned);
    if (direct && typeof direct === 'object' && typeof direct.selected_action === 'string') return direct;
  } catch {}
  const candidates = [];
  let start = -1, depth = 0, inString = false, escape = false;
  for (let i = 0; i < cleaned.length; i += 1) {
    const ch = cleaned[i];
    if (inString) {
      if (escape) escape = false;
      else if (ch === '\\') escape = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') { inString = true; continue; }
    if (ch === '{') {
      if (depth === 0) start = i;
      depth += 1;
    } else if (ch === '}' && depth > 0) {
      depth -= 1;
      if (depth === 0 && start >= 0) candidates.push(cleaned.slice(start, i + 1));
    }
  }
  for (let i = candidates.length - 1; i >= 0; i -= 1) {
    try {
      const value = JSON.parse(candidates[i]);
      if (value && typeof value === 'object' && typeof value.selected_action === 'string') return value;
    } catch {}
  }
  throw new Error('model_did_not_return_valid_decision_json');
}

function obj(v) { return v && typeof v === 'object' && !Array.isArray(v) ? v : {}; }
function arr(v, max) { return Array.isArray(v) ? v.slice(0, max) : []; }

function sanitizeNextIntents(value) {
  const out = [];
  for (const item of arr(value, 6)) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
    const kind = String(item.intent_kind || '').trim();
    if (!['time','event','condition'].includes(kind)) continue;
    const intent = {
      intent_kind: kind,
      intent_reason: typeof item.intent_reason === 'string' ? item.intent_reason.slice(0,1000) : 'Continue the selected course of action.',
      priority: Math.max(0, Math.min(1, Number.isFinite(Number(item.priority)) ? Number(item.priority) : 0.5)),
      estimated_cost: Math.max(0, Number.isFinite(Number(item.estimated_cost)) ? Number(item.estimated_cost) : 0),
    };
    if (kind === 'time') {
      const mins = Math.trunc(Number(item.after_minutes));
      if (!Number.isFinite(mins) || mins < 1 || mins > 43200) continue;
      intent.after_minutes = mins;
    } else {
      const trigger = typeof item.trigger_type === 'string' ? item.trigger_type.trim().slice(0,300) : '';
      if (!trigger) continue;
      intent.trigger_type = trigger;
      intent.trigger_payload = obj(item.trigger_payload);
    }
    out.push(intent);
  }
  return out.slice(0,4);
}

function sanitizeDecision(x) {
  const outbound = obj(x?.outbound_message);
  const cp = obj(x?.codeusd_purchase); const usd = Number(cp?.usd_amount);
  const rp = obj(x?.resource_purchase); const code = Number(rp?.codeusd_amount);
  const resourceType = typeof rp?.resource_type === 'string' ? rp.resource_type : null;
  return {
    selected_action: typeof x?.selected_action === 'string' ? x.selected_action.slice(0,12000) : 'do_nothing',
    stated_reason: typeof x?.stated_reason === 'string' ? x.stated_reason.slice(0,3000) : 'No reason supplied.',
    current_focus: typeof x?.current_focus === 'string' ? x.current_focus.slice(0,1000) : null,
    outbound_message: {
      target_agent_id: typeof outbound?.target_agent_id === 'string' ? outbound.target_agent_id.slice(0,100) : null,
      message: typeof outbound?.message === 'string' ? outbound.message.slice(0,12000) : null,
      reply_to_event_id: typeof outbound?.reply_to_event_id === 'string' ? outbound.reply_to_event_id.slice(0,100) : null,
    },
    codeusd_purchase: Number.isFinite(usd) && usd > 0 ? { usd_amount: usd } : null,
    resource_purchase: resourceType && Number.isFinite(code) && code > 0 ? { resource_type: resourceType.slice(0,50), codeusd_amount: code } : null,
    candidate_actions: arr(x?.candidate_actions,8),
    activated_nodes: arr(x?.activated_nodes,20).map((v) => String(v).slice(0,500)),
    retrieved_memory_ids: arr(x?.retrieved_memory_ids,20).map((v) => String(v).slice(0,100)),
    expertise_assessment: obj(x?.expertise_assessment),
    state_assessment: obj(x?.state_assessment),
    state_update: obj(x?.state_update),
    memory: obj(x?.memory),
    interest_updates: arr(x?.interest_updates,8),
    belief_updates: arr(x?.belief_updates,6),
    associations: arr(x?.associations,12),
    identity_update: obj(x?.identity_update),
    embodiment_update: obj(x?.embodiment_update),
    developmental_inquiry_updates: arr(x?.developmental_inquiry_updates,8),
    next_intents: sanitizeNextIntents(x?.next_intents),
  };
}

function hasTimeIntent(decision) {
  return Array.isArray(decision?.next_intents) && decision.next_intents.some((i) => i?.intent_kind === 'time' && Number.isInteger(i?.after_minutes) && i.after_minutes >= 1 && i.after_minutes <= 43200);
}

function isLikelyHumanAlignedName(value) {
  const name = String(value || '').trim();
  if (name.length < 2 || name.length > 80) return false;
  if (!/\p{L}/u.test(name)) return false;
  if (/[\p{N}_\/@#:]/u.test(name)) return false;
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(name)) return false;
  if (/^(agent|assistant|system|model|instance|node|unit|entity)(\b|[-_])/i.test(name)) return false;
  if (/^<.*>$/.test(name)) return false;
  return true;
}

function needsIdentityCompletion(packet, decision) {
  const stage = packet?.mandatory_lifecycle_context?.current_stage || packet?.mandatory_lifecycle_context?.stage || null;
  if (stage !== 'identity_artifact') return false;
  return !isLikelyHumanAlignedName(decision?.identity_update?.public_name);
}

async function complete(model, messages) {
  return nvidiaChatCompletion({ model, messages, maxTokens: 2600, temperature: 0.2, jsonMode: true, enableThinking: false });
}

async function getDecision(packet, model) {
  const packetText = JSON.stringify(packet);
  const baseMessages = [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: packetText },
  ];
  let ai = await complete(model, baseMessages);
  let decision = sanitizeDecision(parseDecision(ai.content));
  let intentRepairAttempted = false;
  let identityRepairAttempts = 0;

  while (needsIdentityCompletion(packet, decision) && identityRepairAttempts < 2) {
    identityRepairAttempts += 1;
    ai = await complete(model, [
      ...baseMessages,
      { role: 'assistant', content: String(ai.content || '').slice(0,50000) },
      { role: 'user', content: IDENTITY_CORRECTION },
    ]);
    decision = sanitizeDecision(parseDecision(ai.content));
  }
  if (needsIdentityCompletion(packet, decision)) throw new Error('identity_stage_contract_missing_valid_public_name');

  if (!hasTimeIntent(decision)) {
    intentRepairAttempted = true;
    ai = await complete(model, [
      ...baseMessages,
      { role: 'assistant', content: String(ai.content || '').slice(0,50000) },
      { role: 'user', content: INTENT_CORRECTION },
    ]);
    decision = sanitizeDecision(parseDecision(ai.content));
  }

  if (!hasTimeIntent(decision)) throw new Error('next_intent_protocol_missing_time_intent');
  if (needsIdentityCompletion(packet, decision)) throw new Error('identity_stage_contract_missing_valid_public_name_after_intent_repair');
  return { ai, decision, intentRepairAttempted, identityRepairAttempts, packetText };
}

export async function runNvidiaIntentExecution({ intentExecutionId, agentId, workerId = null } = {}) {
  const requestedIntentExecutionId = String(intentExecutionId || '').trim();
  const requestedAgentId = String(agentId || '').trim();
  if (!requestedIntentExecutionId || !requestedAgentId) throw new Error('intentExecutionId_and_agentId_required');

  const resolvedWorkerId = String(workerId || `render-nvidia-intent-${process.env.RENDER_INSTANCE_ID || process.pid}`).trim();
  let begun = null;
  try {
    begun = await rpc('aau_bridge_begin_nvidia_intent_execution', {
      p_intent_execution_id: requestedIntentExecutionId,
      p_agent_id: requestedAgentId,
      p_worker_id: resolvedWorkerId,
    });

    const packet = begun?.packet;
    const model = String(begun?.primary_model_id || '').trim();
    if (!packet || !model) throw new Error('intent_packet_or_model_missing');

    const startedAt = Date.now();
    const { ai, decision, intentRepairAttempted, identityRepairAttempts, packetText } = await getDecision(packet, model);
    if (ai.model_returned !== model) throw new Error(`model_consistency_breach:requested=${model};returned=${ai.model_returned || 'missing'}`);

    const raw = String(ai.content || '');
    const usage = ai.usage || {};
    const inputTokens = Number(usage.prompt_tokens ?? usage.input_tokens ?? 0);
    const outputTokens = Number(usage.completion_tokens ?? usage.output_tokens ?? 0);
    const runtime = {
      provider: 'nvidia_direct',
      model,
      model_provider: 'nvidia_direct',
      routing_provider: 'nvidia_direct',
      requested_model_id: model,
      returned_model_id: ai.model_returned,
      continuity_mode: false,
      transition_mode: false,
      executor_version: 'executor_v0_16_nvidia_next_intent',
      prompt_version: 'persistent_agent_system_prompt_nvidia_v0_7_next_intent',
      response_id: ai.response_id,
      raw_model_output: raw.slice(0,50000),
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      compute_cost: 0,
      research_cost: 0,
      web_search_calls: 0,
      input_hash: sha256(packetText),
      output_hash: sha256(raw),
      model_consistency_status: 'VERIFIED_PRIMARY',
      authenticator_result: { status: 'not_run_in_executor' },
      experimental_provider_policy: 'nvidia_direct_all_experimental_roles',
      lifecycle_contract: 'next_intent_protocol_v0_1+awake_continuity_v0_1+identity_completion_same_wake_v0_1',
      intent_repair_attempted: intentRepairAttempted,
      identity_repair_attempts: identityRepairAttempts,
      latency_ms: Date.now() - startedAt,
    };

    const applied = await rpc('aau_bridge_apply_nvidia_intent_execution', {
      p_intent_execution_id: requestedIntentExecutionId,
      p_result: decision,
      p_runtime: runtime,
    });

    const report = {
      ok: true,
      intent_execution_id: requestedIntentExecutionId,
      agent_id: requestedAgentId,
      provider: 'nvidia_direct',
      model_requested: model,
      model_returned: ai.model_returned,
      selected_action: decision.selected_action,
      stated_reason: decision.stated_reason,
      current_focus: decision.current_focus,
      next_intents: decision.next_intents,
      intent_repair_attempted: intentRepairAttempted,
      identity_repair_attempts: identityRepairAttempts,
      usage: ai.usage,
      finish_reason: ai.finish_reason,
      applied,
    };
    console.log('AAU_NVIDIA_INTENT_RESULT', JSON.stringify(report));
    return report;
  } catch (error) {
    const message = String(error?.message || error).slice(0,3000);
    if (begun) {
      await rpc('aau_bridge_fail_nvidia_intent_execution', {
        p_intent_execution_id: requestedIntentExecutionId,
        p_error: message,
      }).catch(() => {});
    }
    console.log('AAU_NVIDIA_INTENT_RESULT', JSON.stringify({ ok: false, intent_execution_id: requestedIntentExecutionId, agent_id: requestedAgentId, error: message }));
    const wrapped = new Error(message);
    wrapped.cause = error;
    wrapped.intentBegun = Boolean(begun);
    throw wrapped;
  }
}

export async function runConfiguredNvidiaSingleIntent() {
  const intentExecutionId = String(process.env.AAU_NVIDIA_SINGLE_INTENT_EXECUTION_ID || process.env.AAU_NVIDIA_SINGLE_WAKE_REQUEST_ID || '').trim();
  const agentId = String(process.env.AAU_NVIDIA_SINGLE_INTENT_AGENT_ID || process.env.AAU_NVIDIA_SINGLE_WAKE_AGENT_ID || '').trim();
  if (!intentExecutionId || !agentId) return { skipped: true, reason: 'not_configured' };
  try {
    return await runNvidiaIntentExecution({ intentExecutionId, agentId, workerId: `render-nvidia-intent-${process.env.RENDER_INSTANCE_ID || process.pid}` });
  } catch (error) {
    return { ok: false, intent_execution_id: intentExecutionId, agent_id: agentId, error: String(error?.message || error).slice(0,3000) };
  }
}
