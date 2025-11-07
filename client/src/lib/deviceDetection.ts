export type DeviceTier = 1 | 2 | 3 | 4;

export type GPUVendor = 'nvidia' | 'amd' | 'intel' | 'apple' | 'mali' | 'adreno' | 'powervr' | 'unknown';
export type BrowserEngine = 'webkit' | 'blink' | 'gecko' | 'unknown';

export interface WebGLCapabilities {
  version: 1 | 2;
  vendor: string;
  renderer: string;
  gpuVendor: GPUVendor;
  browserEngine: BrowserEngine;
  
  // Precision support
  vertexHighpFloat: boolean;
  fragmentHighpFloat: boolean;
  vertexHighpInt: boolean;
  fragmentHighpInt: boolean;
  
  // Extensions
  hasFloatTextures: boolean;
  hasHalfFloatTextures: boolean;
  hasColorBufferFloat: boolean;
  hasTextureFilterAnisotropic: boolean;
  hasDisjointTimerQuery: boolean;
  hasInstancedArrays: boolean;
  hasDerivatives: boolean;
  hasFragDepth: boolean;
  hasDrawBuffers: boolean;
  
  // Limits
  maxTextureSize: number;
  maxCubeMapTextureSize: number;
  maxRenderBufferSize: number;
  maxVaryingVectors: number;
  maxVertexTextureImageUnits: number;
  maxFragmentUniforms: number;
  maxVertexUniforms: number;
  
  // Known quirks
  quirks: string[];
}

export interface DeviceCapabilities {
  tier: DeviceTier;
  ram: number;
  cores: number;
  hasWebGL2: boolean;
  hasWebGPU: boolean;
  gpuInfo: string;
  platform: string;
  maxFPS: number;
  webgl?: WebGLCapabilities;
}

function detectGPUVendor(renderer: string): GPUVendor {
  const r = renderer.toLowerCase();
  if (r.includes('nvidia') || r.includes('geforce') || r.includes('quadro')) return 'nvidia';
  if (r.includes('amd') || r.includes('radeon') || r.includes('ati')) return 'amd';
  if (r.includes('intel') || r.includes('hd graphics') || r.includes('uhd graphics')) return 'intel';
  if (r.includes('apple') || r.includes('m1') || r.includes('m2') || r.includes('m3')) return 'apple';
  if (r.includes('mali')) return 'mali';
  if (r.includes('adreno')) return 'adreno';
  if (r.includes('powervr')) return 'powervr';
  return 'unknown';
}

function detectBrowserEngine(): BrowserEngine {
  const ua = navigator.userAgent.toLowerCase();
  if (ua.includes('chrome') || ua.includes('chromium') || ua.includes('edge')) return 'blink';
  if (ua.includes('safari') && !ua.includes('chrome')) return 'webkit';
  if (ua.includes('firefox')) return 'gecko';
  return 'unknown';
}

function detectQuirks(vendor: GPUVendor, engine: BrowserEngine, renderer: string): string[] {
  const quirks: string[] = [];
  
  // Safari/WebKit quirks
  if (engine === 'webkit') {
    quirks.push('safari-metal-pipeline');
    quirks.push('no-derivative-in-loops');
  }
  
  // Intel GPU quirks (especially with ANGLE)
  if (vendor === 'intel' && renderer.toLowerCase().includes('angle')) {
    quirks.push('angle-intel-workarounds');
    quirks.push('conservative-precision');
  }
  
  // Mobile GPU quirks
  if (vendor === 'mali') {
    quirks.push('mali-precision-issues');
    quirks.push('limited-varying-interpolators');
  }
  
  if (vendor === 'adreno') {
    quirks.push('adreno-compiler-bugs');
    quirks.push('texture-lookup-precision');
  }
  
  if (vendor === 'powervr') {
    quirks.push('powervr-tile-memory-limits');
  }
  
  return quirks;
}

