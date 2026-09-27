import test from 'node:test';
import assert from 'node:assert/strict';

import {
  assertModelRequestWithinBudget,
  resolveModelRuntimeContract,
  resolveModelTaskBudget,
} from './model-runtime-profiles.js';

test('unknown models fail closed instead of inheriting generic limits', () => {
  assert.throws(
    () => resolveModelRuntimeContract('provider/unregistered-model', 'agent'),
    (error) => error?.code === 'MODEL_RUNTIME_PROFILE_MISSING',
  );
});

test('workflow output requests are rejected rather than silently clipped', () => {
  assert.throws(
    () => resolveModelTaskBudget('openai/gpt-oss-20b', 'reviewer', {
      requested_output_tokens: 8193,
    }),
    (error) =>
      error?.code === 'MODEL_TASK_OUTPUT_BUDGET_UNSUPPORTED'
      && error?.requestedOutputTokens === 8193
      && error?.operationalOutputLimitTokens === 8192,
  );
});

test('timeouts may be capability-capped but the cap is explicit', () => {
  const budget = resolveModelTaskBudget('openai/gpt-oss-20b', 'reviewer', {
    requested_timeout_ms: 900000,
    requested_output_tokens: 3200,
  });
  assert.equal(budget.requested_timeout_ms, 900000);
  assert.equal(budget.effective_timeout_ms, 180000);
  assert.equal(budget.timeout_capped, true);
});

test('unsupported thinking fails explicitly', () => {
  assert.throws(
    () => resolveModelTaskBudget('meta/llama-3.1-70b-instruct', 'agent', {
      requested_thinking: true,
      requested_output_tokens: 1000,
    }),
    (error) => error?.code === 'MODEL_THINKING_NOT_SUPPORTED',
  );
});

test('unsupported provider JSON mode fails explicitly', () => {
  assert.throws(
    () => resolveModelTaskBudget('meta/muse-glimmer-30b', 'reviewer', {
      requested_json_mode: true,
      requested_output_tokens: 1000,
    }),
    (error) => error?.code === 'MODEL_JSON_MODE_NOT_SUPPORTED',
  );
});

test('oversized prompt fails locally before provider transport', () => {
  const budget = resolveModelTaskBudget('openai/gpt-oss-20b', 'reviewer', {
    requested_output_tokens: 1800,
  });
  assert.throws(
    () => assertModelRequestWithinBudget({
      messages: [{ role: 'user', content: 'x'.repeat(120000) }],
      contract: budget.contract,
      requestedOutputTokens: budget.effective_output_tokens,
    }),
    (error) =>
      error?.code === 'MODEL_CONTEXT_BUDGET_EXCEEDED'
      && error?.estimatedInputTokens > error?.maxInputTokens,
  );
});

test('Gemma keeps declared, observed-safe operational and task budgets separate', () => {
  const contract = resolveModelRuntimeContract('google/gemma-4-31b-it', 'agent');
  assert.equal(contract.declared_context_window_tokens, 262144);
  assert.equal(contract.operational_context_limit_tokens, 114688);
  assert.equal(contract.role_default_output_tokens, 7000);
  assert.equal(contract.role_default_timeout_ms, 900000);

  const task = resolveModelTaskBudget('google/gemma-4-31b-it', 'agent', {
    requested_output_tokens: 10000,
    requested_timeout_ms: 900000,
    requested_thinking: true,
  });
  assert.equal(task.effective_output_tokens, 10000);
  assert.equal(task.effective_timeout_ms, 900000);
  assert.equal(task.timeout_capped, false);
  assert.equal(task.thinking, true);
});
