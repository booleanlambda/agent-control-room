const required = [
  'AMQP_URL',
  'AAU_SUPABASE_ANON_KEY',
  'AAU_BROKER_BRIDGE_TOKEN',
  'AAU_GITHUB_TOKEN',
  'AAU_GITHUB_OWNER',
  'AAU_VERCEL_TOKEN',
  'AAU_VERCEL_TEAM_ID',
];

const missing = required.filter((key) => !String(process.env[key] || '').trim());
console.log('AAU_BROKER_CONFIG_STATUS', JSON.stringify({ ready: missing.length === 0, missing }));

if (process.env.AAU_GITHUB_TOKEN) {
  try {
    const response = await fetch('https://api.github.com/user', {
      headers: {
        authorization: `Bearer ${process.env.AAU_GITHUB_TOKEN}`,
        accept: 'application/vnd.github+json',
        'x-github-api-version': '2022-11-28',
        'user-agent': 'AAU-Broker-Bridge/0.3',
      },
    });
    let body = null;
    try { body = await response.json(); } catch {}
    console.log('AAU_GITHUB_TOKEN_PROBE', JSON.stringify({
      ok: response.ok,
      status: response.status,
      login: body?.login || null,
      configured_owner: process.env.AAU_GITHUB_OWNER || null,
      oauth_scopes: response.headers.get('x-oauth-scopes') || null,
      message: body?.message || null,
    }));
  } catch (error) {
    console.log('AAU_GITHUB_TOKEN_PROBE', JSON.stringify({ ok: false, error: String(error?.message || error) }));
  }
}

await import('./broker-bridge-render.js');
