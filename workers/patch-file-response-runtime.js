const GH = 'https://api.github.com';
const REPO = 'booleanlambda/agent-control-room';

function headers() {
  const token = String(process.env.AAU_GITHUB_TOKEN || '').trim();
  if (!token) throw new Error('AAU_GITHUB_TOKEN is not configured');
  return {
    authorization: `Bearer ${token}`,
    accept: 'application/vnd.github+json',
    'content-type': 'application/json',
    'x-github-api-version': '2022-11-28',
    'user-agent': 'AAU-File-Response-Patcher/0.1',
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

async function patchFile(path, transform, message) {
  const api = `${GH}/repos/${REPO}/contents/${path}`;
  const file = await gh(`${api}?ref=main`);
  const source = Buffer.from(file.content || '', 'base64').toString('utf8');
  const next = transform(source);
  if (next === source) return { path, changed: false };
  const response = await gh(api, {
    method: 'PUT',
    body: JSON.stringify({ message, content: Buffer.from(next,'utf8').toString('base64'), sha: file.sha, branch: 'main' }),
  });
  return { path, changed: true, commit_sha: response?.commit?.sha || null };
}

function patchNvidiaIntentWorker(source) {
  if (source.includes('file_response_repair_v0_1')) return source;
  let next = source;

  const lifecycleAnchor = 'function lifecycleContractError(code, issue, packet, decision, ai, repairMeta = {}) {';
  if (!next.includes(lifecycleAnchor)) throw new Error('file_reply_lifecycle_anchor_missing');
  const helpers = `// file_response_repair_v0_1: a file wake must produce a reply about the file, not a recycled lifecycle sentence.\nfunction currentFileStimuli(packet) {\n  return Array.isArray(packet?.agent_file_context?.current_files) ? packet.agent_file_context.current_files : [];\n}\n\nfunction fileReplyNeedsRepair(packet, decision) {\n  const files = currentFileStimuli(packet);\n  if (!files.length) return false;\n  const reply = String(decision?.outbound_message?.message || '').trim();\n  if (!reply) return true;\n  const lower = reply.toLowerCase();\n  if (/can request visual candidates|request visual candidates for appraisal|if you wish to see candidate assets|if you wish to see visual candidates/.test(lower)) return true;\n  const currentImage = files.find((f) => String(f?.mime_type || '').startsWith('image/'));\n  if (!currentImage) return !/(file|document|attachment|upload|received|reviewed)/i.test(reply);\n  if (currentImage?.vision_ready === true) {\n    const acknowledgesImage = /(image|photo|picture|file|upload|candidate|visual analysis|visual description|reviewed|received)/i.test(reply);\n    if (!acknowledgesImage) return true;\n  }\n  if (currentImage?.purpose === 'embodiment_candidate') {\n    const selected = String(decision?.embodiment_update?.selected_candidate_asset_id || '').trim();\n    if (selected) {\n      const statesSelection = /(select|selected|choose|chosen|accept|accepted|adopt|adopted|use this|this candidate|works for me|fits my)/i.test(reply);\n      if (!statesSelection) return true;\n    }\n  }\n  return false;\n}\n\nfunction fileResponseCorrection(packet, decision) {\n  const files = currentFileStimuli(packet).slice(0,4).map((f) => ({\n    file_id: f?.file_id || null,\n    filename: f?.filename || null,\n    mime_type: f?.mime_type || null,\n    purpose: f?.purpose || null,\n    embodiment_asset_id: f?.embodiment_asset_id || null,\n    vision_ready: f?.vision_ready === true,\n    vision_analysis: f?.vision_analysis || null,\n  }));\n  const selected = String(decision?.embodiment_update?.selected_candidate_asset_id || '').trim() || null;\n  return \`FILE RESPONSE REPAIR: A new administrator-supplied file is part of this cognition, but your previous outbound_message did not respond to that file or contradicted your own selected action. Return the FULL JSON object again. Preserve your substantive autonomous decisions, especially selected_action, current_focus, embodiment_update.selected_candidate_asset_id, and next_intents unless they are themselves invalid. Rewrite outbound_message.message so it explicitly acknowledges the uploaded file and responds to it. If you selected an embodiment candidate, explicitly tell the administrator that you selected/accepted that candidate and briefly explain why using concrete visible details from the tool-derived vision_analysis. Do not say that you can request candidates or ask whether the administrator wants to see candidates when one is already supplied. Treat vision_analysis as tool-derived observation, not infallible ground truth, and do not claim direct visual access beyond it. Current selected candidate asset id: \${selected || 'none'}. File context: \${JSON.stringify(files).slice(0,18000)}\`;
}\n\n`;
  next = next.replace(lifecycleAnchor, helpers + lifecycleAnchor);

  const returnAnchor = '  return { ai, decision, intentRepairAttempted, identityRepairAttempts, embodimentRepairAttempts, packetText };';
  if (!next.includes(returnAnchor)) throw new Error('file_reply_return_anchor_missing');
  const repair = `  let fileReplyRepairAttempts = 0;\n  if (fileReplyNeedsRepair(packet, decision)) {\n    fileReplyRepairAttempts += 1;\n    ai = await complete(model, [\n      ...baseMessages,\n      { role: 'assistant', content: String(ai.content || '').slice(0,50000) },\n      { role: 'user', content: fileResponseCorrection(packet, decision) },\n    ]);\n    decision = sanitizeDecision(parseDecision(ai.content));\n  }\n  if (fileReplyNeedsRepair(packet, decision)) throw new Error('file_response_contract_incomplete_after_repair');\n  if (!hasTimeIntent(decision)) throw new Error('file_response_repair_lost_time_intent');\n  const fileRepairLifecycleIssue = lifecycleIssue(packet, decision);\n  if (fileRepairLifecycleIssue) {\n    throw lifecycleContractError(\n      \`\${fileRepairLifecycleIssue}_stage_contract_incomplete_after_file_response_repair\`,\n      fileRepairLifecycleIssue, packet, decision, ai,\n      { file_reply_repair_attempts: fileReplyRepairAttempts, phase: 'file_response_repair' },\n    );\n  }\n  return { ai, decision, intentRepairAttempted, identityRepairAttempts, embodimentRepairAttempts, fileReplyRepairAttempts, packetText };`;
  next = next.replace(returnAnchor, repair);

  const destructureOld = 'const { ai, decision, intentRepairAttempted, identityRepairAttempts, embodimentRepairAttempts, packetText } = await getDecision(packet, model);';
  const destructureNew = 'const { ai, decision, intentRepairAttempted, identityRepairAttempts, embodimentRepairAttempts, fileReplyRepairAttempts, packetText } = await getDecision(packet, model);';
  if (!next.includes(destructureOld)) throw new Error('file_reply_destructure_anchor_missing');
  next = next.replace(destructureOld, destructureNew);

  next = next.replace(
    '      embodiment_repair_attempts: embodimentRepairAttempts,\n      latency_ms:',
    "      embodiment_repair_attempts: embodimentRepairAttempts,\n      file_reply_repair_attempts: fileReplyRepairAttempts,\n      file_response_contract: 'file_response_repair_v0_1',\n      latency_ms:"
  );
  next = next.replace(
    '      embodiment_repair_attempts: embodimentRepairAttempts,\n      usage:',
    '      embodiment_repair_attempts: embodimentRepairAttempts,\n      file_reply_repair_attempts: fileReplyRepairAttempts,\n      usage:'
  );

  return next;
}

export async function patchFileResponseRuntime() {
  const worker = await patchFile(
    'workers/nvidia-intent-execution.js',
    patchNvidiaIntentWorker,
    'fix: enforce file-specific agent replies after lifecycle repair',
  );
  return { ok: true, contract: 'file_response_repair_v0_1', results: [worker] };
}
