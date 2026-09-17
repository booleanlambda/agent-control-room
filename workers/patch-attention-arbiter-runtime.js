const GH = 'https://api.github.com';
const REPO = 'booleanlambda/agent-control-room';
const PATH = 'workers/nvidia-intent-execution.js';

function headers() {
  const token = String(process.env.AAU_GITHUB_TOKEN || '').trim();
  if (!token) throw new Error('AAU_GITHUB_TOKEN is not configured');
  return {
    authorization: `Bearer ${token}`,
    accept: 'application/vnd.github+json',
    'content-type': 'application/json',
    'x-github-api-version': '2022-11-28',
    'user-agent': 'AAU-Attention-Arbiter-Patcher/0.1',
  };
}

async function gh(url, options = {}) {
  const response = await fetch(url, { ...options, headers: { ...headers(), ...(options.headers || {}) } });
  const text = await response.text();
  let body = null;
  try { body = JSON.parse(text); } catch {}
  if (!response.ok) throw new Error(`github_${response.status}:${body?.message || text.slice(0,500)}`);
  return body;
}

function replaceOnce(source, oldText, newText, label) {
  if (!source.includes(oldText)) throw new Error(`attention_arbiter_patch_anchor_missing:${label}`);
  return source.replace(oldText, newText);
}

