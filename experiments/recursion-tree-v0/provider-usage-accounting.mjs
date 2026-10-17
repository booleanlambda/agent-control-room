// Pure ledger rule for provider responses where semantic acceptance fails.
// A response that is truncated can still contain reported usage. Count it.
export function accountReportedUsage(before, packetUsage) {
  if(!Number.isSafeInteger(before)||before<0)throw Error('invalid_prior_tokens');
  if(packetUsage===null||packetUsage===undefined)
    return {tokens:before,added:0,known:false};
  const usage=Number(packetUsage);
  if(!Number.isSafeInteger(usage)||usage<0)
    throw Error('invalid_reported_usage');
  if(!Number.isSafeInteger(before+usage))
    throw Error('token_account_overflow');
  return {tokens:before+usage,added:usage,known:true};
}
