const nvidiaSmokeEnabled = ['1', 'true', 'yes'].includes(
  String(process.env.AAU_NVIDIA_SMOKE_TEST || '').trim().toLowerCase(),
);

if (nvidiaSmokeEnabled) {
  try {
    const { nvidiaConfigStatus, probeNvidia } = await import('./providers/nvidia.js');
    console.log('AAU_NVIDIA_CONFIG_STATUS', JSON.stringify(nvidiaConfigStatus()));
    const result = await probeNvidia();
    console.log('AAU_NVIDIA_SMOKE_PROBE', JSON.stringify(result));
  } catch (error) {
    console.log('AAU_NVIDIA_SMOKE_PROBE', JSON.stringify({
      ok: false,
      mode: 'experimental_only',
      error_name: error?.name || null,
      http_status: error?.status || null,
      message: String(error?.message || error).slice(0, 1000),
    }));
  }
}

const nvidiaWakeEnabled = ['1', 'true', 'yes'].includes(
  String(process.env.AAU_NVIDIA_WAKE_ON_START || '').trim().toLowerCase(),
);

if (nvidiaWakeEnabled) {
  try {
    const { runExperimentalNvidiaWake } = await import('./experimental-nvidia-wake.js');
    const result = await runExperimentalNvidiaWake();
    console.log('AAU_NVIDIA_AGENT_WAKE_RESULT', JSON.stringify(result));
  } catch (error) {
    console.log('AAU_NVIDIA_AGENT_WAKE_RESULT', JSON.stringify({
      status: 'failed',
      mode: 'experimental_only',
      error_name: error?.name || null,
      http_status: error?.status || null,
      message: String(error?.message || error).slice(0, 2000),
    }));
  }
}

const singleWakeConfigured = Boolean(
  String(process.env.AAU_NVIDIA_SINGLE_WAKE_REQUEST_ID || '').trim()
  && String(process.env.AAU_NVIDIA_SINGLE_WAKE_AGENT_ID || '').trim()
);

if (singleWakeConfigured) {
  const { runConfiguredNvidiaSingleWake } = await import('./nvidia-single-agent-wake.js');
  await runConfiguredNvidiaSingleWake();
}

await import('./broker-bridge-envcheck.js');
