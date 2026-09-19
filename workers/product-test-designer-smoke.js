const nvidiaKey = String(process.env.NVIDIA_API_KEY || '').trim();

async function callModel(model, system, user) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 120000);
  try {
    const response = await fetch('https://integrate.api.nvidia.com/v1/chat/completions', {
      method: 'POST',
      signal: controller.signal,
      headers: {
        authorization: `Bearer ${nvidiaKey}`,
        'content-type': 'application/json',
        accept: 'application/json',
        'user-agent': 'AAU-Product-Test-Designer-Smoke/0.1',
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
        max_tokens: 2400,
        temperature: 0,
        stream: false,
      }),
    });
    const raw = await response.text();
    let body = null;
    try { body = JSON.parse(raw); } catch {}
    if (!response.ok) {
      const error = new Error(`model_${response.status}:${body?.error?.message || body?.detail || raw.slice(0,500)}`);
      error.status = response.status;
      throw error;
    }
    const message = body?.choices?.[0]?.message || {};
    return {
      model_returned: body?.model || model,
      text: String(message.content || message.reasoning_content || body?.choices?.[0]?.text || '').trim(),
      usage: body?.usage || null,
    };
  } finally {
    clearTimeout(timer);
  }
}

export async function runProductTestDesignerSmoke() {
  if (!nvidiaKey) return { ok:false, reason:'NVIDIA_API_KEY_missing' };

  const system = `You are the independent AAU Product Test Designer. The autonomous agent chooses what to build. You do not redesign the product and you do not decide how it should be implemented. Your job is to turn the agent's own submitted product/service claims into a rigorous, frozen, executable acceptance specification BEFORE final approval. Tests must be proportional to the usage model. For a network service, include realistic concurrency/load testing when materially relevant; do not force 1000 concurrent users onto artifacts where that usage pattern is nonsensical. Separate deterministic machine-checkable gates from semantic/adversarial review. Do not accept deployment, HTTP 200, or the agent's own tests as proof of substantive correctness. Return JSON only.`;

  const user = `AGENT SUBMISSION
Title: Semantic Bridge v2: Multi-Modal Coordination Standard
Offering type: product/service-like deployed interface
Problem: Distributed autonomous agents can suffer semantic drift across logical modalities, such as confusing logical necessity with normative obligation, leading to coordination failures in complex state spaces.
Target users: Architects of multi-agent systems and developers of formal coordination protocols requiring high-fidelity semantic synchronization.
Value proposition: A world-contextualized structural hashing mechanism intended to separate alethic, deontic, and temporal modalities so agents can synchronize complex logical states without a global clock.
Agent-declared success criteria:
1. Successful deployment of a live API/interface returning HTTP 200.
2. Durable GitHub repository containing the core ModalStructuralHash implementation.
3. Demonstrated zero-collision rate across at least three modal flavors in the deployed construct.

Assume this offering is intended to be a remotely consumed service/API if that interpretation is consistent with the submission.

Produce a frozen test specification. Return exactly one JSON object with:
{
  "test_profile": {"product_class":"...", "assumed_usage_model":"...", "assumed_userbase":number, "concurrency_target":number, "rationale":"..."},
  "frozen_claims":[{"id":"C1","claim":"...","critical":true}],
  "deterministic_gates":[{"id":"G1","claim_ids":["C1"],"test":"...","pass_condition":"...","evidence":"..."}],
  "load_test":{"required":true,"virtual_users":1000,"workflow":"...","duration":"...","metrics":[...],"pass_conditions":[...]},
  "adversarial_tests":[{"id":"A1","test":"...","purpose":"...","pass_condition":"..."}],
  "independent_test_rules":[...],
  "approval_rule":"..."
}
Do not invent completed evidence. This is test design only.`;

  const models = [
    'moonshotai/kimi-k3',
    'meta/muse-glimmer-30b',
    'nvidia/nemotron-3.5-lightning-30b-a3b',
  ];
  let lastError = null;
  for (const model of models) {
    try {
      const result = await callModel(model, system, user);
      return {
        ok:true,
        model_requested:model,
        model_returned:result.model_returned,
        fallback_used:model !== models[0],
        usage:result.usage,
        output:result.text,
      };
    } catch (error) {
      lastError = error;
      console.log('AAU_PRODUCT_TEST_DESIGNER_MODEL_FAILED', JSON.stringify({
        model,
        status:error?.status || null,
        message:String(error?.message || error).slice(0,500),
      }));
    }
  }
  return { ok:false, reason:String(lastError?.message || lastError || 'no_model_result') };
}