function probeWebGLCapabilities(gl: WebGLRenderingContext | WebGL2RenderingContext): WebGLCapabilities {
  const isWebGL2 = gl instanceof WebGL2RenderingContext;
  
  // Get vendor/renderer info
  const debugInfo = gl.getExtension('WEBGL_debug_renderer_info');
  const vendor = debugInfo ? gl.getParameter(debugInfo.UNMASKED_VENDOR_WEBGL) || 'unknown' : 'unknown';
  const renderer = debugInfo ? gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL) || 'unknown' : 'unknown';
  
  const gpuVendor = detectGPUVendor(renderer);
  const browserEngine = detectBrowserEngine();
  
  // Probe precision support
  const vhpf = gl.getShaderPrecisionFormat(gl.VERTEX_SHADER, gl.HIGH_FLOAT);
  const fhpf = gl.getShaderPrecisionFormat(gl.FRAGMENT_SHADER, gl.HIGH_FLOAT);
  const vhpi = gl.getShaderPrecisionFormat(gl.VERTEX_SHADER, gl.HIGH_INT);
  const fhpi = gl.getShaderPrecisionFormat(gl.FRAGMENT_SHADER, gl.HIGH_INT);
  
  // Probe extensions
  const hasFloatTextures = isWebGL2 || !!gl.getExtension('OES_texture_float');
  const hasHalfFloatTextures = isWebGL2 || !!gl.getExtension('OES_texture_half_float');
  const hasColorBufferFloat = isWebGL2 || !!gl.getExtension('EXT_color_buffer_float') || !!gl.getExtension('WEBGL_color_buffer_float');
  const hasTextureFilterAnisotropic = !!gl.getExtension('EXT_texture_filter_anisotropic') || !!gl.getExtension('WEBKIT_EXT_texture_filter_anisotropic');
  const hasDisjointTimerQuery = isWebGL2 ? !!gl.getExtension('EXT_disjoint_timer_query_webgl2') : !!gl.getExtension('EXT_disjoint_timer_query');
  const hasInstancedArrays = isWebGL2 || !!gl.getExtension('ANGLE_instanced_arrays');
  const hasDerivatives = isWebGL2 || !!gl.getExtension('OES_standard_derivatives');
  const hasFragDepth = isWebGL2 || !!gl.getExtension('EXT_frag_depth');
  const hasDrawBuffers = isWebGL2 || !!gl.getExtension('WEBGL_draw_buffers');
  
  // Probe limits
  const maxTextureSize = gl.getParameter(gl.MAX_TEXTURE_SIZE);
  const maxCubeMapTextureSize = gl.getParameter(gl.MAX_CUBE_MAP_TEXTURE_SIZE);
  const maxRenderBufferSize = gl.getParameter(gl.MAX_RENDERBUFFER_SIZE);
  const maxVaryingVectors = gl.getParameter(gl.MAX_VARYING_VECTORS);
  const maxVertexTextureImageUnits = gl.getParameter(gl.MAX_VERTEX_TEXTURE_IMAGE_UNITS);
  const maxFragmentUniforms = gl.getParameter(gl.MAX_FRAGMENT_UNIFORM_VECTORS);
  const maxVertexUniforms = gl.getParameter(gl.MAX_VERTEX_UNIFORM_VECTORS);
  
  // Detect known quirks
  const quirks = detectQuirks(gpuVendor, browserEngine, renderer);
  
  return {
    version: isWebGL2 ? 2 : 1,
    vendor,
    renderer,
    gpuVendor,
    browserEngine,
    
    vertexHighpFloat: vhpf ? vhpf.precision > 0 : false,
    fragmentHighpFloat: fhpf ? fhpf.precision > 0 : false,
    vertexHighpInt: vhpi ? vhpi.precision > 0 : false,
    fragmentHighpInt: fhpi ? fhpi.precision > 0 : false,
    
    hasFloatTextures,
    hasHalfFloatTextures,
    hasColorBufferFloat,
    hasTextureFilterAnisotropic,
    hasDisjointTimerQuery,
    hasInstancedArrays,
    hasDerivatives,
    hasFragDepth,
    hasDrawBuffers,
    
    maxTextureSize,
    maxCubeMapTextureSize,
    maxRenderBufferSize,
    maxVaryingVectors,
    maxVertexTextureImageUnits,
    maxFragmentUniforms,
    maxVertexUniforms,
    
    quirks,
  };
}

export function detectDeviceCapabilities(): DeviceCapabilities {
  const ram = (navigator as any).deviceMemory || 4;
  const cores = navigator.hardwareConcurrency || 2;
  
  const canvas = document.createElement('canvas');
  const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
  const hasWebGL2 = !!canvas.getContext('webgl2');
  const hasWebGPU = 'gpu' in navigator;
  
  let gpuInfo = 'unknown';
  let webglCaps: WebGLCapabilities | undefined;
  
  if (gl) {
    // Probe comprehensive WebGL capabilities
    webglCaps = probeWebGLCapabilities(gl);
    gpuInfo = webglCaps.renderer;
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
  
  if (webglCaps) {
    console.log(`[WebGL Caps] Version: ${webglCaps.version}, Vendor: ${webglCaps.gpuVendor}, Engine: ${webglCaps.browserEngine}`);
    console.log(`[WebGL Caps] Highp Float: V=${webglCaps.vertexHighpFloat} F=${webglCaps.fragmentHighpFloat}`);
    console.log(`[WebGL Caps] Max Texture: ${webglCaps.maxTextureSize}, Varying: ${webglCaps.maxVaryingVectors}`);
    if (webglCaps.quirks.length > 0) {
      console.log(`[WebGL Caps] Quirks: ${webglCaps.quirks.join(', ')}`);
    }
  }

  return {
    tier,
    ram,
    cores,
    hasWebGL2,
    hasWebGPU,
    gpuInfo,
    platform,
    maxFPS,
    webgl: webglCaps,
  };
}
