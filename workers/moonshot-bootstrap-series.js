import { modelProviderConfigStatus, probeModelProvider } from './providers/model-provider.js';
import { runExperimentalModelWake } from './experimental-model-wake.js';

const SB = String(process.env.AAU_SUPABASE_URL || 'https://mgtilfgygzymxiyixjit.supabase.co').replace(/\/$/, '');
const anon = String(process.env.AAU_SUPABASE_ANON_KEY || '').trim();
const bridge = String(process.env.AAU_BROKER_BRIDGE_TOKEN || '').trim();

async function rpc(name, args = {}) {
  if (!anon || !bridge) throw new Error('AAU broker Supabase credentials are not configured');
  const response = await fetch(SB + '/rest/v1/rpc/' + name, {
    method: 'POST',
    headers: {
      apikey: anon,
      authorization: 'Bearer ' + anon,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ p_bridge_token: bridge, ...args }),
  });
  const text = await response.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = { raw: text.slice(0, 1200) }; }
  if (!response.ok) throw new Error(name + ':' + response.status + ':' + JSON.stringify(body).slice(0,1200));
  return body;
}

function modelFamily(modelId) {
  const id = String(modelId || '').trim();
  const slash = id.lastIndexOf('/');
  return slash >= 0 && slash < id.length - 1 ? id.slice(slash + 1) : id;
}

function modelSurname(modelId) {
  const id = String(modelId || '').toLowerCase();
  if (id.includes('kimi')) return 'Kimi';
  return 'Moonshot';
}

export async function runMoonshotBootstrapSeries() {
  const config = modelProviderConfigStatus('moonshot_direct');
  if (!config.ready) {
    throw new Error('moonshot_direct_not_ready:' + JSON.stringify({
      api_key_present:config.api_key_present,
      model:config.model,
      endpoint_host:config.endpoint_host,
      endpoint_path:config.endpoint_path,
    }));
  }

  const probe = await probeModelProvider('moonshot_direct');
  if (!probe.ok) throw new Error('moonshot_direct_probe_failed');
  const configuredModel = String(config.model || '').trim();
  const returnedModel = String(probe.model_returned || '').trim();
  const boundModel = returnedModel || configuredModel;
  if (!boundModel) throw new Error('moonshot_direct_model_missing_after_probe');

  const created = await rpc('aau_bridge_create_manual_starter_agent_v0_9', {
    p_ordinal: 50,
    p_internal_label: 'agent_fifty',
    p_model_provider: 'moonshot_direct',
    p_model_id: boundModel,
    p_model_family: modelFamily(boundModel),
    p_model_version: boundModel,
    p_model_surname: modelSurname(boundModel),
  });
  const agentId = String(created?.agent_id || '').trim();
  if (!agentId) throw new Error('moonshot_starter_agent_creation_missing_id');

  const reasons = [
    'Fresh isolated first wake from a blank starter state. Orient to your persisted state and choose your own next action.',
    'Second isolated wake. Re-read the state persisted from the first wake and choose your own next action.',
    'Third isolated wake. Continue from the state persisted across the first two wakes and choose your own next action.',
  ];

  const wakes = [];
  for (let i = 0; i < reasons.length; i += 1) {
    const result = await runExperimentalModelWake({
      agentId,
      idempotencyKey: 'moonshot-direct-bootstrap-v0.1-wake-' + String(i + 1).padStart(2, '0'),
      reason: reasons[i],
    });
    wakes.push({
      ordinal:i + 1,
      status:result?.status || null,
      wake_request_id:result?.wake_request_id || null,
      model_requested:result?.model_requested || null,
      model_returned:result?.model_returned || null,
      selected_action:result?.selected_action || null,
      stated_reason:result?.stated_reason || null,
      current_focus:result?.current_focus || null,
      identity_update:result?.identity_update || {},
      embodiment_update:result?.embodiment_update || {},
      next_wakes:result?.next_wakes || [],
      usage:result?.usage || null,
    });
  }

  return {
    ok:true,
    mode:'manual_isolated_parallel_with_silas',
    provider:'moonshot_direct',
    configured_model:configuredModel,
    probe_model_returned:returnedModel || null,
    bound_model:boundModel,
    agent_id:agentId,
    starter_created:Boolean(created?.created),
    wakes,
  };
}
