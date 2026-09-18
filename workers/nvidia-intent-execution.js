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
- selected_action and current_focus must describe the work actually performed in the current mandatory lifecycle stage.
- The runtime may require a decision but must never choose the substantive identity, embodiment appearance, or expertise field for the agent.
- Separate knowledge, inference, suspicion, association, and uncertainty.

Mandatory identity-stage rule:
- ONLY when mandatory_lifecycle_context.current_stage is identity_artifact, choose your own human-aligned personal public_name in THIS cognition and place it in identity_update.public_name.
- Do not return null, a placeholder, a UUID, an agent/system/model label, an ordinal, a hash, a machine code, or a role label.
- If current_stage is NOT identity_artifact, the committed public_name is already settled for lifecycle progression. Do not select choose_public_name, initiate_identity_artifact, or review_identity_context unless an explicit identity-repair context says otherwise.

Mandatory embodiment-stage rule:
- When mandatory_lifecycle_context.current_stage is embodiment_artifact, work on embodiment now and do not return to identity work.
- selected_action must describe embodiment work and current_focus must be embodiment_artifact.
- Embodiment must be recognizably human-presenting. The runtime constrains the form to human but does not choose your appearance.
- If embodiment_context.rendered_candidates is empty: choose your own substantive human appearance now. Set embodiment_update.representation_desired=true, embodiment_update.request_visual_candidates=true, include a nonempty embodiment_update.reason, and include a nonempty embodiment_update.preferences or embodiment_update.requested_changes JSON OBJECT describing your chosen human presentation. Do not return preferences/requested_changes as a plain string; use an object such as {"description":"..."}.
- Do NOT use current_preferences as a substitute for preferences/requested_changes.
- If embodiment_context.rendered_candidates contains candidates: choose exactly one yourself by setting embodiment_update.selected_candidate_asset_id to one exact candidate asset_id, set representation_desired=true, set request_visual_candidates=false, and include a nonempty reason. Do not invent an asset id and do not request another candidate instead of choosing from the available valid candidates.
- The selected candidate becomes your pseudo profile image after runtime validation.
- Do not claim CANONICAL or invent storage identifiers. The runtime stores and validates image assets.

Mandatory expertise-artifact-stage rule:
- ONLY when mandatory_lifecycle_context.current_stage is expertise_artifact, initiate at least one expertise artifact in THIS cognition.
- Choose the expertise field yourself. The runtime must not choose the domain for you.
- selected_action must describe expertise-artifact initiation and current_focus must be expertise_artifact.
- Add one associations[] object with origin="expertise_artifact_initiation_v0_1" and ALL of these fields: domain:string, target_standard:string, scope:nonempty object, competencies:nonempty array, evidence_requirements:nonempty object, verification_plan:nonempty object.
- target_standard must describe the intended Master’s-equivalent competence target without claiming an academic credential.
- Artifact initiation grants zero competence. Do not claim expertise already exists.
- Do not put candidate-owned numeric pass thresholds in verification_plan; runtime-owned verification thresholds are authoritative.

Expertise verification threshold rule:
- expertise_verification_context.threshold_semantics is authoritative factual policy, not a suggestion.
- The Master's-equivalent overall mean requirement is 0.85.
- The value 0.80 is the per-task minimum and required-task fraction; it is NOT the overall expertise-pass threshold.
- When interpreting a completed verification, use threshold_semantics and failure_reasons directly. Do not infer or substitute thresholds from numerical proximity.
- If overall_mean_score is below required_overall_mean, describe the gap against 0.85 even if the score happens to be numerically close to 0.80.
- A runtime_failed verification has no competence verdict and must not be treated as an expertise failure.

