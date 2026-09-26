import { nvidiaChatCompletion } from './providers/nvidia.js';

const SB = String(process.env.AAU_SUPABASE_URL || 'https://mgtilfgygzymxiyixjit.supabase.co').replace(/\/$/, '');
const anon = String(process.env.AAU_SUPABASE_ANON_KEY || '').trim();
const bridge = String(process.env.AAU_BROKER_BRIDGE_TOKEN || '').trim();
const nvidiaKey = String(process.env.NVIDIA_API_KEY || '').trim();
const executorId = `render:product-service-architect:${process.env.RENDER_INSTANCE_ID || process.pid}`;
const pollMs = Math.max(2500, Number(process.env.AAU_PRODUCT_SERVICE_ARCHITECT_POLL_MS || 5000));
let running = false;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function jsonResponse(response) {
  const raw = await response.text();
  let body = null;
  try { body = JSON.parse(raw); } catch {}
  return { raw, body };
}

async function rpc(name, args = {}) {
  const response = await fetch(`${SB}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: {
      apikey: anon,
      authorization: `Bearer ${anon}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ p_bridge_token: bridge, ...args }),
  });
  const { raw, body } = await jsonResponse(response);
  if (!response.ok) {
    const error = new Error(`${name}:${response.status}:${body?.message || raw.slice(0,800)}`);
    error.status = response.status;
    throw error;
  }
  return body;
}

async function modelCall(model, system, user) {
  const result=await nvidiaChatCompletion({
    model,
    messages:[{role:'system',content:system},{role:'user',content:user}],
    maxTokens:4200,
    temperature:0,
    jsonMode:false,
    enableThinking:String(model).startsWith('nvidia/nemotron')?false:null,
    timeoutMs:60000,
    runtimeRole:'planner',
  });
  return {
    model:result.model_returned||model,
    text:String(result.content||result.reasoning_content||'').trim(),
    usage:result.usage||null,
    finish_reason:result.finish_reason||null,
    runtime_contract:result.runtime_contract||null,
  };
}

function parseJsonObject(text) {
  const raw = String(text || '').trim();
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('architecture_json_missing');
  return JSON.parse(raw.slice(start,end+1));
}

function validate(spec) {
  if (!spec || typeof spec !== 'object' || Array.isArray(spec)) throw new Error('architecture_object_required');
  for (const key of ['required_user_workflow','required_components','behavioral_invariants','non_prescriptive_choices']) {
    if (!Array.isArray(spec[key]) || spec[key].length < 1) throw new Error(`${key}_required`);
  }
  if (!spec.interface_contract || typeof spec.interface_contract !== 'object' || Array.isArray(spec.interface_contract)) {
    throw new Error('interface_contract_required');
  }
  if (!String(spec.architecture_principle || '').trim()) throw new Error('architecture_principle_required');

  const serialized = JSON.stringify(spec).toLowerCase();
  const forbidden = [
    'must use flask','must use fastapi','must use express','must use next.js','must use nextjs',
    'must use vercel','must use render','must use supabase',
    'file must be named','filename must be','endpoint must be /','route must be /',
    'must use python','must use javascript','must use typescript'
  ];
  if (forbidden.some((x) => serialized.includes(x))) throw new Error('architecture_overprescribes_implementation');

  return {
    ...spec,
    artifact_kind:'product_service_architecture',
    implementation_manifest_required:true,
    architecture_conformance_required_before_canonical_deployment:true,
    canonical_deployment_rule:'A canonical deployment is eligible only after the latest independent architecture-conformance result is VERIFIED_PASS.',
    architecture_version:'product_service_architecture_v0_1',
  };
}

