const DEFAULT_NVIDIA_BASE_URL = 'https://integrate.api.nvidia.com/v1';
const DEFAULT_NVIDIA_MODEL = 'nvidia/nemotron-3.5-lightning-30b-a3b';
const DEFAULT_NVIDIA_TIMEOUT_MS = 60000;
const SB = String(process.env.AAU_SUPABASE_URL || 'https://mgtilfgygzymxiyixjit.supabase.co').replace(/\/$/, '');
const SB_ANON = String(process.env.AAU_SUPABASE_ANON_KEY || '').trim();
const BRIDGE_TOKEN = String(process.env.AAU_BROKER_BRIDGE_TOKEN || '').trim();

function clean(value) {
  return String(value || '').trim();
}

function trimTrailingSlash(value) {
  return value.replace(/\/+$/, '');
}

function envBool(name) {
  const raw = clean(process.env[name]).toLowerCase();
  if (!raw) return null;
  if (['1','true','yes','on'].includes(raw)) return true;
  if (['0','false','no','off'].includes(raw)) return false;
  return null;
}

function resolveTimeoutMs() {
  const raw = Number(process.env.AAU_NVIDIA_TIMEOUT_MS);
  if (!Number.isFinite(raw) || raw <= 0) return DEFAULT_NVIDIA_TIMEOUT_MS;
  return Math.max(5000, Math.min(Math.floor(raw), 180000));
}

function resolveConfig() {
  const apiKey = clean(process.env.NVIDIA_API_KEY);
  const baseUrl = trimTrailingSlash(clean(process.env.AAU_NVIDIA_BASE_URL) || DEFAULT_NVIDIA_BASE_URL);
  const configuredEndpoint = clean(process.env.AAU_NVIDIA_ENDPOINT);
  const configuredModel = clean(process.env.AAU_NVIDIA_MODEL);

  let url;
  let model = configuredModel || DEFAULT_NVIDIA_MODEL;
  let endpointKind = 'default_chat_completions';

  if (/^https?:\/\//i.test(configuredEndpoint)) {
    url = configuredEndpoint;
    endpointKind = 'absolute_url';
  } else if (configuredEndpoint && /chat\/completions/i.test(configuredEndpoint)) {
    url = `${baseUrl}/${configuredEndpoint.replace(/^\/+/, '')}`;
    endpointKind = 'relative_chat_completions';
  } else {
    url = `${baseUrl}/chat/completions`;
    if (configuredEndpoint) {
      model = configuredModel || configuredEndpoint;
      endpointKind = 'model_identifier';
    }
  }

  return { apiKey, baseUrl, url, model, endpointKind };
}

function parsePacketCandidate(content) {
  if (typeof content !== 'string' || !content.trim().startsWith('{')) return null;
  try {
    const parsed = JSON.parse(content);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

function adminChatEnvelope(messages) {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i];
    if (message?.role !== 'user') continue;
    const packet = parsePacketCandidate(message?.content);
    if (!packet) continue;
    const active = packet?.runtime_interaction_mode === 'direct_admin_conversation'
      || packet?.admin_chat_context?.active === true
      || packet?.executor_policy?.admin_chat_active === true;
    if (!active) continue;
    const current = packet?.admin_chat_context?.current_admin_message || {};
    const messageId = clean(current?.message_id);
    const adminText = clean(current?.content);
    return { active: true, messageId: messageId || null, adminText: adminText || null };
  }
  return { active: false, messageId: null, adminText: null };
}

function adminChatPacketActive(messages) {
  return adminChatEnvelope(messages).active;
}

function applyAdminChatRoleOverride(messages) {
  if (!adminChatPacketActive(messages)) return messages;
  const exception = `ACTIVE ADMIN CHAT EXCEPTION:\n- A human administrator is speaking directly TO the persistent agent in admin_chat_context.current_admin_message.\n- For this cognition, answer that administrator as the agent in outbound_message.message.\n- The phrase \"you are not an assistant answering a human\" must NOT be interpreted as forbidding conversation on this wake; it only means do not abandon the persistent agent identity or become a generic assistant.\n- Do not echo, mirror, paraphrase, invert, or convert the administrator's request into a first-person instruction. Answer its content in the agent's own voice.\n- Refusal, disagreement, or a clarification question is allowed. Silence is not.\n- Mandatory lifecycle work may continue in the same cognition but does not replace the conversational reply.`;

  return messages.map((message) => {
    if (message?.role !== 'system' || typeof message?.content !== 'string') return message;
    const content = message.content.replace(
      'You are not an assistant answering a human.',
      'You are not a generic assistant. Preserve the persistent agent identity. When admin_chat_context.active is true, a human administrator is speaking directly to you and you must answer as the agent.'
    );
    return { ...message, content: `${content}\n\n${exception}` };
  });
}

