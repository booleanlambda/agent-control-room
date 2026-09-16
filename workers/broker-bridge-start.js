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

await import('./broker-bridge-envcheck.js');