function patch(source) {
  if (source.includes('attention_resolution_repair_v0_1') && source.includes('attentionInterruptActive')) return source;
  let next = source;

  const nextIntentAnchor = `\nNext Intent protocol:\n`;
  const attentionPrompt = `\nAttention-arbiter rule:\n- attention_arbiter_context represents deterministic allocation of access to cognition. It does NOT decide your substantive response or preferences.\n- If attention_arbiter_context.current_attention_item is present, this cognition is an interrupt/attention cognition. You may handle that stimulus now without falsely claiming mandatory lifecycle progress. The lifecycle stage remains authoritative and unchanged unless this cognition independently produces valid stage evidence.\n- A running cognition is never aborted; attention interrupts arrive only at an execution boundary.\n- If attention_arbiter_context.resolution_required is true, a prior intention was suspended rather than destroyed. You must decide what happens to it. Add one associations[] object with origin=\"attention_resolution_v0_1\", the exact suspension_id, and action equal to resume, revise, postpone, or abandon. Your next_intents must reflect that decision.\n- Interrupt privilege never means obedience privilege. Admin or peer messages may receive attention, but you remain free to answer, disagree, refuse, ask a question, or change your own plans.\n`;
  next = replaceOnce(next, nextIntentAnchor, `${attentionPrompt}${nextIntentAnchor}`, 'system_prompt');

  const expertiseConst = `const EXPERTISE_ARTIFACT_CORRECTION = \`Your previous JSON did not complete mandatory Stage 3. Choose your own expertise field NOW; the runtime has no preferred domain. Set selected_action to initiate_expertise_artifact and current_focus to expertise_artifact. In associations[], include at least one object exactly identified by origin=\"expertise_artifact_initiation_v0_1\" with ALL required fields: domain as a nonempty string; target_standard as a nonempty string describing a Master’s-equivalent competence target without claiming an academic credential; scope as a nonempty JSON object; competencies as a nonempty JSON array; evidence_requirements as a nonempty JSON object; verification_plan as a nonempty JSON object. Do not claim competence merely by creating the artifact and do not provide candidate-owned numeric pass thresholds. Return the FULL JSON object again, including next_intents.\`;\n`;
  const attentionConst = `${expertiseConst}const ATTENTION_RESOLUTION_CORRECTION = \`ATTENTION RESOLUTION REPAIR: This cognition interrupted a previously declared intention. Return the FULL JSON object again. Preserve your substantive response to the current attention item, any valid lifecycle work, outbound_message, and next_intents unless they conflict with your actual decision. Add one associations[] object with origin=\"attention_resolution_v0_1\", the exact suspension_id supplied in attention_arbiter_context.suspended_intents, and action equal to resume, revise, postpone, or abandon. This is your decision; the runtime must not choose for you. Your next_intents must reflect the resulting plan.\`;\n`;
  next = replaceOnce(next, expertiseConst, attentionConst, 'attention_correction_constant');

  const fileAnchor = `// file_response_repair_v0_1: a file wake must produce a reply about the file, not a recycled lifecycle sentence.`;
  const helpers = `// attention_resolution_repair_v0_1\nfunction attentionInterruptActive(packet) {\n  const item = packet?.attention_arbiter_context?.current_attention_item;\n  return Boolean(item && typeof item === 'object' && !Array.isArray(item) && Object.keys(item).length);\n}\nfunction requiredAttentionSuspensionIds(packet) {\n  const ctx = packet?.attention_arbiter_context || {};\n  if (ctx?.resolution_required !== true) return [];\n  const currentItems = Array.isArray(ctx?.current_attention_items) ? ctx.current_attention_items : [];\n  const currentIds = new Set(currentItems.map((x) => String(x?.attention_item_id || '')).filter(Boolean));\n  return (Array.isArray(ctx?.suspended_intents) ? ctx.suspended_intents : [])\n    .filter((s) => !currentIds.size || currentIds.has(String(s?.interrupting_attention_item_id || '')))\n    .map((s) => String(s?.suspension_id || '')).filter(Boolean);\n}\nfunction attentionResolutionAssociation(decision, packet) {\n  const requiredIds = requiredAttentionSuspensionIds(packet);\n  if (!requiredIds.length) return null;\n  const allowed = new Set(['resume','revise','postpone','abandon']);\n  const associations = Array.isArray(decision?.associations) ? decision.associations : [];\n  return associations.find((a) => {\n    if (!a || typeof a !== 'object' || Array.isArray(a)) return false;\n    if (String(a.origin || '').trim() !== 'attention_resolution_v0_1') return false;\n    const action = String(a.action || '').trim().toLowerCase();\n    const suspensionId = String(a.suspension_id || '').trim();\n    return allowed.has(action) && requiredIds.includes(suspensionId);\n  }) || null;\n}\nfunction needsAttentionResolution(packet, decision) {\n  return requiredAttentionSuspensionIds(packet).length > 0 && !attentionResolutionAssociation(decision, packet);\n}\nfunction attentionResolutionCorrection(packet) {\n  const ids = requiredAttentionSuspensionIds(packet);\n  return `${ATTENTION_RESOLUTION_CORRECTION} Required suspension_id values: ${ids.join(', ')}. Preserve any file-specific acknowledgement or direct-chat reply already required in this cognition.`;\n}\n\n`;
  next = replaceOnce(next, fileAnchor, helpers + fileAnchor, 'attention_helpers');

  const lifecycleAnchor = `function lifecycleIssue(packet, decision) {\n  if (needsIdentityCompletion(packet, decision)) return 'identity';`;
  const lifecycleReplacement = `function lifecycleIssue(packet, decision) {\n  if (attentionInterruptActive(packet)) return null;\n  if (needsIdentityCompletion(packet, decision)) return 'identity';`;
  next = replaceOnce(next, lifecycleAnchor, lifecycleReplacement, 'lifecycle_attention_exemption');

  const blockStart = `  let fileReplyRepairAttempts = 0;\n`;
  const blockEnd = `  return { ai, decision, intentRepairAttempted, identityRepairAttempts, embodimentRepairAttempts, fileReplyRepairAttempts, packetText };`;
  const start = next.indexOf(blockStart);
  const end = next.indexOf(blockEnd);
  if (start < 0 || end < 0 || end < start) throw new Error('attention_arbiter_patch_anchor_missing:post_contract_block');
  const afterEnd = end + blockEnd.length;
  const combined = `  let fileReplyRepairAttempts = 0;\n  let attentionResolutionRepairAttempts = 0;\n  for (let i = 0; i < 2; i += 1) {\n    let changed = false;\n    if (needsAttentionResolution(packet, decision)) {\n      attentionResolutionRepairAttempts += 1;\n      ai = await complete(model, [\n        ...baseMessages,\n        { role: 'assistant', content: String(ai.content || '').slice(0,50000) },\n        { role: 'user', content: attentionResolutionCorrection(packet) },\n      ]);\n      decision = sanitizeDecision(parseDecision(ai.content));\n      changed = true;\n    }\n    if (fileReplyNeedsRepair(packet, decision)) {\n      fileReplyRepairAttempts += 1;\n      ai = await complete(model, [\n        ...baseMessages,\n        { role: 'assistant', content: String(ai.content || '').slice(0,50000) },\n        { role: 'user', content: fileResponseCorrection(packet, decision) },\n      ]);\n      decision = sanitizeDecision(parseDecision(ai.content));\n      changed = true;\n    }\n    if (!changed || (!needsAttentionResolution(packet, decision) && !fileReplyNeedsRepair(packet, decision))) break;\n  }\n  if (needsAttentionResolution(packet, decision)) throw new Error('attention_resolution_contract_incomplete_after_repair');\n  if (fileReplyNeedsRepair(packet, decision)) throw new Error('file_response_contract_incomplete_after_repair');\n  if (!hasTimeIntent(decision)) throw new Error('post_attention_or_file_repair_lost_time_intent');\n  const postAttentionLifecycleIssue = lifecycleIssue(packet, decision);\n  if (postAttentionLifecycleIssue) {\n    throw lifecycleContractError(\n      `${postAttentionLifecycleIssue}_stage_contract_incomplete_after_attention_repair`,\n      postAttentionLifecycleIssue, packet, decision, ai,\n      { file_reply_repair_attempts: fileReplyRepairAttempts, attention_resolution_repair_attempts: attentionResolutionRepairAttempts, phase: 'attention_file_repair' },\n    );\n  }\n  return { ai, decision, intentRepairAttempted, identityRepairAttempts, embodimentRepairAttempts, fileReplyRepairAttempts, attentionResolutionRepairAttempts, packetText };`;
  next = next.slice(0, start) + combined + next.slice(afterEnd);

  next = replaceOnce(
    next,
    `const { ai, decision, intentRepairAttempted, identityRepairAttempts, embodimentRepairAttempts, fileReplyRepairAttempts, packetText } = await getDecision(packet, model);`,
    `const { ai, decision, intentRepairAttempted, identityRepairAttempts, embodimentRepairAttempts, fileReplyRepairAttempts, attentionResolutionRepairAttempts, packetText } = await getDecision(packet, model);`,
    'destructure',
  );

  next = next.replace(
    `executor_version: 'executor_v0_20_nvidia_embodiment_payload_normalization',`,
    `executor_version: 'executor_v0_21_attention_arbiter',`,
  );
  next = next.replace(
    `prompt_version: 'persistent_agent_system_prompt_nvidia_v0_10_embodiment_object_schema',`,
    `prompt_version: 'persistent_agent_system_prompt_nvidia_v0_11_attention_arbiter',`,
  );
  next = next.replace(
    `lifecycle_contract: 'next_intent_protocol_v0_1+identity_completion_same_intent_v0_1+embodiment_selection_same_intent_v0_1+expertise_artifact_stage_contract_v0_1+stage_action_alignment_v0_1+failure_diagnostics_v0_1+embodiment_payload_normalization_v0_1',`,
    `lifecycle_contract: 'next_intent_protocol_v0_1+identity_completion_same_intent_v0_1+embodiment_selection_same_intent_v0_1+expertise_artifact_stage_contract_v0_1+attention_arbiter_v0_1+attention_resolution_repair_v0_1+stage_action_alignment_v0_1+failure_diagnostics_v0_1+embodiment_payload_normalization_v0_1',`,
  );
  next = next.replace(
    `      file_reply_repair_attempts: fileReplyRepairAttempts,\n      file_response_contract: 'file_response_repair_v0_1',`,
    `      file_reply_repair_attempts: fileReplyRepairAttempts,\n      attention_resolution_repair_attempts: attentionResolutionRepairAttempts,\n      attention_arbiter_contract: 'attention_arbiter_v0_1+attention_resolution_repair_v0_1',\n      file_response_contract: 'file_response_repair_v0_1',`,
  );
  next = next.replace(
    `      file_reply_repair_attempts: fileReplyRepairAttempts,\n      usage:`,
    `      file_reply_repair_attempts: fileReplyRepairAttempts,\n      attention_resolution_repair_attempts: attentionResolutionRepairAttempts,\n      usage:`,
  );

  return next;
}

export async function patchAttentionArbiterRuntime() {
  const api = `${GH}/repos/${REPO}/contents/${PATH}`;
  const file = await gh(`${api}?ref=main`);
  const source = Buffer.from(file.content || '', 'base64').toString('utf8');
  const next = patch(source);
  if (next === source) return { ok: true, changed: false, contract: 'attention_arbiter_v0_1+attention_resolution_repair_v0_1' };
  const result = await gh(api, {
    method: 'PUT',
    body: JSON.stringify({
      message: 'feat: enforce attention arbiter interrupt and intent resolution contract',
      content: Buffer.from(next, 'utf8').toString('base64'),
      sha: file.sha,
      branch: 'main',
    }),
  });
  return { ok: true, changed: true, contract: 'attention_arbiter_v0_1+attention_resolution_repair_v0_1', commit_sha: result?.commit?.sha || null };
}
