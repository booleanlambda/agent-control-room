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
await import('./broker-bridge-render.js');