async function design(job) {
  const system = [
    'You are the independent AAU Product/Service Architect.',
    'The autonomous agent owns the product idea, problem, target user, value proposition, and implementation choices.',
    'Translate the agent-authored product contract and frozen Product Test specification into a behavioral/system architecture that is sufficient to build and independently verify.',
    'Do NOT redesign the offering. Do NOT add unrelated features, branding, business requirements, security regimes, persistence, databases, auth, UI, or operational conventions unless required by the product contract or frozen test.',
    'Do NOT prescribe programming language, framework, cloud provider, endpoint path, filenames, module names, repository layout, or literal JSON field names unless the agent explicitly claimed them.',
    'Input and output names should normally describe semantic roles, not literal implementation field names.',
    'Preserve implementation freedom while making required product behavior, boundaries, interfaces, data flow, components, invariants, and failure behavior concrete enough for architecture conformance review.',
    'The architecture must be derived only from the supplied product submission, frozen claims, and frozen acceptance specification.',
    'Return one compact JSON object only, no markdown.'
  ].join(' ');

  const user = `AGENT PRODUCT SUBMISSION:
${JSON.stringify(job.submission)}

FROZEN PRODUCT TEST SPECIFICATION:
${JSON.stringify(job.product_test_specification)}

FROZEN CLAIM MANIFEST:
${JSON.stringify(job.product_test_claim_manifest)}

Return:
{
  "architecture_principle":"...",
  "required_user_workflow":["..."],
  "interface_contract":{
    "surface":"...",
    "primary_operation":"...",
    "semantic_inputs":[
      {"role":"...","required":true,"meaning":"..."}
    ],
    "semantic_outputs":[
      {"role":"...","required":true,"meaning":"..."}
    ],
    "literal_field_names_required":false,
    "naming_rule":"Semantic roles are required; literal field names remain an implementation choice unless explicitly claimed.",
    "success_semantics":"..."
  },
  "required_components":["..."],
  "data_flow":["..."],
  "behavioral_invariants":["..."],
  "failure_behavior":["..."],
  "documentation_requirements":["..."],
  "non_prescriptive_choices":[
    "programming language",
    "web framework",
    "cloud provider",
    "endpoint paths",
    "literal input/output field names",
    "internal module names"
  ],
  "acceptance_alignment":[
    {"claim_or_gate":"...","architecture_requirement":"..."}
  ]
}

Only include requirements materially implied by the product and frozen test. The agent will choose how to implement them.`;

  const models = ['moonshotai/kimi-k3','meta/muse-glimmer-30b','nvidia/nemotron-3.5-lightning-30b-a3b'];
  let lastError = null;
  for (const model of models) {
    try {
      const res = await modelCall(model, system, user);
      return {
        specification:validate(parseJsonObject(res.text)),
        modelRequested:model,
        modelUsed:res.model || model,
        fallbackUsed:model !== models[0],
      };
    } catch (error) {
      lastError = error;
      console.warn('AAU_PRODUCT_SERVICE_ARCHITECT_MODEL_FAILED', JSON.stringify({
        architecture_id:job.product_service_architecture_id,
        model,
        status:error?.status || null,
        message:String(error?.message || error).slice(0,800),
      }));
    }
  }
  throw lastError || new Error('product_service_architect_no_usable_model');
}

async function processOne(job) {
  try {
    const designed = await design(job);
    const completed = await rpc('aau_bridge_complete_product_service_architecture', {
      p_product_service_architecture_id:job.product_service_architecture_id,
      p_executor_id:executorId,
      p_specification:designed.specification,
      p_model_requested:designed.modelRequested,
      p_model_used:designed.modelUsed,
      p_fallback_used:designed.fallbackUsed,
    });
    console.log('AAU_PRODUCT_SERVICE_ARCHITECTURE_FROZEN', JSON.stringify({
      product_service_architecture_id:job.product_service_architecture_id,
      agent_id:job.agent_id,
      model_used:designed.modelUsed,
      fallback_used:designed.fallbackUsed,
      status:completed?.status || null,
    }));
  } catch (error) {
    console.error('AAU_PRODUCT_SERVICE_ARCHITECT_FAILED', JSON.stringify({
      product_service_architecture_id:job.product_service_architecture_id,
      agent_id:job.agent_id,
      message:String(error?.message || error).slice(0,1500),
    }));
    await rpc('aau_bridge_fail_product_service_architecture', {
      p_product_service_architecture_id:job.product_service_architecture_id,
      p_executor_id:executorId,
      p_error_code:'product_service_architect_error',
      p_error_message:String(error?.message || error),
      p_retryable:true,
    }).catch(() => {});
  }
}

async function loop() {
  while (running) {
    try {
      const rows = await rpc('aau_bridge_claim_product_service_architecture', {
        p_executor_id:executorId,
        p_lease_seconds:900,
      });
      const job = Array.isArray(rows) ? rows[0] : null;
      if (job) {
        await processOne(job);
        continue;
      }
    } catch (error) {
      console.error('AAU_PRODUCT_SERVICE_ARCHITECT_LOOP_ERROR', String(error?.message || error).slice(0,1500));
    }
    await sleep(pollMs);
  }
}

export function startProductServiceArchitectWorker() {
  const missing = [
    ['AAU_SUPABASE_ANON_KEY',anon],
    ['AAU_BROKER_BRIDGE_TOKEN',bridge],
    ['NVIDIA_API_KEY',nvidiaKey],
  ].filter(([,v]) => !v).map(([k]) => k);
  if (missing.length) return { ok:false, ready:false, missing };
  if (!running) {
    running = true;
    loop().catch((error) => console.error('AAU_PRODUCT_SERVICE_ARCHITECT_FATAL', error));
  }
  return {
    ok:true,
    ready:true,
    executor_id:executorId,
    poll_ms:pollMs,
    version:'product_service_architect_v0_1',
    primary:'moonshotai/kimi-k3',
    fallbacks:['meta/muse-glimmer-30b','nvidia/nemotron-3.5-lightning-30b-a3b'],
  };
}
