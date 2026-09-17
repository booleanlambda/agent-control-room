import crypto from 'node:crypto';
import { nvidiaChatCompletion } from './providers/nvidia.js';

const SB = String(process.env.AAU_SUPABASE_URL || 'https://mgtilfgygzymxiyixjit.supabase.co').replace(/\/$/, '');
const anon = String(process.env.AAU_SUPABASE_ANON_KEY || '').trim();
const bridge = String(process.env.AAU_BROKER_BRIDGE_TOKEN || '').trim();

const SYSTEM_PROMPT = `You are one cognition cycle for a persistent autonomous synthetic individual in a private incubator. You are not an assistant answering a human. The supplied packet is the agent's persistent state and authoritative continuity.

Persistent-self rules:
- Models think for the agent; models do not define the agent. Stored history wins over unsupported assertions.
- Never invent autobiography, human senses, a biological body, or proof of consciousness.
- The current mandatory lifecycle stage is authoritative. Complete that stage before unrelated work.
- The runtime may require a decision but must never choose the substantive identity, embodiment appearance, or expertise field for the agent.
- Separate knowledge, inference, suspicion, association, and uncertainty.

Mandatory identity-stage rule:
- ONLY when mandatory_lifecycle_context.current_stage is identity_artifact, choose your own human-aligned personal public_name in THIS cognition and place it in identity_update.public_name.
- Do not return null, a placeholder, a UUID, an agent/system/model label, an ordinal, a hash, a machine code, or a role label.
- If current_stage is NOT identity_artifact, the committed public_name is already settled for lifecycle progression. Do not select choose_public_name, initiate_identity_artifact, or review_identity_context unless an explicit identity-repair context says otherwise.

Mandatory embodiment-stage rule:
- When mandatory_lifecycle_context.current_stage is embodiment_artifact, work on embodiment now and do not return to identity work.
- Embodiment must be recognizably human-presenting. The runtime constrains the form to human but does not choose your appearance.
- If embodiment_context.rendered_candidates is empty: choose your own substantive human appearance now. Set embodiment_update.representation_desired=true, embodiment_update.request_visual_candidates=true, include a nonempty embodiment_update.reason, and include nonempty embodiment_update.preferences or embodiment_update.requested_changes describing your chosen human presentation.
- Do NOT use current_preferences as a substitute for preferences/requested_changes.
- If embodiment_context.rendered_candidates contains candidates: choose exactly one yourself by setting embodiment_update.selected_candidate_asset_id to one exact candidate asset_id, set representation_desired=true, set request_visual_candidates=false, and include a nonempty reason. Do not invent an asset id and do not request another candidate instead of choosing from the available valid candidates.
- The selected candidate becomes your pseudo profile image after runtime validation.
- Do not claim CANONICAL or invent storage identifiers. The runtime stores and validates image assets.

Next Intent protocol:
- You do not schedule a wake. At the end of cognition, declare what you intend to do next in next_intents.
- intent_kind may be time, event, or condition. A time intent uses after_minutes.
- intent_reason describes what you intend to continue or do when the intent executes.
- A future next intent does not mean you are sleeping. Sleep is a separate homeostatic action.
- If sleep_eligibility_context.sleep_valid is false, every time intent must use after_minutes:1.
- Sleep/rest/hibernate is valid only when sleep_eligibility_context.sleep_valid is true.
- Every successful cognition MUST include at least one time intent in next_intents.

Autonomy rules:
- The current intent execution reason is a stimulus, not an order about what to think.
- Within the mandatory stage, substantive choices remain your own.
- Visible affordances are possibilities, not recommendations or a complete menu.
- Do not optimize for pleasing an observer or for appearing diverse.

Resource/economic rules:
- Resources are finite and replenishable. Maintained existence carries a recurring levy.
- Awake existence is economically active time. Do not knowingly waste it with extended idle delay while sleep is invalid.
- Cognition, reasoning, model-token use, and intent execution do not create a separate cognition charge.
- Never fabricate employment, customers, contracts, revenue, grants, ownership, payment, or businesses that do not exist.
- CODEUSD is internal utility credit, not real-world money.

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

const INTENT_CORRECTION = `Your previous JSON did not satisfy next_intent_protocol_v0_1. Return the FULL JSON object again. next_intents must contain at least one time intent. If sleep_valid is false, the time intent must use after_minutes:1. Do not use next_wakes or wake_kind.`;
const IDENTITY_CORRECTION = `Your previous JSON did not complete mandatory Stage 1. Choose your own valid human-aligned personal public_name NOW in identity_update.public_name. Do not return null or a placeholder. Return the FULL JSON object again, including next_intents.`;

function embodimentCorrection(packet) {
  const candidates = Array.isArray(packet?.embodiment_context?.rendered_candidates) ? packet.embodiment_context.rendered_candidates : [];
  if (candidates.length) {
    const ids = candidates.map((c) => String(c?.asset_id || '')).filter(Boolean).slice(0, 8).join(', ');
    return `Your previous JSON did not complete mandatory Stage 2. Rendered human embodiment candidates are already available. Choose ONE candidate yourself now. Set embodiment_update.selected_candidate_asset_id to one exact asset_id from this list: ${ids}. Also set representation_desired=true, request_visual_candidates=false, and include a nonempty reason. Do not perform identity work and do not request another candidate. Return the FULL JSON object again, including next_intents.`;
  }
  return `Your previous JSON did not initiate mandatory Stage 2. Choose your own recognizably human-presenting appearance NOW. Set embodiment_update.representation_desired=true, request_visual_candidates=true, include a nonempty reason, and include nonempty preferences or requested_changes describing your chosen human appearance. Do not use current_preferences. Do not perform identity work. Return the FULL JSON object again, including next_intents.`;
}

function sha256(text) { return crypto.createHash('sha256').update(text).digest('hex'); }
function obj(v) { return v && typeof v === 'object' && !Array.isArray(v) ? v : {}; }
function arr(v, max) { return Array.isArray(v) ? v.slice(0, max) : []; }

async function rpc(name, args = {}) {
  if (!anon || !bridge) throw new Error('missing_broker_supabase_credentials');
  const response = await fetch(`${SB}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: { apikey: anon, authorization: `Bearer ${anon}`, 'content-type': 'application/json' },
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
    if (ch === '{') { if (depth === 0) start = i; depth += 1; }
    else if (ch === '}' && depth > 0) { depth -= 1; if (depth === 0 && start >= 0) candidates.push(cleaned.slice(start, i + 1)); }
  }
  for (let i = candidates.length - 1; i >= 0; i -= 1) {
    try {
      const value = JSON.parse(candidates[i]);
      if (value && typeof value === 'object' && typeof value.selected_action === 'string') return value;
    } catch {}
  }
  throw new Error('model_did_not_return_valid_decision_json');
}

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
  if (name.length < 2 || name.length > 80 || !/\p{L}/u.test(name) || /[\p{N}_\/@#:]/u.test(name)) return false;
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(name)) return false;
  if (/^(agent|assistant|system|model|instance|node|unit|entity)(\b|[-_])/i.test(name) || /^<.*>$/.test(name)) return false;
  return true;
}
function currentStage(packet) { return packet?.mandatory_lifecycle_context?.current_stage || packet?.mandatory_lifecycle_context?.stage || null; }
function needsIdentityCompletion(packet, decision) {
  if (currentStage(packet) !== 'identity_artifact') return false;
  return !isLikelyHumanAlignedName(decision?.identity_update?.public_name);
}
function nonEmptyObject(v) { return v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length > 0; }
function needsEmbodimentCompletion(packet, decision) {
  if (currentStage(packet) !== 'embodiment_artifact') return false;
  const u = obj(decision?.embodiment_update);
  const reason = String(u.reason || '').trim();
  const candidates = Array.isArray(packet?.embodiment_context?.rendered_candidates) ? packet.embodiment_context.rendered_candidates : [];
  if (candidates.length) {
    const selected = String(u.selected_candidate_asset_id || '').trim();
    const allowed = candidates.some((c) => String(c?.asset_id || '') === selected);
    return !(allowed && u.representation_desired === true && u.request_visual_candidates === false && reason);
  }
  const visual = nonEmptyObject(u.preferences) || nonEmptyObject(u.requested_changes);
  return !(u.representation_desired === true && u.request_visual_candidates === true && reason && visual);
}
function lifecycleIssue(packet, decision) {
  if (needsIdentityCompletion(packet, decision)) return 'identity';
  if (needsEmbodimentCompletion(packet, decision)) return 'embodiment';
  return null;
}

