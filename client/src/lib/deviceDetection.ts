export type DeviceTier = 1 | 2 | 3 | 4;

export interface DeviceCapabilities {
  tier: DeviceTier;
  ram: number;
  cores: number;
  hasWebGL2: boolean;
  hasWebGPU: boolean;
  gpuInfo: string;
  platform: string;
  maxFPS: number;
}

export function detectDeviceCapabilities(): DeviceCapabilities {
  const ram = (navigator as any).deviceMemory || 4;
  const cores = navigator.hardwareConcurrency || 2;
  
  const canvas = document.createElement('canvas');
  const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
  const hasWebGL2 = !!canvas.getContext('webgl2');
  const hasWebGPU = 'gpu' in navigator;
  
  let gpuInfo = 'unknown';
  if (gl) {
    const debugInfo = gl.getExtension('WEBGL_debug_renderer_info');
    if (debugInfo) {
      gpuInfo = gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL) || 'unknown';
    }
  }

  const platform = navigator.platform || navigator.userAgent;

  let tier: DeviceTier = 1;
  let maxFPS = 30;

  if (ram >= 16 && cores >= 8 && hasWebGPU) {
    tier = 4;
    maxFPS = 120;
  } else if (ram >= 8 && cores >= 4 && hasWebGL2) {
    tier = 3;
    maxFPS = 60;
  } else if (ram >= 4 && cores >= 2 && gl) {
    tier = 2;
    maxFPS = 45;
  } else {
    tier = 1;
    maxFPS = 30;
  }

  console.log(`[Device Detection] Tier ${tier}: ${ram}GB RAM, ${cores} cores, WebGL2: ${hasWebGL2}, WebGPU: ${hasWebGPU}, GPU: ${gpuInfo}`);

  return {
    tier,
    ram,
    cores,
    hasWebGL2,
    hasWebGPU,
    gpuInfo,
    platform,
    maxFPS,
  };
}
