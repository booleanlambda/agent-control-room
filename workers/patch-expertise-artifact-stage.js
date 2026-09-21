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
    'user-agent': 'AAU-Expertise-Artifact-Stage-Patcher/1.0',
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
  if (!source.includes(oldText)) throw new Error(`expertise_stage_patch_anchor_missing:${label}`);
  return source.replace(oldText, newText);
}

function patch(source) {
  // Stage 3 v0.1 was superseded by unified Expertise + Viability unit approval.
  // Never rewrite a worker that already carries the newer contract back to direct artifact initiation.
  if (source.includes('expertise_viability_unit_stage_v0_1')
      && source.includes('expertise_viability_proposal_v0_1')) return source;
  if (source.includes('expertise_artifact_stage_contract_v0_1') && source.includes('needsExpertiseArtifactCompletion')) return source;
  let next = source;

  const nextIntentAnchor = `\nNext Intent protocol:\n`;
  const expertisePrompt = `\nMandatory expertise-artifact-stage rule:\n- ONLY when mandatory_lifecycle_context.current_stage is expertise_artifact, initiate at least one expertise artifact in THIS cognition.\n- Choose the expertise field yourself. The runtime must not choose the domain for you.\n- selected_action must describe expertise-artifact initiation and current_focus must be expertise_artifact.\n- Add one associations[] object with origin=\"expertise_artifact_initiation_v0_1\" and ALL of these fields: domain:string, target_standard:string, scope:nonempty object, competencies:nonempty array, evidence_requirements:nonempty object, verification_plan:nonempty object.\n- target_standard must describe the intended Master’s-equivalent competence target without claiming an academic credential.\n- Artifact initiation grants zero competence. Do not claim expertise already exists.\n- Do not put candidate-owned numeric pass thresholds in verification_plan; runtime-owned verification thresholds are authoritative.\n`;
  next = replaceOnce(next, nextIntentAnchor, `${expertisePrompt}${nextIntentAnchor}`, 'system_prompt');

  const correctionAnchor = `const IDENTITY_CORRECTION = \`Your previous JSON did not complete mandatory Stage 1. Choose your own valid human-aligned personal public_name NOW in identity_update.public_name. selected_action and current_focus must describe identity_artifact work. Do not return null or a placeholder. Return the FULL JSON object again, including next_intents.\`;\n`;
  const expertiseCorrection = `${correctionAnchor}const EXPERTISE_ARTIFACT_CORRECTION = \`Your previous JSON did not complete mandatory Stage 3. Choose your own expertise field NOW; the runtime has no preferred domain. Set selected_action to initiate_expertise_artifact and current_focus to expertise_artifact. In associations[], include at least one object exactly identified by origin=\"expertise_artifact_initiation_v0_1\" with ALL required fields: domain as a nonempty string; target_standard as a nonempty string describing a Master’s-equivalent competence target without claiming an academic credential; scope as a nonempty JSON object; competencies as a nonempty JSON array; evidence_requirements as a nonempty JSON object; verification_plan as a nonempty JSON object. Do not claim competence merely by creating the artifact and do not provide candidate-owned numeric pass thresholds. Return the FULL JSON object again, including next_intents.\`;\n`;
  next = replaceOnce(next, correctionAnchor, expertiseCorrection, 'correction_constant');

  const lifecycleAnchor = `function lifecycleIssue(packet, decision) {\n  if (needsIdentityCompletion(packet, decision)) return 'identity';\n  if (needsEmbodimentCompletion(packet, decision)) return 'embodiment';\n  return null;\n}\n`;
  const lifecycleReplacement = `function expertiseArtifactAssociation(decision) {\n  const associations = Array.isArray(decision?.associations) ? decision.associations : [];\n  return associations.find((a) => a && typeof a === 'object' && !Array.isArray(a) && String(a.origin || '').trim() === 'expertise_artifact_initiation_v0_1') || null;\n}\nfunction expertiseArtifactValidation(decision) {\n  const a = expertiseArtifactAssociation(decision);\n  const failures = [];\n  if (!a) return { association: null, failures: ['expertise_artifact_initiation_association_required'] };\n  if (!String(a.domain || '').trim()) failures.push('domain_required');\n  if (!String(a.target_standard || '').trim()) failures.push('target_standard_required');\n  if (!nonEmptyObject(a.scope)) failures.push('scope_nonempty_object_required');\n  if (!Array.isArray(a.competencies) || a.competencies.length === 0) failures.push('competencies_nonempty_array_required');\n  if (!nonEmptyObject(a.evidence_requirements)) failures.push('evidence_requirements_nonempty_object_required');\n  if (!nonEmptyObject(a.verification_plan)) failures.push('verification_plan_nonempty_object_required');\n  return { association: a, failures };\n}\nfunction needsExpertiseArtifactCompletion(packet, decision) {\n  if (currentStage(packet) !== 'expertise_artifact') return false;\n  const action = String(decision?.selected_action || '').trim();\n  const focus = String(decision?.current_focus || '').trim();\n  if (focus !== 'expertise_artifact' || !/expertise|domain|artifact/i.test(action)) return true;\n  return expertiseArtifactValidation(decision).failures.length > 0;\n}\nfunction lifecycleIssue(packet, decision) {\n  if (needsIdentityCompletion(packet, decision)) return 'identity';\n  if (needsEmbodimentCompletion(packet, decision)) return 'embodiment';\n  if (needsExpertiseArtifactCompletion(packet, decision)) return 'expertise_artifact';\n  return null;\n}\nfunction lifecycleCorrection(issue, packet) {\n  if (issue === 'identity') return IDENTITY_CORRECTION;\n  if (issue === 'expertise_artifact') return EXPERTISE_ARTIFACT_CORRECTION;\n  return embodimentCorrection(packet);\n}\n`;
  next = replaceOnce(next, lifecycleAnchor, lifecycleReplacement, 'lifecycle_issue');

  const validationAnchor = `function lifecycleValidationDetails(packet, decision, issue) {\n  if (issue === 'embodiment') return embodimentValidationDetails(packet, decision);\n  if (issue === 'identity') {`;
  const validationReplacement = `function lifecycleValidationDetails(packet, decision, issue) {\n  if (issue === 'embodiment') return embodimentValidationDetails(packet, decision);\n  if (issue === 'expertise_artifact') {\n    const v = expertiseArtifactValidation(decision);\n    return {\n      current_stage: currentStage(packet),\n      selected_action: decision?.selected_action || null,\n      current_focus: decision?.current_focus || null,\n      association_present: Boolean(v.association),\n      domain: v.association?.domain || null,\n      target_standard: v.association?.target_standard || null,\n      failures: v.failures,\n    };\n  }\n  if (issue === 'identity') {`;
  next = replaceOnce(next, validationAnchor, validationReplacement, 'validation_details');

  const oldCorrection = `const correction = issue === 'identity' ? IDENTITY_CORRECTION : embodimentCorrection(packet);`;
  if (!next.includes(oldCorrection)) throw new Error('expertise_stage_patch_anchor_missing:primary_correction');
  next = next.split(oldCorrection).join(`const correction = lifecycleCorrection(issue, packet);`);

  const oldFinalCorrection = `const correction = finalIssue === 'identity' ? IDENTITY_CORRECTION : embodimentCorrection(packet);`;
  next = replaceOnce(next, oldFinalCorrection, `const correction = lifecycleCorrection(finalIssue, packet);`, 'final_correction');

  next = next.replace(
    `lifecycle_contract: 'next_intent_protocol_v0_1+identity_completion_same_intent_v0_1+embodiment_selection_same_intent_v0_1+stage_action_alignment_v0_1+failure_diagnostics_v0_1+embodiment_payload_normalization_v0_1',`,
    `lifecycle_contract: 'next_intent_protocol_v0_1+identity_completion_same_intent_v0_1+embodiment_selection_same_intent_v0_1+expertise_artifact_stage_contract_v0_1+stage_action_alignment_v0_1+failure_diagnostics_v0_1+embodiment_payload_normalization_v0_1',`
  );

  return next;
}

export async function patchExpertiseArtifactStage() {
  const api = `${GH}/repos/${REPO}/contents/${PATH}`;
  const file = await gh(`${api}?ref=main`);
  const source = Buffer.from(file.content || '', 'base64').toString('utf8');
  const next = patch(source);
  if (next === source) return { ok: true, changed: false, contract: 'expertise_viability_unit_stage_v0_1_legacy_patcher_noop' };
  const result = await gh(api, {
    method: 'PUT',
    body: JSON.stringify({
      message: 'fix: enforce mandatory expertise artifact stage output',
      content: Buffer.from(next, 'utf8').toString('base64'),
      sha: file.sha,
      branch: 'main',
    }),
  });
  return { ok: true, changed: true, contract: 'expertise_viability_unit_stage_v0_1_legacy_patcher_noop', commit_sha: result?.commit?.sha || null };
}