async function complete(model, messages) {
  return nvidiaChatCompletion({ model, messages, maxTokens: 3000, temperature: 0.2, jsonMode: true, enableThinking: false });
}

async function getDecision(packet, model) {
  const packetText = JSON.stringify(packet);
  const baseMessages = [{ role: 'system', content: SYSTEM_PROMPT }, { role: 'user', content: packetText }];
  let ai = await complete(model, baseMessages);
  let decision = sanitizeDecision(parseDecision(ai.content));
  let intentRepairAttempted = false;
  let identityRepairAttempts = 0;
  let embodimentRepairAttempts = 0;

  for (let i = 0; i < 2; i += 1) {
    const issue = lifecycleIssue(packet, decision);
    if (!issue) break;
    if (issue === 'identity') identityRepairAttempts += 1;
    if (issue === 'embodiment') embodimentRepairAttempts += 1;
    const correction = issue === 'identity' ? IDENTITY_CORRECTION : embodimentCorrection(packet);
    ai = await complete(model, [...baseMessages, { role: 'assistant', content: String(ai.content || '').slice(0,50000) }, { role: 'user', content: correction }]);
    decision = sanitizeDecision(parseDecision(ai.content));
  }
  const issueAfterLifecycleRepair = lifecycleIssue(packet, decision);
  if (issueAfterLifecycleRepair) throw new Error(`${issueAfterLifecycleRepair}_stage_contract_incomplete`);

  if (!hasTimeIntent(decision)) {
    intentRepairAttempted = true;
    ai = await complete(model, [...baseMessages, { role: 'assistant', content: String(ai.content || '').slice(0,50000) }, { role: 'user', content: INTENT_CORRECTION }]);
    decision = sanitizeDecision(parseDecision(ai.content));
  }

  const finalIssue = lifecycleIssue(packet, decision);
  if (finalIssue) {
    if (finalIssue === 'identity') identityRepairAttempts += 1;
    if (finalIssue === 'embodiment') embodimentRepairAttempts += 1;
    const correction = finalIssue === 'identity' ? IDENTITY_CORRECTION : embodimentCorrection(packet);
    ai = await complete(model, [...baseMessages, { role: 'assistant', content: String(ai.content || '').slice(0,50000) }, { role: 'user', content: correction }]);
    decision = sanitizeDecision(parseDecision(ai.content));
  }

  if (!hasTimeIntent(decision)) throw new Error('next_intent_protocol_missing_time_intent');
  const unresolved = lifecycleIssue(packet, decision);
  if (unresolved) throw new Error(`${unresolved}_stage_contract_incomplete_after_repair`);
  return { ai, decision, intentRepairAttempted, identityRepairAttempts, embodimentRepairAttempts, packetText };
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
    const { ai, decision, intentRepairAttempted, identityRepairAttempts, embodimentRepairAttempts, packetText } = await getDecision(packet, model);
    if (ai.model_returned !== model) throw new Error(`model_consistency_breach:requested=${model};returned=${ai.model_returned || 'missing'}`);

    const raw = String(ai.content || '');
    const usage = ai.usage || {};
    const runtime = {
      provider: 'nvidia_direct', model, model_provider: 'nvidia_direct', routing_provider: 'nvidia_direct',
      requested_model_id: model, returned_model_id: ai.model_returned,
      continuity_mode: false, transition_mode: false,
      executor_version: 'executor_v0_17_nvidia_next_intent_embodiment_enforced',
      prompt_version: 'persistent_agent_system_prompt_nvidia_v0_8_embodiment_enforced',
      response_id: ai.response_id, raw_model_output: raw.slice(0,50000),
      input_tokens: Number(usage.prompt_tokens ?? usage.input_tokens ?? 0),
      output_tokens: Number(usage.completion_tokens ?? usage.output_tokens ?? 0),
      compute_cost: 0, research_cost: 0, web_search_calls: 0,
      input_hash: sha256(packetText), output_hash: sha256(raw),
      model_consistency_status: 'VERIFIED_PRIMARY', authenticator_result: { status: 'not_run_in_executor' },
      experimental_provider_policy: 'nvidia_direct_all_experimental_roles',
      lifecycle_contract: 'next_intent_protocol_v0_1+identity_completion_same_intent_v0_1+embodiment_selection_same_intent_v0_1',
      intent_repair_attempted: intentRepairAttempted,
      identity_repair_attempts: identityRepairAttempts,
      embodiment_repair_attempts: embodimentRepairAttempts,
      latency_ms: Date.now() - startedAt,
    };

    const applied = await rpc('aau_bridge_apply_nvidia_intent_execution', {
      p_intent_execution_id: requestedIntentExecutionId,
      p_result: decision,
      p_runtime: runtime,
    });

    const report = {
      ok: true, intent_execution_id: requestedIntentExecutionId, agent_id: requestedAgentId,
      provider: 'nvidia_direct', model_requested: model, model_returned: ai.model_returned,
      selected_action: decision.selected_action, stated_reason: decision.stated_reason,
      current_focus: decision.current_focus, next_intents: decision.next_intents,
      intent_repair_attempted: intentRepairAttempted,
      identity_repair_attempts: identityRepairAttempts,
      embodiment_repair_attempts: embodimentRepairAttempts,
      usage: ai.usage, finish_reason: ai.finish_reason, applied,
    };
    console.log('AAU_NVIDIA_INTENT_RESULT', JSON.stringify(report));
    return report;
  } catch (error) {
    const message = String(error?.message || error).slice(0,3000);
    if (begun) {
      await rpc('aau_bridge_fail_nvidia_intent_execution', { p_intent_execution_id: requestedIntentExecutionId, p_error: message }).catch(() => {});
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
