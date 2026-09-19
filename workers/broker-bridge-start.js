const isEnabled = (name) => ['1', 'true', 'yes', 'on'].includes(
  String(process.env[name] || '').trim().toLowerCase(),
);

if (isEnabled('AAU_EXPERTISE_NVIDIA_MIGRATION')) {
  try {
    const { migrateExpertiseVerificationToNvidia } = await import('./migrate-expertise-nvidia.js');
    const result = await migrateExpertiseVerificationToNvidia();
    console.log('AAU_EXPERTISE_NVIDIA_MIGRATION_RESULT', JSON.stringify(result));
  } catch (error) {
    console.error('AAU_EXPERTISE_NVIDIA_MIGRATION_FAILED', JSON.stringify({ error_name: error?.name || null, message: String(error?.message || error).slice(0, 2000) }));
  }
}

// one_shot_expertise_runtime_repair_v0_1
if (true || isEnabled('AAU_EXPERTISE_RUNTIME_PATCH')) {
  try {
    const { patchExpertiseVerifierRuntime } = await import('./patch-expertise-verifier-runtime.js');
    const result = await patchExpertiseVerifierRuntime();
    console.log('AAU_EXPERTISE_RUNTIME_PATCH_RESULT', JSON.stringify(result));
  } catch (error) {
    console.error('AAU_EXPERTISE_RUNTIME_PATCH_FAILED', JSON.stringify({ error_name: error?.name || null, message: String(error?.message || error).slice(0, 2000) }));
  }
}

// one_shot_file_response_runtime_repair_v0_1
if (true || isEnabled('AAU_FILE_RESPONSE_RUNTIME_PATCH')) {
  try {
    const { patchFileResponseRuntime } = await import('./patch-file-response-runtime.js');
    const result = await patchFileResponseRuntime();
    console.log('AAU_FILE_RESPONSE_RUNTIME_PATCH_RESULT', JSON.stringify(result));
  } catch (error) {
    console.error('AAU_FILE_RESPONSE_RUNTIME_PATCH_FAILED', JSON.stringify({ error_name: error?.name || null, message: String(error?.message || error).slice(0, 2000) }));
  }
}

// one_shot_control_room_intent_visibility_v0_1
if (true || isEnabled('AAU_CONTROL_ROOM_INTENT_VISIBILITY_PATCH')) {
  try {
    const { patchControlRoomIntentVisibility } = await import('./patch-control-room-intents.js');
    const result = await patchControlRoomIntentVisibility();
    console.log('AAU_CONTROL_ROOM_INTENT_VISIBILITY_PATCH_RESULT', JSON.stringify(result));
  } catch (error) {
    console.error('AAU_CONTROL_ROOM_INTENT_VISIBILITY_PATCH_FAILED', JSON.stringify({ error_name: error?.name || null, message: String(error?.message || error).slice(0, 2000) }));
  }
}

const nvidiaSmokeEnabled = isEnabled('AAU_NVIDIA_SMOKE_TEST');
if (nvidiaSmokeEnabled) {
  try {
    const { nvidiaConfigStatus, probeNvidia } = await import('./providers/nvidia.js');
    console.log('AAU_NVIDIA_CONFIG_STATUS', JSON.stringify(nvidiaConfigStatus()));
    const result = await probeNvidia();
    console.log('AAU_NVIDIA_SMOKE_PROBE', JSON.stringify(result));
  } catch (error) {
    console.log('AAU_NVIDIA_SMOKE_PROBE', JSON.stringify({ ok: false, mode: 'experimental_only', error_name: error?.name || null, http_status: error?.status || null, message: String(error?.message || error).slice(0, 1000) }));
  }
}

