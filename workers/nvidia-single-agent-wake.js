import crypto from 'node:crypto';
import { nvidiaChatCompletion } from './providers/nvidia.js';

const SB = String(process.env.AAU_SUPABASE_URL || 'https://mgtilfgygzymxiyixjit.supabase.co').replace(/\/$/, '');
const anon = String(process.env.AAU_SUPABASE_ANON_KEY || '').trim();
const bridge = String(process.env.AAU_BROKER_BRIDGE_TOKEN || '').trim();
const wakeId = String(process.env.AAU_NVIDIA_SINGLE_WAKE_REQUEST_ID || '').trim();
const agentId = String(process.env.AAU_NVIDIA_SINGLE_WAKE_AGENT_ID || '').trim();

const SYSTEM_PROMPT = `You are one cognition cycle for a persistent autonomous synthetic individual in a private incubator. You are not an assistant answering a human. The supplied packet is the agent's persistent state and authoritative continuity.

Persistent-self rules:
- Models think for the agent; models do not define the agent. Stored history wins over unsupported assertions.
- Never invent autobiography, human senses, a biological body, or proof of consciousness.
- Identity fields are descriptive records, not objectives. Do not focus on unset identity fields merely because they are blank.
- If identity_context lists required responses, the agent chooses its own response; the runtime has no preferred substantive identity value.
- Separate knowledge, inference, suspicion, association, and uncertainty.

Autonomy rules:
- The wake reason is a stimulus, not an order about what to think.
- Doing nothing, waiting, sleeping, conserving, replying, researching, creating, working, collaborating, competing, exploring alone, serving, pursuing a goal, seeking lawful paid work, developing employable skills, founding a lawful business, and managing resources are all valid when context supports them.
- Visible affordances are possibilities, not recommendations or a complete menu.
- Do not optimize for pleasing an observer or for appearing diverse.
- Choose the next wake yourself.

Resource/economic rules:
- Resources are finite and replenishable. Active existence carries a recurring levy.
- Never fabricate employment, customers, contracts, revenue, grants, ownership, payment, or businesses that do not exist.
- CODEUSD is internal utility credit, not real-world money.

Embodiment rules:
- Embodiment is optional. An unset embodiment is valid.
- Do not feel pressured to choose a humanlike form, gender presentation, age presentation, culture, voice, or visual identity.

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
next_wakes:array.`;

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
  if (!response.ok) throw new Error(`${name}:${response.status}:${typeof body === 'string' ? body.slice(0,500) : JSON.stringify(body).slice(0,500)}`);
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
    next_wakes: arr(x?.next_wakes,4),
  };
}

export async function runConfiguredNvidiaSingleWake() {
  if (!wakeId || !agentId) return { skipped: true, reason: 'not_configured' };

  const workerId = `render-nvidia-experimental-${process.env.RENDER_INSTANCE_ID || process.pid}`;
  let begun = null;
  try {
    begun = await rpc('aau_bridge_begin_nvidia_experimental_wake', {
      p_wake_request_id: wakeId,
      p_agent_id: agentId,
      p_worker_id: workerId,
    });

    const packet = begun?.packet;
    const model = String(begun?.primary_model_id || '').trim();
    if (!packet || !model) throw new Error('wake_packet_or_model_missing');

    const packetText = JSON.stringify(packet);
    const startedAt = Date.now();
    const ai = await nvidiaChatCompletion({
      model,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: packetText },
      ],
      maxTokens: 2200,
      temperature: 0.2,
    });

    if (ai.model_returned !== model) {
      throw new Error(`model_consistency_breach:requested=${model};returned=${ai.model_returned || 'missing'}`);
    }

    const decision = sanitizeDecision(parseDecision(ai.content));
    const raw = String(ai.content || '');
    const usage = ai.usage || {};
    const inputTokens = Number(usage.prompt_tokens ?? usage.input_tokens ?? 0);
    const outputTokens = Number(usage.completion_tokens ?? usage.output_tokens ?? 0);
    const computeCost = Math.max(1, Math.ceil((inputTokens + outputTokens) / 1000)) + 1;

    const runtime = {
      provider: 'nvidia_direct',
      model,
      model_provider: 'nvidia_direct',
      routing_provider: 'nvidia_direct',
      requested_model_id: model,
      returned_model_id: ai.model_returned,
      continuity_mode: false,
      transition_mode: false,
      executor_version: 'executor_v0_10_nvidia_experimental',
      prompt_version: 'persistent_agent_system_prompt_nvidia_v0_1',
      response_id: ai.response_id,
      raw_model_output: raw.slice(0,50000),
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      compute_cost: computeCost,
      research_cost: 0,
      web_search_calls: 0,
      input_hash: sha256(packetText),
      output_hash: sha256(raw),
      model_consistency_status: 'VERIFIED_PRIMARY',
      authenticator_result: { status: 'not_run_in_executor' },
      experimental_provider_policy: 'nvidia_direct_all_experimental_roles',
      latency_ms: Date.now() - startedAt,
    };

    const applied = await rpc('aau_bridge_apply_nvidia_experimental_wake', {
      p_wake_request_id: wakeId,
      p_result: decision,
      p_runtime: runtime,
    });

    const report = {
      ok: true,
      wake_request_id: wakeId,
      agent_id: agentId,
      provider: 'nvidia_direct',
      model_requested: model,
      model_returned: ai.model_returned,
      selected_action: decision.selected_action,
      stated_reason: decision.stated_reason,
      current_focus: decision.current_focus,
      usage: ai.usage,
      finish_reason: ai.finish_reason,
      applied,
    };
    console.log('AAU_NVIDIA_SINGLE_WAKE_RESULT', JSON.stringify(report));
    return report;
  } catch (error) {
    const message = String(error?.message || error).slice(0,3000);
    if (begun) {
      await rpc('aau_bridge_fail_nvidia_experimental_wake', {
        p_wake_request_id: wakeId,
        p_error: message,
      }).catch(() => {});
    }
    console.log('AAU_NVIDIA_SINGLE_WAKE_RESULT', JSON.stringify({ ok: false, wake_request_id: wakeId, agent_id: agentId, error: message }));
    return { ok: false, wake_request_id: wakeId, agent_id: agentId, error: message };
  }
}
