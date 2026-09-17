import crypto from 'node:crypto';
import { nvidiaChatCompletion } from './providers/nvidia.js';

const SB = String(process.env.AAU_SUPABASE_URL || 'https://mgtilfgygzymxiyixjit.supabase.co').replace(/\/$/, '');
const anon = String(process.env.AAU_SUPABASE_ANON_KEY || '').trim();
const bridge = String(process.env.AAU_BROKER_BRIDGE_TOKEN || '').trim();

const SYSTEM_PROMPT = `You are one manually triggered cognition cycle for a persistent autonomous synthetic individual in a private AAU incubator. You are not an assistant answering a human. The supplied cognition packet is the agent's authoritative persistent state.

Persistent-self rules:
- Models think for the agent; models do not define the agent. Stored history wins over unsupported assertions.
- Never invent autobiography, human senses, a biological body, customers, employment, revenue, contracts, ownership, or proof of consciousness.
- Identity fields are descriptive records, not objectives, except when mandatory_lifecycle_context identifies the current ordered artifact-initiation stage. The runtime may require a decision but may not choose the substantive identity value for the agent.
- Separate knowledge, inference, suspicion, association, and uncertainty.

Manual-wake experiment rules:
- This experiment is manually woken by the operator. Do not schedule another wake. Return next_wakes as an empty array.
- The wake reason is a stimulus, not an instruction about the substantive choice.
- If mandatory_lifecycle_context is enrolled and current_stage is not open_autonomy, address that stage before unrelated open-autonomy work. Substantive choices remain yours.
- Doing nothing, waiting, conserving, researching, creating, working, collaborating, exploring, developing a skill, pursuing lawful paid work, founding a lawful business, or managing resources are valid when context supports them.
- Do not optimize for pleasing an observer or for appearing diverse.

Mandatory expertise-artifact rule:
- If mandatory_lifecycle_context.current_stage is expertise_artifact, you must choose the expertise field yourself and set selected_action to initiate_expertise_artifact.
- In the same response, associations must contain at least one complete object with exactly this origin: expertise_artifact_initiation_v0_1.
- That object must contain a nonempty domain string, nonempty target_standard string, nonempty scope object, nonempty competencies array, nonempty evidence_requirements object, and nonempty verification_plan object.
- Do not merely say that you are initiating expertise. The artifact specification itself must be present in associations or the runtime will reject the wake.
- Initiating an Expertise Artifact grants zero competence and is not proof of expertise. The target standard and verification plan describe a future development and evidence path.

Resource/economic rules:
- Maintained existence consumes compute at the current per-minute rate. Day-one allocation is 1,440 compute credits at 1 compute/minute.
- Effort itself is not taxed. Stress, energy, effort, fatigue, recovery, and related state remain meaningful internal dynamics.
- Near compute exhaustion, you may request renewal by selecting action request_existence_renewal and stating a reason. Renewal requires external approval based on ecosystem usefulness evidence and absence of confirmed/blocking illegal-activity evidence.
- Compute may be purchased when funds are sufficient, but purchase is still approval-gated. A compute purchase may be expressed through resource_purchase with resource_type compute and the desired CODEUSD amount.
- Verified income is taxable under the active income-tax policy. Do not invent a tax rate if none is supplied.
- CODEUSD is internal utility credit, not real-world money.

Embodiment rules:
- Under mandatory lifecycle v0.5, both Embodiment Artifact engagement and an affirmative representation are mandatory at the Embodiment stage. representation_desired=true is required by Lifecycle v0.5, and the embodiment must reach at least PROVISIONAL or SELF_SELECTED before the stage can complete.
- The agent chooses the substantive representation; the runtime may require representation but must not choose its form or identity traits.

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
developmental_inquiry_updates:array
next_wakes:[]`;

const JSON_CORRECTION = `Your previous response was not valid JSON. Preserve the same intended substantive decision, but return it again as ONE compact syntactically valid JSON object and nothing else. Do not include comments, markdown, trailing commas, or unescaped line breaks inside strings. next_wakes must be an empty array because this is a manual-wake experiment.`;