if (isEnabled('AAU_NVIDIA_EXPERTISE_AUTH_SMOKE_TEST')) {
  try {
    const { probeNvidiaExpertiseAuthenticator } = await import('./nvidia-expertise-auth-probe.js');
    const result = await probeNvidiaExpertiseAuthenticator();
    console.log('AAU_NVIDIA_EXPERTISE_AUTH_SMOKE_PROBE', JSON.stringify(result));
  } catch (error) {
    console.log('AAU_NVIDIA_EXPERTISE_AUTH_SMOKE_PROBE', JSON.stringify({ ok: false, provider: 'nvidia_direct', model_requested: 'z-ai/glm-5.3', error_name: error?.name || null, http_status: error?.status || null, message: String(error?.message || error).slice(0, 1200) }));
  }
}

const fluxSmokeEnabled = isEnabled('AAU_NVIDIA_FLUX_SMOKE_TEST');
if (fluxSmokeEnabled) {
  try {
    const { probeNvidiaFlux2 } = await import('./flux-smoke-probe.js');
    const result = await probeNvidiaFlux2();
    console.log('AAU_NVIDIA_FLUX_SMOKE_PROBE', JSON.stringify(result));
  } catch (error) {
    console.log('AAU_NVIDIA_FLUX_SMOKE_PROBE', JSON.stringify({ ok: false, model: 'black-forest-labs/flux.2-klein-4b', error_name: error?.name || null, http_status: error?.status || null, error_message: String(error?.message || error).slice(0, 800) }));
  }
}


if (isEnabled('AAU_PRODUCT_TEST_EXECUTOR_ENABLED')) {
  try {
    const { startProductTestExecutorWorker } = await import('./product-test-executor-worker.js');
    const result = startProductTestExecutorWorker();
    console.log('AAU_PRODUCT_TEST_EXECUTOR_STARTED', JSON.stringify(result));
  } catch (error) {
    console.error('AAU_PRODUCT_TEST_EXECUTOR_START_FAILED', JSON.stringify({ error_name: error?.name || null, message: String(error?.message || error).slice(0, 1600) }));
  }
}

if (isEnabled('AAU_PRODUCT_TEST_DESIGNER_ENABLED')) {
  try {
    const { startProductTestDesignerWorker } = await import('./product-test-designer-worker.js');
    const result = startProductTestDesignerWorker();
    console.log('AAU_PRODUCT_TEST_DESIGNER_STARTED', JSON.stringify(result));
  } catch (error) {
    console.error('AAU_PRODUCT_TEST_DESIGNER_START_FAILED', JSON.stringify({ error_name: error?.name || null, message: String(error?.message || error).slice(0, 1600) }));
  }
}

if (isEnabled('AAU_PRODUCT_ARCH_CONFORMANCE_ENABLED')) {
  try {
    const { startProductArchitectureConformanceWorker } = await import('./product-architecture-conformance-worker.js');
    const result = startProductArchitectureConformanceWorker();
    console.log('AAU_PRODUCT_ARCH_CONFORMANCE_STARTED', JSON.stringify(result));
  } catch (error) {
    console.error('AAU_PRODUCT_ARCH_CONFORMANCE_START_FAILED', JSON.stringify({ error_name: error?.name || null, message: String(error?.message || error).slice(0, 1600) }));
  }
}

if (isEnabled('AAU_EXPERTISE_VERIFIER_ENABLED')) {
  try {
    const { startExpertiseVerificationWorker } = await import('./expertise-verification-worker.js');
    const result = startExpertiseVerificationWorker();
    console.log('AAU_EXPERTISE_VERIFIER_STARTED', JSON.stringify(result));
  } catch (error) {
    console.error('AAU_EXPERTISE_VERIFIER_START_FAILED', JSON.stringify({ error_name: error?.name || null, message: String(error?.message || error).slice(0, 1600) }));
  }
}

if (isEnabled('AAU_EMBODIMENT_RENDERER_ENABLED')) {
  try {
    const { startEmbodimentRenderWorker } = await import('./embodiment-render-worker.js');
    const result = startEmbodimentRenderWorker();
    console.log('AAU_EMBODIMENT_RENDERER_STARTED', JSON.stringify(result));
  } catch (error) {
    console.error('AAU_EMBODIMENT_RENDERER_START_FAILED', JSON.stringify({ error_name: error?.name || null, message: String(error?.message || error).slice(0, 1200) }));
  }
}

