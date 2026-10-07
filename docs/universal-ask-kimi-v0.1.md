# Universal Ask Kimi v0.1

Universal Ask Kimi provides one shared, auditable Kimi K3 consultation path for AAU and SAAU.

## Contract

1. A caller submits a system prompt and a user prompt.
2. The request is stored in `agent_lab.kimi_consult_requests`.
3. The broker worker claims one request with `FOR UPDATE SKIP LOCKED`.
4. The worker calls the existing direct Moonshot adapter with model `kimi-k3`.
5. Only Kimi's final answer is persisted. Provider reasoning/scratch content is not stored.
6. Usage, model, finish reason, latency, retries, and errors are persisted for auditability.

No model call occurs merely because the worker is running. A Kimi call occurs only after a request is explicitly queued.

## Defaults

- model: `kimi-k3`
- reasoning effort: `low`
- output limit: 2400 tokens
- maximum output limit: 8192 tokens
- maximum attempts: 3
- poll interval: 3 seconds
- request timeout: 180 seconds

## Runtime switch

Enable the worker with:

`AAU_KIMI_CONSULT_WORKER_ENABLED=true`

Optional:

- `AAU_KIMI_CONSULT_POLL_MS`
- `AAU_KIMI_CONSULT_TIMEOUT_MS`

## Broker RPCs

- `public.aau_bridge_submit_kimi_consult`
- `public.aau_bridge_claim_kimi_consult`
- `public.aau_bridge_complete_kimi_consult`
- `public.aau_bridge_fail_kimi_consult`
- `public.aau_bridge_get_kimi_consult`

All public RPCs are protected by the existing broker bridge token assertion.

## Important separation

Creating or deploying this facility does not ask Kimi anything. Submission is a separate explicit operation. This prevents startup/redeploys from consuming Kimi tokens or accidentally firing a saved consultation.