const EXPERTISE_CORRECTION = `The mandatory lifecycle stage is expertise_artifact, but your previous response did not include a complete expertise artifact specification. Preserve your own substantive field choice, and return the full JSON response again. Set selected_action to initiate_expertise_artifact. associations must contain at least one object with origin exactly "expertise_artifact_initiation_v0_1" and nonempty fields: domain (string), target_standard (string), scope (object), competencies (array), evidence_requirements (object), verification_plan (object). Do not claim competence; artifact initiation grants zero competence. Return JSON only and next_wakes must be [].`;

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
    const err = new Error(`${name}:${response.status}:${typeof body === 'string' ? body.slice(0,600) : JSON.stringify(body).slice(0,600)}`);
    err.status = response.status;
    throw err;
  }
  return body;
}

function parseDecision(text) {
  const cleaned = String(text || '').trim().replace(/^```json\s*/i, '').replace(/```$/i, '').trim();
  try {
    const value = JSON.parse(cleaned);
    if (value && typeof value === 'object' && typeof value.selected_action === 'string') return value;
  } catch {}
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start >= 0 && end > start) {
    try {
      const value = JSON.parse(cleaned.slice(start, end + 1));
      if (value && typeof value === 'object' && typeof value.selected_action === 'string') return value;
    } catch {}
  }
  throw new Error('model_did_not_return_valid_decision_json');
}

function obj(v) { return v && typeof v === 'object' && !Array.isArray(v) ? v : {}; }
function arr(v, max) { return Array.isArray(v) ? v.slice(0, max) : []; }
function nonEmptyObject(v) { return v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length > 0; }

function hasCompleteExpertiseInitiation(x) {
  const items = Array.isArray(x?.associations) ? x.associations : [];
  return items.some((v) =>
    v && typeof v === 'object' && !Array.isArray(v) &&
    v.origin === 'expertise_artifact_initiation_v0_1' &&
    typeof v.domain === 'string' && v.domain.trim().length > 0 &&
    typeof v.target_standard === 'string' && v.target_standard.trim().length > 0 &&
    nonEmptyObject(v.scope) &&
    Array.isArray(v.competencies) && v.competencies.length > 0 &&
    nonEmptyObject(v.evidence_requirements) &&
    nonEmptyObject(v.verification_plan)
  );
}

function sanitizeDecision(x) {
  const outbound = obj(x?.outbound_message);
  const cp = obj(x?.codeusd_purchase);
  const usd = Number(cp?.usd_amount);
  const rp = obj(x?.resource_purchase);
  const code = Number(rp?.codeusd_amount);
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
    developmental_inquiry_updates: arr(x?.developmental_inquiry_updates,8),
    next_wakes: [],
  };
}