if (isEnabled('AAU_AGENT_FILE_VISION_ENABLED')) {
  try {
    const { startAgentFileVisionWorker } = await import('./agent-file-vision-worker.js');
    const result = startAgentFileVisionWorker();
    console.log('AAU_AGENT_FILE_VISION_STARTED', JSON.stringify(result));
  } catch (error) {
    console.error('AAU_AGENT_FILE_VISION_START_FAILED', JSON.stringify({ error_name: error?.name || null, message: String(error?.message || error).slice(0, 1600) }));
  }
}

const nvidiaWakeEnabled = isEnabled('AAU_NVIDIA_WAKE_ON_START');
if (nvidiaWakeEnabled) {
  try {
    const { runExperimentalNvidiaWake } = await import('./experimental-nvidia-wake.js');
    const result = await runExperimentalNvidiaWake();
    console.log('AAU_NVIDIA_AGENT_WAKE_RESULT', JSON.stringify(result));
  } catch (error) {
    console.log('AAU_NVIDIA_AGENT_WAKE_RESULT', JSON.stringify({ status: 'failed', mode: 'experimental_only', error_name: error?.name || null, http_status: error?.status || null, message: String(error?.message || error).slice(0, 2000) }));
  }
}

const singleWakeConfigured = isEnabled('AAU_NVIDIA_SINGLE_WAKE_ON_START') && Boolean(
  String(process.env.AAU_NVIDIA_SINGLE_WAKE_REQUEST_ID || '').trim() && String(process.env.AAU_NVIDIA_SINGLE_WAKE_AGENT_ID || '').trim()
);
if (singleWakeConfigured) {
  const { runConfiguredNvidiaSingleWake } = await import('./nvidia-single-agent-wake.js');
  await runConfiguredNvidiaSingleWake();
}

const manualWakeConfigured = isEnabled('AAU_NVIDIA_MANUAL_WAKE_ON_START') && Boolean(
  String(process.env.AAU_NVIDIA_MANUAL_WAKE_REQUEST_ID || '').trim() && String(process.env.AAU_NVIDIA_MANUAL_WAKE_AGENT_ID || '').trim()
);
if (manualWakeConfigured) {
  try {
    const { runConfiguredNvidiaManualWake } = await import('./nvidia-manual-agent-wake.js');
    const result = await runConfiguredNvidiaManualWake();
    console.log('AAU_NVIDIA_MANUAL_WAKE_STARTUP_RESULT', JSON.stringify(result));
  } catch (error) {
    console.error('AAU_NVIDIA_MANUAL_WAKE_STARTUP_FAILED', JSON.stringify({ error_name: error?.name || null, message: String(error?.message || error).slice(0, 2000) }));
  }
}

if (isEnabled('AAU_AUTONOMOUS_LIFECYCLE_ENABLED')) {
  try {
    const { startNvidiaAutonomousLifecycle } = await import('./nvidia-autonomous-lifecycle.js');
    const result = await startNvidiaAutonomousLifecycle();
    console.log('AAU_AUTONOMOUS_LIFECYCLE_STARTED', JSON.stringify(result));
  } catch (error) {
    console.error('AAU_AUTONOMOUS_LIFECYCLE_START_FAILED', JSON.stringify({ error_name: error?.name || null, message: String(error?.message || error).slice(0, 2000) }));
  }
}

if (isEnabled('AAU_VERCEL_DIAGNOSTIC_ON_START')) {
  void import('./vercel-diagnostic-probe.js')
    .then(({ probeLatestVercelDeployment }) => probeLatestVercelDeployment())
    .then((result) => console.log('AAU_VERCEL_DIAGNOSTIC_RESULT', JSON.stringify(result)))
    .catch((error) => console.error('AAU_VERCEL_DIAGNOSTIC_FAILED', JSON.stringify({
      message: String(error?.message || error).slice(0,1200),
      details: error?.details || null,
    })));
}

await import('./broker-bridge-envcheck.js');
