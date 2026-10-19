// Research candidate: explicit Undici transport policy for long Kimi reasoning.
// Never disable header timeouts globally, and never retry a paid call.
export const THINKING_ON_APPLICATION_MS=720000;
export const THINKING_OFF_APPLICATION_MS=175000;
export const TRANSPORT_SLACK_MS=30000;
export function transportTimeoutPolicy(thinkingEnabled){
 const appDeadlineMs=thinkingEnabled?
  THINKING_ON_APPLICATION_MS:THINKING_OFF_APPLICATION_MS;
 // Both inner transport deadlines exceed the application's own abort deadline.
 // The application abort remains authoritative; still never allow endless waits.
 return Object.freeze({
  appDeadlineMs,
  headersTimeoutMs:appDeadlineMs+TRANSPORT_SLACK_MS,
  bodyTimeoutMs:appDeadlineMs+TRANSPORT_SLACK_MS
 });
}
export function makeScopedUndiciAgent(AgentCtor,thinkingEnabled){
 if(typeof AgentCtor!=='function')throw Error('INVALID_UNDICI_AGENT');
 const p=transportTimeoutPolicy(thinkingEnabled);
 return new AgentCtor({
  connections:1,
  headersTimeout:p.headersTimeoutMs,
  bodyTimeout:p.bodyTimeoutMs
 });
}