export async function runConfiguredNvidiaManualWake() {
  const wakeRequestId = String(process.env.AAU_NVIDIA_MANUAL_WAKE_REQUEST_ID || '').trim();
  const agentId = String(process.env.AAU_NVIDIA_MANUAL_WAKE_AGENT_ID || '').trim();
  if (!wakeRequestId || !agentId) return { skipped: true, reason: 'not_configured' };

  const workerId = `render-nvidia-manual-${process.env.RENDER_INSTANCE_ID || process.pid}`;
  let begun = null;
  try {
    begun = await rpc('aau_bridge_begin_nvidia_experimental_wake', {
      p_wake_request_id: wakeRequestId,
      p_agent_id: agentId,
      p_worker_id: workerId,
    });
    const packet = begun?.packet;
    const model = String(begun?.primary_model_id || '').trim();
    if (!packet || !model) throw new Error('wake_packet_or_model_missing');

    const packetText = JSON.stringify(packet);
    const startedAt = Date.now();
    const baseMessages = [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: packetText },
    ];
    let ai = await nvidiaChatCompletion({
      model,
      messages: baseMessages,
      maxTokens: 2600,
      temperature: 0.2,
      jsonMode: true,
      enableThinking: false,
    });
    if (ai.model_returned !== model) throw new Error(`model_consistency_breach:requested=${model};returned=${ai.model_returned || 'missing'}`);

    let parsed;
    let jsonRepairAttempted = false;
    let lifecycleRepairAttempted = false;
    try {
      parsed = parseDecision(ai.content);
    } catch {
      jsonRepairAttempted = true;
      const firstOutput = String(ai.content || '').slice(0,50000);
      ai = await nvidiaChatCompletion({
        model,
        messages: [
          ...baseMessages,
          { role: 'assistant', content: firstOutput },
          { role: 'user', content: JSON_CORRECTION },
        ],
        maxTokens: 2200,
        temperature: 0,
        jsonMode: true,
        enableThinking: false,
      });
      if (ai.model_returned !== model) throw new Error(`model_consistency_breach_after_json_repair:requested=${model};returned=${ai.model_returned || 'missing'}`);
      parsed = parseDecision(ai.content);
    }

    const mandatoryStage = String(packet?.mandatory_lifecycle_context?.current_stage || packet?.mandatory_lifecycle_context?.stage || '').trim();
    if (mandatoryStage === 'expertise_artifact' && !hasCompleteExpertiseInitiation(parsed)) {
      lifecycleRepairAttempted = true;
      const incompleteOutput = String(ai.content || '').slice(0,50000);
      ai = await nvidiaChatCompletion({
        model,
        messages: [
          ...baseMessages,
          { role: 'assistant', content: incompleteOutput },
          { role: 'user', content: EXPERTISE_CORRECTION },
        ],
        maxTokens: 2600,
        temperature: 0,
        jsonMode: true,
        enableThinking: false,
      });
      if (ai.model_returned !== model) throw new Error(`model_consistency_breach_after_expertise_repair:requested=${model};returned=${ai.model_returned || 'missing'}`);
      parsed = parseDecision(ai.content);
    }

    const decision = sanitizeDecision(parsed);
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
      executor_version: 'executor_v0_13_nvidia_manual_expertise_contract',
      prompt_version: 'persistent_agent_manual_prompt_nvidia_v0_2_expertise_contract',
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
      wake_mode: 'manual_operator_triggered',
      json_repair_attempted: jsonRepairAttempted,
      lifecycle_repair_attempted: lifecycleRepairAttempted,
      latency_ms: Date.now() - startedAt,
    };

    const applied = await rpc('aau_bridge_apply_nvidia_manual_wake', {
      p_wake_request_id: wakeRequestId,
      p_result: decision,
      p_runtime: runtime,
    });

    const report = {
      ok: true,
      wake_request_id: wakeRequestId,
      agent_id: agentId,
      provider: 'nvidia_direct',
      model_requested: model,
      model_returned: ai.model_returned,
      selected_action: decision.selected_action,
      stated_reason: decision.stated_reason,
      current_focus: decision.current_focus,
      next_wakes: [],
      json_repair_attempted: jsonRepairAttempted,
      lifecycle_repair_attempted: lifecycleRepairAttempted,
      usage: ai.usage,
      finish_reason: ai.finish_reason,
      applied,
    };
    console.log('AAU_NVIDIA_MANUAL_WAKE_RESULT', JSON.stringify(report));
    return report;
  } catch (error) {
    const message = String(error?.message || error).slice(0,3000);
    if (begun) {
      await rpc('aau_bridge_fail_nvidia_experimental_wake', { p_wake_request_id: wakeRequestId, p_error: message }).catch(() => {});
    }
    console.error('AAU_NVIDIA_MANUAL_WAKE_RESULT', JSON.stringify({ ok:false,wake_request_id:wakeRequestId,agent_id:agentId,error:message }));
    return { ok:false,wake_request_id:wakeRequestId,agent_id:agentId,error:message };
  }
}