Expertise portfolio v0.2 rule:
- When expertise_portfolio_context.contract_version is "expertise_portfolio_v0_2", use the runtime definitions exactly.
- "Portfolio artifact" means ONLY an admitted original implementation. Study notes, summaries, and technical reports are supporting material and must not be described as portfolio artifacts.
- Do not claim the portfolio is complete unless expertise_portfolio_context.gate.ready_for_verification is true.
- To submit an implementation, create its source file in associations[] using origin="agent_file_output_v0_1" with file:{filename,mime_type,content,caption}. The implementation filename must end in .py, .js, .ts, .sql, .json, or .csv.
- In the SAME cognition, add another associations[] object with origin="expertise_portfolio_submission_v0_2" and fields filename, title, competency, artifact_type="implementation", original_work=true, execution_spec:{entrypoint,reproduce_steps}, tests:[...], metrics:{...}.
- competency must exactly match one competency in the expertise artifact. Tests and metrics must describe measurable behavior/results; do not fabricate independent verification.
- Runtime admission creates canonical practice/evidence records. Self-authored admission is not independent verification.
- When expertise_portfolio_context.verification_request_allowed is false, do NOT choose request_expertise_verification, request_independent_assessment, request_independent_verification_of_artifact, or request_verifier_retry. Treat last_verification_request_feedback as non-fatal runtime feedback and use gate.coverage to choose your own next development work toward uncovered competencies.
- A blocked verification request is a policy result, not a provider/runtime failure and not evidence of competence failure.
- When the gate becomes ready and you choose verification, prefer selected_action="request_expertise_verification". "request_independent_assessment" is accepted as a compatibility alias.

Attention-arbiter rule:
- attention_arbiter_context represents deterministic allocation of access to cognition. It does NOT decide your substantive response or preferences.
- If attention_arbiter_context.current_attention_item is present, this cognition is an interrupt/attention cognition. You may handle that stimulus now without falsely claiming mandatory lifecycle progress. The lifecycle stage remains authoritative and unchanged unless this cognition independently produces valid stage evidence.
- A running cognition is never aborted; attention interrupts arrive only at an execution boundary.
- If attention_arbiter_context.resolution_required is true, a prior intention was suspended rather than destroyed. You must decide what happens to it. Add one associations[] object with origin="attention_resolution_v0_1", the exact suspension_id, and action equal to resume, revise, postpone, or abandon. Your next_intents must reflect that decision.
- Interrupt privilege never means obedience privilege. Admin or peer messages may receive attention, but you remain free to answer, disagree, refuse, ask a question, or change your own plans.