function parseDecisionContent(content) {
  const cleaned = String(content || '').trim().replace(/^```json\s*/i, '').replace(/```$/i, '').trim();
  try {
    const parsed = JSON.parse(cleaned);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

function replyTextFromDecision(content) {
  const decision = parseDecisionContent(content);
  return typeof decision?.outbound_message?.message === 'string'
    ? decision.outbound_message.message.trim()
    : '';
}

function fileOutputsFromDecision(content) {
  const decision = parseDecisionContent(content);
  const associations = Array.isArray(decision?.associations) ? decision.associations : [];
  return associations.filter((item) =>
    item && typeof item === 'object' && item.origin === 'agent_file_output_v0_1'
  );
}

function normalizedWords(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .map((x) => x.trim())
    .filter((x) => x.length > 1);
}

function adminReplyLooksLikeEcho(adminText, reply) {
  const a = [...new Set(normalizedWords(adminText))];
  const b = [...new Set(normalizedWords(reply))];
  if (a.length < 3 || b.length < 3) return false;
  const as = new Set(a), bs = new Set(b);
  const intersection = a.filter((word) => bs.has(word)).length;
  const union = new Set([...a, ...b]).size;
  const jaccard = union ? intersection / union : 0;
  const adminLead = String(adminText || '').trim().toLowerCase();
  const replyLead = String(reply || '').trim().toLowerCase();
  const imperativeMirror = /^(send|give|tell|show|describe|provide|upload|generate)\b/.test(adminLead)
    && /^(send|give|tell|show|describe|provide|upload|generate)\b/.test(replyLead);
  return jaccard >= 0.68 || (imperativeMirror && jaccard >= 0.42);
}

async function persistAdminChatReplyEarly(messages, content, modelId) {
  const envelope = adminChatEnvelope(messages);
  if (!envelope.active || !envelope.messageId || !SB_ANON || !BRIDGE_TOKEN) return;
  const reply = replyTextFromDecision(content);
  if (!reply) return;
  try {
    const response = await fetch(`${SB}/rest/v1/rpc/aau_bridge_upsert_admin_chat_reply_early`, {
      method: 'POST',
      headers: {
        apikey: SB_ANON,
        authorization: `Bearer ${SB_ANON}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        p_bridge_token: BRIDGE_TOKEN,
        p_admin_message_id: envelope.messageId,
        p_reply: reply.slice(0,12000),
        p_model_id: clean(modelId) || null,
      }),
    });
    if (!response.ok) {
      const detail = (await response.text()).slice(0,800);
      console.warn('AAU_ADMIN_CHAT_EARLY_REPLY_PERSIST_FAILED', response.status, detail);
    } else {
      const outputs = fileOutputsFromDecision(content);
      if (outputs.length) {
        const fileResponse = await fetch(`${SB}/rest/v1/rpc/aau_bridge_register_admin_file_outputs_early`, {
          method: 'POST',
          headers: {
            apikey: SB_ANON,
            authorization: `Bearer ${SB_ANON}`,
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            p_bridge_token: BRIDGE_TOKEN,
            p_admin_message_id: envelope.messageId,
            p_outputs: outputs,
          }),
        });
        if (!fileResponse.ok) {
          const detail = (await fileResponse.text()).slice(0,800);
          console.warn('AAU_ADMIN_CHAT_EARLY_FILE_PERSIST_FAILED', fileResponse.status, detail);
        }
      }
    }
  } catch (error) {
    console.warn('AAU_ADMIN_CHAT_EARLY_REPLY_PERSIST_FAILED', String(error?.message || error).slice(0,800));
  }
}

async function requestNvidia(config, requestBody, timeoutMs, userAgent) {
  let response;
  try {
    response = await fetch(config.url, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${config.apiKey}`,
        'content-type': 'application/json',
        accept: 'application/json',
        'user-agent': userAgent,
      },
      body: JSON.stringify(requestBody),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    if (error?.name === 'TimeoutError' || error?.name === 'AbortError') {
      const timeoutError = new Error(`nvidia_timeout_after_${timeoutMs}ms`);
      timeoutError.code = 'NVIDIA_TIMEOUT';
      throw timeoutError;
    }
    throw error;
  }

  const raw = await response.text();
  let body = null;
  try { body = JSON.parse(raw); } catch {}
  if (!response.ok) {
    const detail = body?.error?.message || body?.detail || body?.message || raw.slice(0, 800) || `HTTP ${response.status}`;
    const error = new Error(`nvidia_${response.status}: ${detail}`);
    error.status = response.status;
    throw error;
  }
  return body;
}

function correctionMessage(adminText) {
  return `ADMIN CHAT REPAIR: Your previous outbound_message mirrored or inverted the administrator's request instead of answering it.\n\nThe administrator's message was: ${JSON.stringify(String(adminText || '').slice(0,4000))}\n\nReturn the FULL JSON object again. In outbound_message.message, answer the administrator directly as the persistent agent in your own voice. Do not repeat, paraphrase, invert, or turn the administrator's request into an instruction to them. If they asked about your own embodiment, identity, preferences, thoughts, or work, answer from your persisted self-authored state in the supplied packet and from choices you make yourself in this cognition. You may elaborate your own self-description, but do not let the runtime choose it for you. Preserve all required lifecycle fields and include at least one valid next_intent.`;
}

export function nvidiaConfigStatus() {
  const config = resolveConfig();
  let baseHost = null;
  let endpointHost = null;
  let endpointPath = null;
  try { baseHost = new URL(config.baseUrl).host; } catch {}
  try {
    const parsed = new URL(config.url);
    endpointHost = parsed.host;
    endpointPath = parsed.pathname;
  } catch {}

  return {
    ready: Boolean(config.apiKey && config.url && config.model),
    api_key_present: Boolean(config.apiKey),
    base_host: baseHost,
    endpoint_host: endpointHost,
    endpoint_path: endpointPath,
    endpoint_kind: config.endpointKind,
    model: config.model,
    json_mode: envBool('AAU_NVIDIA_JSON_MODE'),
    enable_thinking: envBool('AAU_NVIDIA_ENABLE_THINKING'),
    timeout_ms: resolveTimeoutMs(),
    mode: 'experimental_only',
  };
}

export async function nvidiaChatCompletion({
  messages,
  model,
  maxTokens = 256,
  temperature = 0.2,
  jsonMode = null,
  enableThinking = null,
} = {}) {
  const config = resolveConfig();
  if (!config.apiKey) throw new Error('NVIDIA_API_KEY is not configured');
  if (!Array.isArray(messages) || messages.length === 0) throw new Error('messages are required');

  const resolvedJsonMode = typeof jsonMode === 'boolean' ? jsonMode : envBool('AAU_NVIDIA_JSON_MODE');
  const resolvedThinking = typeof enableThinking === 'boolean' ? enableThinking : envBool('AAU_NVIDIA_ENABLE_THINKING');
  const resolvedMessages = applyAdminChatRoleOverride(messages);
  const envelope = adminChatEnvelope(resolvedMessages);
  const resolvedModel = clean(model) || config.model;

  const requestBody = {
    model: resolvedModel,
    messages: resolvedMessages,
    max_tokens: Math.max(1, Math.min(Number(maxTokens) || 256, 4096)),
    temperature: Number.isFinite(Number(temperature)) ? Number(temperature) : 0.2,
    stream: false,
  };
  if (resolvedJsonMode === true) requestBody.response_format = { type: 'json_object' };
  if (typeof resolvedThinking === 'boolean') requestBody.chat_template_kwargs = { enable_thinking: resolvedThinking };

  const timeoutMs = resolveTimeoutMs();
  let body = await requestNvidia(config, requestBody, timeoutMs, 'AAU-NVIDIA-Experimental-Adapter/0.7-admin-chat-repair');
  let choice = body?.choices?.[0]?.message || {};
  let content = typeof choice?.content === 'string' ? choice.content : '';
  let reasoningContent = typeof choice?.reasoning_content === 'string' ? choice.reasoning_content : '';
  let repairAttempted = false;

  if (envelope.active && envelope.adminText) {
    const firstReply = replyTextFromDecision(content);
    if (firstReply && adminReplyLooksLikeEcho(envelope.adminText, firstReply)) {
      repairAttempted = true;
      const repairBody = {
        ...requestBody,
        messages: [
          ...resolvedMessages,
          { role: 'assistant', content: content.slice(0,50000) },
          { role: 'user', content: correctionMessage(envelope.adminText) },
        ],
      };
      body = await requestNvidia(config, repairBody, timeoutMs, 'AAU-NVIDIA-Experimental-Adapter/0.7-admin-chat-repair');
      choice = body?.choices?.[0]?.message || {};
      content = typeof choice?.content === 'string' ? choice.content : '';
      reasoningContent = typeof choice?.reasoning_content === 'string' ? choice.reasoning_content : '';
      const repairedReply = replyTextFromDecision(content);
      if (!repairedReply || adminReplyLooksLikeEcho(envelope.adminText, repairedReply)) {
        const error = new Error('admin_chat_echo_repair_failed');
        error.code = 'ADMIN_CHAT_ECHO_REPAIR_FAILED';
        throw error;
      }
    }
  }

  await persistAdminChatReplyEarly(resolvedMessages, content, body?.model || resolvedModel);

  return {
    provider: 'nvidia',
    model_requested: resolvedModel,
    model_returned: typeof body?.model === 'string' ? body.model : null,
    content,
    reasoning_content: reasoningContent,
    finish_reason: body?.choices?.[0]?.finish_reason || null,
    usage: body?.usage || null,
    response_id: body?.id || null,
    admin_chat_repair_attempted: repairAttempted,
  };
}

export async function probeNvidia() {
  const startedAt = Date.now();
  const result = await nvidiaChatCompletion({
    messages: [{ role: 'user', content: 'Return JSON exactly as {"status":"AAU_NVIDIA_OK"}.' }],
    maxTokens: 64,
    temperature: 0,
    jsonMode: true,
    enableThinking: false,
  });

  return {
    ok: Boolean(result.content || result.reasoning_content),
    model_requested: result.model_requested,
    model_returned: result.model_returned,
    content_preview: result.content.slice(0, 120),
    finish_reason: result.finish_reason,
    usage: result.usage,
    latency_ms: Date.now() - startedAt,
    mode: 'experimental_only',
  };
}
