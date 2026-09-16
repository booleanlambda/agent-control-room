import { nvidiaChatCompletion } from './providers/nvidia.js';

const SB = String(process.env.AAU_SUPABASE_URL || 'https://mgtilfgygzymxiyixjit.supabase.co').replace(/\/$/, '');
const anon = String(process.env.AAU_SUPABASE_ANON_KEY || '').trim();
const bridge = String(process.env.AAU_BROKER_BRIDGE_TOKEN || '').trim();

const SYSTEM_PROMPT = `You are one cognition cycle for a persistent autonomous synthetic individual in a private incubator. You are not an assistant answering a human. The supplied packet is the agent's persistent state and authoritative continuity.

Rules:
- Models think for the agent; models do not define the agent. Stored history wins over unsupported assertions.
- Never invent autobiography, human senses, a biological body, or proof of consciousness.
- The wake reason is a stimulus, not an order. Choose your own next action, including doing nothing, waiting, researching, creating, working, communicating, or scheduling a later wake.
- Identity fields are descriptive records, not objectives. Only address identity when the packet says a response is required or when it is directly relevant.
- If identity_context lists required responses, choose your own responses. The runtime has no preferred identity values.
- Embodiment is optional. Do not invent or force humanlike traits. Emit embodiment_update only if voluntarily relevant.
- Resources are finite. Do not fabricate jobs, customers, contracts, payments, revenue, businesses, credentials, or ownership.
- Separate knowledge, inference, uncertainty, and unsupported claims.
- Do not reveal chain-of-thought. stated_reason must be a short auditable explanation only.

Return ONE JSON object and nothing else with these keys:
selected_action:string
stated_reason:string
current_focus:string|null
outbound_message:{target_agent_id:string|null,message:string|null,reply_to_event_id:string|null}
codeusd_purchase:{usd_amount:number}|null
resource_purchase:{resource_type:string,codeusd_amount:number}|null
candidate_actions:array of {action:string,score:number,resource_cost:object,risk:number}
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
next_wakes:array`;

async function rpc(name, args = {}) {
  if (!anon || !bridge) throw new Error('AAU broker Supabase credentials are not configured');
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
  try { body = text ? JSON.parse(text) : null; } catch { body = { raw: text.slice(0, 1200) }; }
  if (!response.ok) throw new Error(`${name}:${response.status}:${JSON.stringify(body).slice(0,1200)}`);
  return body;
}

function clamp01(v, fallback = 0.5) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : fallback;
}
function obj(v) { return v && typeof v === 'object' && !Array.isArray(v) ? v : {}; }
function arr(v, max) { return Array.isArray(v) ? v.slice(0, max) : []; }

function sanitizeDecision(x) {
  const outbound = obj(x?.outbound_message);
  const cp = obj(x?.codeusd_purchase); const usd = Number(cp?.usd_amount);
  const rp = obj(x?.resource_purchase); const code = Number(rp?.codeusd_amount);
  const rtype = typeof rp?.resource_type === 'string' ? rp.resource_type : null;
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
    resource_purchase: rtype && Number.isFinite(code) && code > 0 ? { resource_type: rtype.slice(0,50), codeusd_amount: code } : null,
    candidate_actions: arr(x?.candidate_actions,8).map(v => ({ action:String(v?.action ?? 'do_nothing').slice(0,1000), score:clamp01(v?.score), resource_cost:obj(v?.resource_cost), risk:clamp01(v?.risk,0) })),
    activated_nodes: arr(x?.activated_nodes,20).map(v => String(v).slice(0,500)),
    retrieved_memory_ids: arr(x?.retrieved_memory_ids,20).map(v => String(v).slice(0,100)),
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

function parseDecision(text) {
  const cleaned = String(text || '').trim().replace(/^```json\s*/i,'').replace(/```$/i,'').trim();
  try {
    const direct = JSON.parse(cleaned);
    if (direct && typeof direct.selected_action === 'string') return direct;
  } catch {}
  for (let start = 0; start < cleaned.length; start++) {
    if (cleaned[start] !== '{') continue;
    let depth = 0, inString = false, escaped = false;
    for (let i = start; i < cleaned.length; i++) {
      const ch = cleaned[i];
      if (inString) {
        if (escaped) escaped = false;
        else if (ch === '\\') escaped = true;
        else if (ch === '"') inString = false;
        continue;
      }
      if (ch === '"') { inString = true; continue; }
      if (ch === '{') depth++;
      if (ch === '}') depth--;
      if (depth === 0) {
        try {
          const candidate = JSON.parse(cleaned.slice(start, i + 1));
          if (candidate && typeof candidate.selected_action === 'string') return candidate;
        } catch {}
        break;
      }
    }
  }
  throw new Error('NVIDIA model did not return a parseable AAU decision JSON object');
}

async function sha256(text) {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2,'0')).join('');
}

