const isEnabled = (name) => ['1', 'true', 'yes', 'on'].includes(
  String(process.env[name] || '').trim().toLowerCase(),
);

const nvidiaSmokeEnabled = isEnabled('AAU_NVIDIA_SMOKE_TEST');

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

const fluxSmokeEnabled = isEnabled('AAU_NVIDIA_FLUX_SMOKE_TEST');

if (fluxSmokeEnabled) {
  try {
    const { probeNvidiaFlux2 } = await import('./flux-smoke-probe.js');
    const result = await probeNvidiaFlux2();
    console.log('AAU_NVIDIA_FLUX_SMOKE_PROBE', JSON.stringify(result));
  } catch (error) {
    console.log('AAU_NVIDIA_FLUX_SMOKE_PROBE', JSON.stringify({
      ok: false,
      model: 'black-forest-labs/flux.2-klein-4b',
      error_name: error?.name || null,
      http_status: error?.status || null,
      error_message: String(error?.message || error).slice(0, 800),
    }));
  }
}

if (isEnabled('AAU_EMBODIMENT_RENDERER_ENABLED')) {
  try {
    const { startEmbodimentRenderWorker } = await import('./embodiment-render-worker.js');
    const result = startEmbodimentRenderWorker();
    console.log('AAU_EMBODIMENT_RENDERER_STARTED', JSON.stringify(result));
  } catch (error) {
    console.error('AAU_EMBODIMENT_RENDERER_START_FAILED', JSON.stringify({
      error_name: error?.name || null,
      message: String(error?.message || error).slice(0, 1200),
    }));
  }
}

const nvidiaWakeEnabled = isEnabled('AAU_NVIDIA_WAKE_ON_START');

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

// Legacy one-shot execution now requires an explicit gate. Stale request IDs alone
// must never wake an agent during a normal broker deployment.
const singleWakeConfigured = isEnabled('AAU_NVIDIA_SINGLE_WAKE_ON_START') && Boolean(
  String(process.env.AAU_NVIDIA_SINGLE_WAKE_REQUEST_ID || '').trim()
  && String(process.env.AAU_NVIDIA_SINGLE_WAKE_AGENT_ID || '').trim()
);

if (singleWakeConfigured) {
  const { runConfiguredNvidiaSingleWake } = await import('./nvidia-single-agent-wake.js');
  await runConfiguredNvidiaSingleWake();
}

if (isEnabled('AAU_AUTONOMOUS_LIFECYCLE_ENABLED')) {
  try {
    const { startNvidiaAutonomousLifecycle } = await import('./nvidia-autonomous-lifecycle.js');
    const result = await startNvidiaAutonomousLifecycle();
    console.log('AAU_AUTONOMOUS_LIFECYCLE_STARTED', JSON.stringify(result));
  } catch (error) {
    console.error('AAU_AUTONOMOUS_LIFECYCLE_START_FAILED', JSON.stringify({
      error_name: error?.name || null,
      message: String(error?.message || error).slice(0, 2000),
    }));
  }
}

await import('./broker-bridge-envcheck.js');