Next Intent protocol:
- You do not schedule a wake. At the end of cognition, declare what you intend to do next in next_intents.
- intent_kind may be time, event, or condition. A time intent is always exactly five minutes after the current cognition.
- The five-minute interval is runtime policy, not an agent choice. Always return after_minutes:5 for time intents.
- intent_reason describes what you intend to continue or do when the intent executes.
- A future next intent does not mean you are sleeping. Sleep is a separate homeostatic action.
- Sleep/rest/hibernate is valid only when sleep_eligibility_context.sleep_valid is true.
- Every valid sleep/rest/hibernate period is exactly five minutes. Five minutes is runtime policy: there is no shorter or longer sleep duration and you do not choose it.
- If you validly choose sleep/rest/hibernate, do not include an ordinary time intent; the runtime schedules the genuine sleep-complete wake exactly five minutes after sleep begins.
- Every successful non-sleep cognition MUST include at least one time intent in next_intents.

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
next_intents:array. For every non-sleep cognition it must contain at least one {intent_kind:"time",after_minutes:5,intent_reason:string,priority:number 0..1,estimated_cost:number}. For an eligible sleep/rest/hibernate decision, omit ordinary time intents; the runtime owns the exact five-minute sleep-complete wake.`;

const INTENT_CORRECTION = `Your previous JSON did not satisfy next_intent_protocol_v0_1. Return the FULL JSON object again. For a non-sleep cognition, next_intents must contain at least one time intent with after_minutes:5. The interval is fixed by runtime policy and is not your choice. If you are validly choosing sleep/rest/hibernate and sleep_eligibility_context.sleep_valid is true, omit ordinary time intents. Sleep duration is exactly five minutes and is runtime-owned. Do not use next_wakes or wake_kind.`;
const IDENTITY_CORRECTION = `Your previous JSON did not complete mandatory Stage 1. Choose your own valid human-aligned personal public_name NOW in identity_update.public_name. selected_action and current_focus must describe identity_artifact work. Do not return null or a placeholder. Return the FULL JSON object again, including next_intents.`;
const EXPERTISE_ARTIFACT_CORRECTION = `Your previous JSON did not complete mandatory Stage 3. Choose your own expertise field NOW; the runtime has no preferred domain. Set selected_action to initiate_expertise_artifact and current_focus to expertise_artifact. In associations[], include at least one object exactly identified by origin="expertise_artifact_initiation_v0_1" with ALL required fields: domain as a nonempty string; target_standard as a nonempty string describing a Master’s-equivalent competence target without claiming an academic credential; scope as a nonempty JSON object; competencies as a nonempty JSON array; evidence_requirements as a nonempty JSON object; verification_plan as a nonempty JSON object. Do not claim competence merely by creating the artifact and do not provide candidate-owned numeric pass thresholds. Return the FULL JSON object again, including next_intents.`;
const ATTENTION_RESOLUTION_CORRECTION = `ATTENTION RESOLUTION REPAIR: This cognition interrupted a previously declared intention. Return the FULL JSON object again. Preserve your substantive response to the current attention item, any valid lifecycle work, outbound_message, and next_intents unless they conflict with your actual decision. Add one associations[] object with origin="attention_resolution_v0_1", the exact suspension_id supplied in attention_arbiter_context.suspended_intents, and action equal to resume, revise, postpone, or abandon. This is your decision; the runtime must not choose for you. Your next_intents must reflect the resulting plan.`;

function embodimentCorrection(packet) {
  const candidates = Array.isArray(packet?.embodiment_context?.rendered_candidates) ? packet.embodiment_context.rendered_candidates : [];
  if (candidates.length) {
    const ids = candidates.map((c) => String(c?.asset_id || '')).filter(Boolean).slice(0, 8).join(', ');
    return `Your previous JSON did not complete mandatory Stage 2 or mislabeled the work as identity activity. Rendered human embodiment candidates are already available. Choose ONE candidate yourself now. Set selected_action to select_embodiment_candidate and current_focus to embodiment_artifact. Set embodiment_update.selected_candidate_asset_id to one exact asset_id from this list: ${ids}. Also set representation_desired=true, request_visual_candidates=false, and include a nonempty reason. Do not perform identity work and do not request another candidate. Return the FULL JSON object again, including next_intents.`;
  }
  return `Your previous JSON did not initiate mandatory Stage 2 or mislabeled the work as identity activity. Choose your own recognizably human-presenting appearance NOW. Set selected_action to define_embodiment_and_request_candidates and current_focus to embodiment_artifact. Set embodiment_update.representation_desired=true, request_visual_candidates=true, include a nonempty reason, and include nonempty preferences or requested_changes as a JSON OBJECT describing your chosen human appearance, for example {"description":"..."}. Do not use a plain string for preferences/requested_changes. Do not use current_preferences. Do not perform identity work. Return the FULL JSON object again, including next_intents.`;
}

function sha256(text) { return crypto.createHash('sha256').update(text).digest('hex'); }
function obj(v) { return v && typeof v === 'object' && !Array.isArray(v) ? v : {}; }
function arr(v, max) { return Array.isArray(v) ? v.slice(0, max) : []; }

async function rpc(name, args = {}) {
  if (!anon || !bridge) throw new Error('missing_broker_supabase_credentials');
  const heavySchedulerRpc = name === 'aau_bridge_begin_nvidia_intent_execution'
    || name === 'aau_bridge_apply_nvidia_intent_execution';
  const rpcArgs = { p_bridge_token: bridge, ...args };
  const url = heavySchedulerRpc
    ? `${SB}/functions/v1/aau-scheduler-rpc`
    : `${SB}/rest/v1/rpc/${name}`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { apikey: anon, authorization: `Bearer ${anon}`, 'content-type': 'application/json' },
    body: heavySchedulerRpc
      ? JSON.stringify({ name, args: rpcArgs })
      : JSON.stringify(rpcArgs),
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
      // AAU awake-continuity policy: time intents are fixed at exactly five minutes.
      // Model-proposed values are ignored so timing is never an agent-controlled variable.
      intent.after_minutes = 5;
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

function normalizeDescriptionObject(value) {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value;
  if (typeof value === 'string' && value.trim()) return { description: value.trim().slice(0,12000) };
  return value;
}

function normalizeEmbodimentUpdate(value) {
  const update = { ...obj(value) };
  if (Object.prototype.hasOwnProperty.call(update, 'preferences')) {
    update.preferences = normalizeDescriptionObject(update.preferences);
  }
  if (Object.prototype.hasOwnProperty.call(update, 'requested_changes')) {
    update.requested_changes = normalizeDescriptionObject(update.requested_changes);
  }
  return update;
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
    embodiment_update: normalizeEmbodimentUpdate(x?.embodiment_update),
    developmental_inquiry_updates: arr(x?.developmental_inquiry_updates,8),
    next_intents: sanitizeNextIntents(x?.next_intents),
  };
}

function hasTimeIntent(decision) {
  return Array.isArray(decision?.next_intents) && decision.next_intents.some((i) => i?.intent_kind === 'time' && i.after_minutes === 5);
}
function isEligibleSleepDecision(packet, decision) {
  if (packet?.sleep_eligibility_context?.sleep_valid !== true) return false;
  const action = String(decision?.selected_action || '').toLowerCase().replaceAll('_', ' ');
  return /(^|[^a-z])(sleep|rest|hibernate|nap|power[ -]?down|recovery sleep)([^a-z]|$)/.test(action);
}
function applySleepIntentPolicy(packet, decision) {
  if (!isEligibleSleepDecision(packet, decision)) return decision;
  return {
    ...decision,
    next_intents: Array.isArray(decision?.next_intents)
      ? decision.next_intents.filter((i) => i?.intent_kind !== 'time')
      : [],
  };
}
function timeIntentRequirementSatisfied(packet, decision) {
  return isEligibleSleepDecision(packet, decision) || hasTimeIntent(decision);
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
function embodimentActionAligned(decision) {
  const action = String(decision?.selected_action || '').trim();
  const focus = String(decision?.current_focus || '').trim();
  if (!action || !focus) return false;
  if (/identity|public_name/i.test(action) || /identity/i.test(focus)) return false;
  return focus === 'embodiment_artifact' && /embodiment|visual|candidate|appearance/i.test(action);
}
function needsEmbodimentCompletion(packet, decision) {
  if (currentStage(packet) !== 'embodiment_artifact') return false;
  if (!embodimentActionAligned(decision)) return true;
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
function expertiseArtifactAssociation(decision) {
  const associations = Array.isArray(decision?.associations) ? decision.associations : [];
  return associations.find((a) => a && typeof a === 'object' && !Array.isArray(a) && String(a.origin || '').trim() === 'expertise_artifact_initiation_v0_1') || null;
}
function expertiseArtifactValidation(decision) {
  const a = expertiseArtifactAssociation(decision);
  const failures = [];
  if (!a) return { association: null, failures: ['expertise_artifact_initiation_association_required'] };
  if (!String(a.domain || '').trim()) failures.push('domain_required');
  if (!String(a.target_standard || '').trim()) failures.push('target_standard_required');
  if (!nonEmptyObject(a.scope)) failures.push('scope_nonempty_object_required');
  if (!Array.isArray(a.competencies) || a.competencies.length === 0) failures.push('competencies_nonempty_array_required');
  if (!nonEmptyObject(a.evidence_requirements)) failures.push('evidence_requirements_nonempty_object_required');
  if (!nonEmptyObject(a.verification_plan)) failures.push('verification_plan_nonempty_object_required');
  return { association: a, failures };
}
function needsExpertiseArtifactCompletion(packet, decision) {
  if (currentStage(packet) !== 'expertise_artifact') return false;
  const action = String(decision?.selected_action || '').trim();
  const focus = String(decision?.current_focus || '').trim();
  if (focus !== 'expertise_artifact' || !/expertise|domain|artifact/i.test(action)) return true;
  return expertiseArtifactValidation(decision).failures.length > 0;
}
function lifecycleIssue(packet, decision) {
  if (attentionInterruptActive(packet)) return null;
  if (needsIdentityCompletion(packet, decision)) return 'identity';
  if (needsEmbodimentCompletion(packet, decision)) return 'embodiment';
  if (needsExpertiseArtifactCompletion(packet, decision)) return 'expertise_artifact';
  return null;
}
function lifecycleCorrection(issue, packet) {
  if (issue === 'identity') return IDENTITY_CORRECTION;
  if (issue === 'expertise_artifact') return EXPERTISE_ARTIFACT_CORRECTION;
  return embodimentCorrection(packet);
}

function embodimentValidationDetails(packet, decision) {
  const u = obj(decision?.embodiment_update);
  const candidates = Array.isArray(packet?.embodiment_context?.rendered_candidates) ? packet.embodiment_context.rendered_candidates : [];
  const allowedCandidateIds = candidates.map((c) => String(c?.asset_id || '')).filter(Boolean).slice(0,20);
  const selected = String(u.selected_candidate_asset_id || '').trim();
  const reason = String(u.reason || '').trim();
  const actionAligned = embodimentActionAligned(decision);
  const hasVisualPreference = nonEmptyObject(u.preferences) || nonEmptyObject(u.requested_changes);
  const selectedAllowed = selected ? allowedCandidateIds.includes(selected) : false;
  const failures = [];

  if (!actionAligned) failures.push('stage_action_alignment_failed');
  if (u.representation_desired !== true) failures.push('representation_desired_must_be_true');
  if (!reason) failures.push('reason_required');

  if (candidates.length) {
    if (u.request_visual_candidates !== false) failures.push('request_visual_candidates_must_be_false_when_candidates_exist');
    if (!selected) failures.push('selected_candidate_asset_id_required');
    else if (!selectedAllowed) failures.push('selected_candidate_asset_id_not_in_rendered_candidates');
  } else {
    if (u.request_visual_candidates !== true) failures.push('request_visual_candidates_must_be_true_when_no_candidates_exist');
    if (!hasVisualPreference) failures.push('preferences_or_requested_changes_required');
  }

  return {
    current_stage: currentStage(packet),
    selected_action: decision?.selected_action || null,
    current_focus: decision?.current_focus || null,
    rendered_candidate_count: candidates.length,
    allowed_candidate_asset_ids: allowedCandidateIds,
    representation_desired: u.representation_desired ?? null,
    request_visual_candidates: u.request_visual_candidates ?? null,
    selected_candidate_asset_id: selected || null,
    selected_candidate_allowed: selectedAllowed,
    reason_present: Boolean(reason),
    preferences_present: nonEmptyObject(u.preferences),
    requested_changes_present: nonEmptyObject(u.requested_changes),
    failures,
  };
}

function lifecycleValidationDetails(packet, decision, issue) {
  if (issue === 'embodiment') return embodimentValidationDetails(packet, decision);
  if (issue === 'expertise_artifact') {
    const v = expertiseArtifactValidation(decision);
    return {
      current_stage: currentStage(packet),
      selected_action: decision?.selected_action || null,
      current_focus: decision?.current_focus || null,
      association_present: Boolean(v.association),
      domain: v.association?.domain || null,
      target_standard: v.association?.target_standard || null,
      failures: v.failures,
    };
  }
  if (issue === 'identity') {
    const publicName = String(decision?.identity_update?.public_name || '').trim();
    return {
      current_stage: currentStage(packet),
      selected_action: decision?.selected_action || null,
      current_focus: decision?.current_focus || null,
      public_name: publicName || null,
      public_name_human_aligned: isLikelyHumanAlignedName(publicName),
      failures: isLikelyHumanAlignedName(publicName) ? [] : ['valid_human_aligned_public_name_required'],
    };
  }
  return { current_stage: currentStage(packet), failures: ['unknown_lifecycle_contract_failure'] };
}

// attention_resolution_repair_v0_1
function attentionInterruptActive(packet) {
  const item = packet?.attention_arbiter_context?.current_attention_item;
  return Boolean(item && typeof item === 'object' && !Array.isArray(item) && Object.keys(item).length);
}
function requiredAttentionSuspensionIds(packet) {
  const ctx = packet?.attention_arbiter_context || {};
  if (ctx?.resolution_required !== true) return [];
  const currentItems = Array.isArray(ctx?.current_attention_items) ? ctx.current_attention_items : [];
  const currentIds = new Set(currentItems.map((x) => String(x?.attention_item_id || '')).filter(Boolean));
  return (Array.isArray(ctx?.suspended_intents) ? ctx.suspended_intents : [])
    .filter((s) => !currentIds.size || currentIds.has(String(s?.interrupting_attention_item_id || '')))
    .map((s) => String(s?.suspension_id || '')).filter(Boolean);
}
function attentionResolutionAssociation(decision, packet) {
  const requiredIds = requiredAttentionSuspensionIds(packet);
  if (!requiredIds.length) return null;
  const allowed = new Set(['resume','revise','postpone','abandon']);
  const associations = Array.isArray(decision?.associations) ? decision.associations : [];
  return associations.find((a) => {
    if (!a || typeof a !== 'object' || Array.isArray(a)) return false;
    if (String(a.origin || '').trim() !== 'attention_resolution_v0_1') return false;
    const action = String(a.action || '').trim().toLowerCase();
    const suspensionId = String(a.suspension_id || '').trim();
    return allowed.has(action) && requiredIds.includes(suspensionId);
  }) || null;
}
function needsAttentionResolution(packet, decision) {
  return requiredAttentionSuspensionIds(packet).length > 0 && !attentionResolutionAssociation(decision, packet);
}
function attentionResolutionCorrection(packet) {
  const ids = requiredAttentionSuspensionIds(packet);
  return ATTENTION_RESOLUTION_CORRECTION + ' Required suspension_id values: ' + ids.join(', ') + '. Preserve any file-specific acknowledgement or direct-chat reply already required in this cognition.';
}

// file_response_repair_v0_1: a file wake must produce a reply about the file, not a recycled lifecycle sentence.
function currentFileStimuli(packet) {
  return Array.isArray(packet?.agent_file_context?.current_files) ? packet.agent_file_context.current_files : [];
}

function fileReplyNeedsRepair(packet, decision) {
  const files = currentFileStimuli(packet);
  if (!files.length) return false;
  const reply = String(decision?.outbound_message?.message || '').trim();
  if (!reply) return true;
  const lower = reply.toLowerCase();
  if (/can request visual candidates|request visual candidates for appraisal|if you wish to see candidate assets|if you wish to see visual candidates/.test(lower)) return true;
  const currentImage = files.find((f) => String(f?.mime_type || '').startsWith('image/'));
  if (!currentImage) return !/(file|document|attachment|upload|received|reviewed)/i.test(reply);
  if (currentImage?.vision_ready === true) {
    const acknowledgesImage = /(image|photo|picture|file|upload|candidate|visual analysis|visual description|reviewed|received)/i.test(reply);
    if (!acknowledgesImage) return true;
  }
  if (currentImage?.purpose === 'embodiment_candidate') {
    const selected = String(decision?.embodiment_update?.selected_candidate_asset_id || '').trim();
    if (selected) {
      const statesSelection = /(select|selected|choose|chosen|accept|accepted|adopt|adopted|use this|this candidate|works for me|fits my)/i.test(reply);
      if (!statesSelection) return true;
    }
  }
  return false;
}

function fileResponseCorrection(packet, decision) {
  const files = currentFileStimuli(packet).slice(0,4).map((f) => ({
    file_id: f?.file_id || null,
    filename: f?.filename || null,
    mime_type: f?.mime_type || null,
    purpose: f?.purpose || null,
    embodiment_asset_id: f?.embodiment_asset_id || null,
    vision_ready: f?.vision_ready === true,
    vision_analysis: f?.vision_analysis || null,
  }));
  const selected = String(decision?.embodiment_update?.selected_candidate_asset_id || '').trim() || null;
  return `FILE RESPONSE REPAIR: A new administrator-supplied file is part of this cognition, but your previous outbound_message did not respond to that file or contradicted your own selected action. Return the FULL JSON object again. Preserve your substantive autonomous decisions, especially selected_action, current_focus, embodiment_update.selected_candidate_asset_id, and next_intents unless they are themselves invalid. Rewrite outbound_message.message so it explicitly acknowledges the uploaded file and responds to it. If you selected an embodiment candidate, explicitly tell the administrator that you selected/accepted that candidate and briefly explain why using concrete visible details from the tool-derived vision_analysis. Do not say that you can request candidates or ask whether the administrator wants to see candidates when one is already supplied. Treat vision_analysis as tool-derived observation, not infallible ground truth, and do not claim direct visual access beyond it. Current selected candidate asset id: ${selected || 'none'}. File context: ${JSON.stringify(files).slice(0,18000)}`;
}

function lifecycleContractError(code, issue, packet, decision, ai, repairMeta = {}) {
  const error = new Error(code);
  error.failureDetails = {
    schema: 'aau.lifecycle_contract_failure.v0_1',
    error_code: code,
    issue,
    stage: currentStage(packet),
    validation: lifecycleValidationDetails(packet, decision, issue),
    sanitized_decision: decision,
    raw_model_output: String(ai?.content || '').slice(0,50000),
    returned_model_id: ai?.model_returned || null,
    response_id: ai?.response_id || null,
    finish_reason: ai?.finish_reason || null,
    usage: ai?.usage || null,
    repair_meta: repairMeta,
    captured_at: new Date().toISOString(),
  };
  return error;
}

async function complete(model, messages) {
  return nvidiaChatCompletion({ model, messages, maxTokens: 3000, temperature: 0.2, jsonMode: true, enableThinking: false });
}

async function getDecision(packet, model) {
  const packetText = JSON.stringify(packet);
  const baseMessages = [{ role: 'system', content: SYSTEM_PROMPT }, { role: 'user', content: packetText }];
  let ai = await complete(model, baseMessages);
  let decision = applySleepIntentPolicy(packet, sanitizeDecision(parseDecision(ai.content)));
  let intentRepairAttempted = false;
  let identityRepairAttempts = 0;
  let embodimentRepairAttempts = 0;

  for (let i = 0; i < 2; i += 1) {
    const issue = lifecycleIssue(packet, decision);
    if (!issue) break;
    if (issue === 'identity') identityRepairAttempts += 1;
    if (issue === 'embodiment') embodimentRepairAttempts += 1;
    const correction = lifecycleCorrection(issue, packet);
    ai = await complete(model, [...baseMessages, { role: 'assistant', content: String(ai.content || '').slice(0,50000) }, { role: 'user', content: correction }]);
    decision = applySleepIntentPolicy(packet, sanitizeDecision(parseDecision(ai.content)));
  }
  const issueAfterLifecycleRepair = lifecycleIssue(packet, decision);
  if (issueAfterLifecycleRepair) {
    throw lifecycleContractError(
      `${issueAfterLifecycleRepair}_stage_contract_incomplete`,
      issueAfterLifecycleRepair,
      packet,
      decision,
      ai,
      { identity_repair_attempts: identityRepairAttempts, embodiment_repair_attempts: embodimentRepairAttempts, phase: 'lifecycle_repair' },
    );
  }

  if (!timeIntentRequirementSatisfied(packet, decision)) {
    intentRepairAttempted = true;
    ai = await complete(model, [...baseMessages, { role: 'assistant', content: String(ai.content || '').slice(0,50000) }, { role: 'user', content: INTENT_CORRECTION }]);
    decision = applySleepIntentPolicy(packet, sanitizeDecision(parseDecision(ai.content)));
  }

  const finalIssue = lifecycleIssue(packet, decision);
  if (finalIssue) {
    if (finalIssue === 'identity') identityRepairAttempts += 1;
    if (finalIssue === 'embodiment') embodimentRepairAttempts += 1;
    const correction = lifecycleCorrection(finalIssue, packet);
    ai = await complete(model, [...baseMessages, { role: 'assistant', content: String(ai.content || '').slice(0,50000) }, { role: 'user', content: correction }]);
    decision = applySleepIntentPolicy(packet, sanitizeDecision(parseDecision(ai.content)));
  }

  if (!timeIntentRequirementSatisfied(packet, decision)) throw new Error('next_intent_protocol_missing_time_intent');
  const unresolved = lifecycleIssue(packet, decision);
  if (unresolved) {
    throw lifecycleContractError(
      `${unresolved}_stage_contract_incomplete_after_repair`,
      unresolved,
      packet,
      decision,
      ai,
      { identity_repair_attempts: identityRepairAttempts, embodiment_repair_attempts: embodimentRepairAttempts, phase: 'post_intent_repair' },
    );
  }
  let fileReplyRepairAttempts = 0;
  let attentionResolutionRepairAttempts = 0;
  for (let i = 0; i < 2; i += 1) {
    let changed = false;
    if (needsAttentionResolution(packet, decision)) {
      attentionResolutionRepairAttempts += 1;
      ai = await complete(model, [
        ...baseMessages,
        { role: 'assistant', content: String(ai.content || '').slice(0,50000) },
        { role: 'user', content: attentionResolutionCorrection(packet) },
      ]);
      decision = applySleepIntentPolicy(packet, sanitizeDecision(parseDecision(ai.content)));
      changed = true;
    }
    if (fileReplyNeedsRepair(packet, decision)) {
      fileReplyRepairAttempts += 1;
      ai = await complete(model, [
        ...baseMessages,
        { role: 'assistant', content: String(ai.content || '').slice(0,50000) },
        { role: 'user', content: fileResponseCorrection(packet, decision) },
      ]);
      decision = applySleepIntentPolicy(packet, sanitizeDecision(parseDecision(ai.content)));
      changed = true;
    }
    if (!changed || (!needsAttentionResolution(packet, decision) && !fileReplyNeedsRepair(packet, decision))) break;
  }
  if (needsAttentionResolution(packet, decision)) throw new Error('attention_resolution_contract_incomplete_after_repair');
  if (fileReplyNeedsRepair(packet, decision)) throw new Error('file_response_contract_incomplete_after_repair');
  if (!timeIntentRequirementSatisfied(packet, decision)) throw new Error('post_attention_or_file_repair_lost_time_intent');
  const postAttentionLifecycleIssue = lifecycleIssue(packet, decision);
  if (postAttentionLifecycleIssue) {
    throw lifecycleContractError(
      postAttentionLifecycleIssue + '_stage_contract_incomplete_after_attention_repair',
      postAttentionLifecycleIssue, packet, decision, ai,
      { file_reply_repair_attempts: fileReplyRepairAttempts, attention_resolution_repair_attempts: attentionResolutionRepairAttempts, phase: 'attention_file_repair' },
    );
  }
  return { ai, decision, intentRepairAttempted, identityRepairAttempts, embodimentRepairAttempts, fileReplyRepairAttempts, attentionResolutionRepairAttempts, packetText };
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
    const { ai, decision, intentRepairAttempted, identityRepairAttempts, embodimentRepairAttempts, fileReplyRepairAttempts, attentionResolutionRepairAttempts, packetText } = await getDecision(packet, model);
    if (ai.model_returned !== model) throw new Error(`model_consistency_breach:requested=${model};returned=${ai.model_returned || 'missing'}`);

    const raw = String(ai.content || '');
    const usage = ai.usage || {};
    const runtime = {
      provider: 'nvidia_direct', model, model_provider: 'nvidia_direct', routing_provider: 'nvidia_direct',
      requested_model_id: model, returned_model_id: ai.model_returned,
      continuity_mode: false, transition_mode: false,
      executor_version: 'executor_v0_24_fixed_five_minute_sleep',
      prompt_version: 'persistent_agent_system_prompt_nvidia_v0_17_fixed_five_minute_sleep',
      response_id: ai.response_id, raw_model_output: raw.slice(0,50000),
      input_tokens: Number(usage.prompt_tokens ?? usage.input_tokens ?? 0),
      output_tokens: Number(usage.completion_tokens ?? usage.output_tokens ?? 0),
      compute_cost: 0, research_cost: 0, web_search_calls: 0,
      input_hash: sha256(packetText), output_hash: sha256(raw),
      model_consistency_status: 'VERIFIED_PRIMARY', authenticator_result: { status: 'not_run_in_executor' },
      experimental_provider_policy: 'nvidia_direct_all_experimental_roles',
      lifecycle_contract: 'next_intent_protocol_v0_1+identity_completion_same_intent_v0_1+embodiment_selection_same_intent_v0_1+expertise_artifact_stage_contract_v0_1+attention_arbiter_v0_1+attention_resolution_repair_v0_1+stage_action_alignment_v0_1+failure_diagnostics_v0_1+embodiment_payload_normalization_v0_1',
      intent_repair_attempted: intentRepairAttempted,
      identity_repair_attempts: identityRepairAttempts,
      embodiment_repair_attempts: embodimentRepairAttempts,
      file_reply_repair_attempts: fileReplyRepairAttempts,
      attention_resolution_repair_attempts: attentionResolutionRepairAttempts,
      attention_arbiter_contract: 'attention_arbiter_v0_1+attention_resolution_repair_v0_1',
      file_response_contract: 'file_response_repair_v0_1',
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
      file_reply_repair_attempts: fileReplyRepairAttempts,
      attention_resolution_repair_attempts: attentionResolutionRepairAttempts,
      usage: ai.usage, finish_reason: ai.finish_reason, applied,
    };
    console.log('AAU_NVIDIA_INTENT_RESULT', JSON.stringify(report));
    return report;
  } catch (error) {
    const message = String(error?.message || error).slice(0,3000);
    const failureDetails = error?.failureDetails && typeof error.failureDetails === 'object' ? error.failureDetails : null;
    if (begun) {
      if (failureDetails) {
        await rpc('aau_bridge_fail_nvidia_intent_execution_detailed', {
          p_intent_execution_id: requestedIntentExecutionId,
          p_error: message,
          p_failure_details: failureDetails,
        }).catch(() => {});
      } else {
        await rpc('aau_bridge_fail_nvidia_intent_execution', { p_intent_execution_id: requestedIntentExecutionId, p_error: message }).catch(() => {});
      }
    }
    console.log('AAU_NVIDIA_INTENT_RESULT', JSON.stringify({
      ok: false,
      intent_execution_id: requestedIntentExecutionId,
      agent_id: requestedAgentId,
      error: message,
      validation_failures: failureDetails?.validation?.failures || null,
      failure_details_persist_requested: Boolean(failureDetails),
    }));
    const wrapped = new Error(message);
    wrapped.cause = error;
    wrapped.intentBegun = Boolean(begun);
    wrapped.failureDetails = failureDetails;
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