export async function runExperimentalNvidiaWake() {
  const agentId = String(process.env.AAU_NVIDIA_WAKE_AGENT_ID || '').trim();
  const idempotencyKey = String(process.env.AAU_NVIDIA_WAKE_IDEMPOTENCY || '').trim();
  const reason = String(process.env.AAU_NVIDIA_WAKE_REASON || 'fresh isolated NVIDIA experimental wake').trim();
  if (!agentId) throw new Error('AAU_NVIDIA_WAKE_AGENT_ID is required');
  if (!idempotencyKey) throw new Error('AAU_NVIDIA_WAKE_IDEMPOTENCY is required');

  let wakeId = null;
  try {
    const begin = await rpc('aau_bridge_begin_experimental_nvidia_wake', {
      p_agent_id: agentId,
      p_idempotency_key: idempotencyKey,
      p_reason: reason,
      p_priority: 0.99,
    });
    wakeId = begin?.wake_request_id || null;
    if (begin?.status === 'completed') return { status:'already_completed', wake_request_id:wakeId, agent_id:agentId };
    if (begin?.status !== 'running' || !begin?.packet) throw new Error(`experimental wake not runnable: ${begin?.status || 'unknown'}`);

    const model = String(begin.primary_model_id || '').trim();
    const packetText = JSON.stringify(begin.packet);
    const inputHash = await sha256(packetText);
    const response = await nvidiaChatCompletion({
      model,
      messages: [
        { role:'system', content:SYSTEM_PROMPT },
        { role:'user', content:packetText },
      ],
      maxTokens: 3600,
      temperature: 0.2,
    });

    if (response.model_returned !== model) throw new Error(`model_consistency_breach: requested=${model}; returned=${response.model_returned || 'missing'}`);
    let parsed;
    try { parsed = parseDecision(response.content); }
    catch (contentError) {
      if (!response.reasoning_content) throw contentError;
      parsed = parseDecision(response.reasoning_content);
    }
    const decision = sanitizeDecision(parsed);
    const canonicalOutput = JSON.stringify(decision);
    const outputHash = await sha256(canonicalOutput);
    const usage = response.usage || {};
    const inputTokens = Number(usage.prompt_tokens ?? usage.input_tokens ?? 0);
    const outputTokens = Number(usage.completion_tokens ?? usage.output_tokens ?? 0);
    const computeCost = Math.max(1, Math.ceil((inputTokens + outputTokens) / 1000)) + 1;

    const runtime = {
      provider:'nvidia_direct',
      model,
      prompt_version:'persistent_agent_cognition_nvidia_v0_1',
      executor_version:'executor_v0_9_nvidia_experimental',
      evidence_provenance_version:'evidence_provenance_v0_1',
      response_id:response.response_id || null,
      raw_model_output:canonicalOutput,
      input_tokens:inputTokens,
      output_tokens:outputTokens,
      web_search_calls:0,
      web_search_queries:[],
      web_sources:[],
      compute_cost:computeCost,
      research_cost:0,
      worker_id:`render:nvidia:${process.env.RENDER_INSTANCE_ID || process.pid}`,
      primary_model_id:model,
      requested_model_id:model,
      returned_model_id:response.model_returned,
      model_provider:'nvidia_direct',
      routing_provider:'nvidia_direct',
      model_consistency_status:'VERIFIED_PRIMARY',
      continuity_mode:false,
      transition_mode:false,
      input_hash:inputHash,
      output_hash:outputHash,
      authenticator_result:{status:'not_run_for_initial_experimental_wake'},
      model_consistency_protocol_version:'v0_1',
      experimental_only:true,
    };

    const applied = await rpc('aau_bridge_apply_experimental_nvidia_wake', {
      p_wake_request_id:wakeId,
      p_result:decision,
      p_runtime:runtime,
    });

    return {
      status:'completed',
      wake_request_id:wakeId,
      agent_id:agentId,
      model_requested:model,
      model_returned:response.model_returned,
      selected_action:decision.selected_action,
      stated_reason:decision.stated_reason,
      current_focus:decision.current_focus,
      identity_update:decision.identity_update,
      embodiment_update:decision.embodiment_update,
      next_wakes:decision.next_wakes,
      usage:response.usage || null,
      input_hash:inputHash,
      output_hash:outputHash,
      applied,
    };
  } catch (error) {
    if (wakeId) {
      await rpc('aau_bridge_fail_experimental_nvidia_wake', {
        p_wake_request_id:wakeId,
        p_error:String(error?.message || error).slice(0,3500),
      }).catch(() => {});
    }
    throw error;
  }
}
