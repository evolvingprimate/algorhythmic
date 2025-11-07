export const vertexShaderSource = `
attribute vec2 a_position;
attribute vec2 a_texCoord;
varying vec2 v_texCoord;

void main() {
  gl_Position = vec4(a_position, 0.0, 1.0);
  v_texCoord = a_texCoord;
}
`;

export const flowFieldFragmentShader = `
precision highp float;

uniform sampler2D u_imageA;
uniform sampler2D u_imageB;
uniform sampler2D u_traceTexture; // Frame B luminance/edge trace
uniform float u_time;
uniform float u_morphProgress;
uniform vec2 u_resolution;

// DNA parameters
uniform float u_flowSpeed;
uniform float u_flowScale;
uniform float u_warpIntensity;
uniform float u_colorShiftRate;
uniform float u_detailLevel;
uniform float u_anomalyFactor;

// Audio parameters
uniform float u_bassLevel;
uniform float u_trebleLevel;
uniform float u_amplitude;
uniform float u_beatBurst; // 0-1 impulse that decays over 180ms

// DJ Crossfade & Ken Burns parameters
uniform float u_zoomBias; // 0-1: Ken Burns zoom (0 at holds, 1 at peak burn)
uniform float u_parallaxStrength; // 0-1: Parallax effect intensity
uniform float u_burnIntensity; // 0-1: Peak "burn" effect intensity

// Dreamy birthing effect parameters
uniform float u_traceMultiplyStrength; // 0-1: How much trace affects the image
uniform float u_traceParallaxOffset; // Pixel offset for trace to create depth

// Chromatic drift effect parameters
uniform float u_chromaticDrift; // 0-1.5 pixels

varying vec2 v_texCoord;

// 3D Simplex noise
vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 mod289(vec4 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 permute(vec4 x) { return mod289(((x*34.0)+1.0)*x); }
vec4 taylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }

float snoise(vec3 v) {
  const vec2 C = vec2(1.0/6.0, 1.0/3.0);
  const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);

  vec3 i  = floor(v + dot(v, C.yyy));
  vec3 x0 = v - i + dot(i, C.xxx);

  vec3 g = step(x0.yzx, x0.xyz);
  vec3 l = 1.0 - g;
  vec3 i1 = min(g.xyz, l.zxy);
  vec3 i2 = max(g.xyz, l.zxy);

  vec3 x1 = x0 - i1 + C.xxx;
  vec3 x2 = x0 - i2 + C.yyy;
  vec3 x3 = x0 - D.yyy;

  i = mod289(i);
  vec4 p = permute(permute(permute(
    i.z + vec4(0.0, i1.z, i2.z, 1.0))
    + i.y + vec4(0.0, i1.y, i2.y, 1.0))
    + i.x + vec4(0.0, i1.x, i2.x, 1.0));

  float n_ = 0.142857142857;
  vec3 ns = n_ * D.wyz - D.xzx;

  vec4 j = p - 49.0 * floor(p * ns.z * ns.z);

  vec4 x_ = floor(j * ns.z);
  vec4 y_ = floor(j - 7.0 * x_);

  vec4 x = x_ *ns.x + ns.yyyy;
  vec4 y = y_ *ns.x + ns.yyyy;
  vec4 h = 1.0 - abs(x) - abs(y);

  vec4 b0 = vec4(x.xy, y.xy);
  vec4 b1 = vec4(x.zw, y.zw);

  vec4 s0 = floor(b0)*2.0 + 1.0;
  vec4 s1 = floor(b1)*2.0 + 1.0;
  vec4 sh = -step(h, vec4(0.0));

  vec4 a0 = b0.xzyw + s0.xzyw*sh.xxyy;
  vec4 a1 = b1.xzyw + s1.xzyw*sh.zzww;

  vec3 p0 = vec3(a0.xy, h.x);
  vec3 p1 = vec3(a0.zw, h.y);
  vec3 p2 = vec3(a1.xy, h.z);
  vec3 p3 = vec3(a1.zw, h.w);

  vec4 norm = taylorInvSqrt(vec4(dot(p0,p0), dot(p1,p1), dot(p2,p2), dot(p3,p3)));
  p0 *= norm.x;
  p1 *= norm.y;
  p2 *= norm.z;
  p3 *= norm.w;

  vec4 m = max(0.6 - vec4(dot(x0,x0), dot(x1,x1), dot(x2,x2), dot(x3,x3)), 0.0);
  m = m * m;
  return 42.0 * dot(m*m, vec4(dot(p0,x0), dot(p1,x1), dot(p2,x2), dot(p3,x3)));
}

// Fractal Brownian Motion for more complex noise
// Fixed octave count for WebGL GLSL compatibility (loop bounds must be constant)
float fbm(vec3 p) {
  float value = 0.0;
  float amplitude = 0.5;
  float frequency = 1.0;
  const int octaves = 5; // Fixed at 5 octaves for good quality/performance balance
  
  for(int i = 0; i < 5; i++) {
    value += amplitude * snoise(p * frequency);
    frequency *= 2.0;
    amplitude *= 0.5;
  }
  return value;
}

// RGB to HSL conversion
vec3 rgb2hsl(vec3 rgb) {
  float maxC = max(max(rgb.r, rgb.g), rgb.b);
  float minC = min(min(rgb.r, rgb.g), rgb.b);
  float delta = maxC - minC;
  
  float h = 0.0;
  float s = 0.0;
  float l = (maxC + minC) / 2.0;
  
  if(delta > 0.0) {
    s = l < 0.5 ? delta / (maxC + minC) : delta / (2.0 - maxC - minC);
    
    if(rgb.r == maxC) {
      h = (rgb.g - rgb.b) / delta + (rgb.g < rgb.b ? 6.0 : 0.0);
    } else if(rgb.g == maxC) {
      h = (rgb.b - rgb.r) / delta + 2.0;
    } else {
      h = (rgb.r - rgb.g) / delta + 4.0;
    }
    h /= 6.0;
  }
  
  return vec3(h, s, l);
}

// HSL to RGB conversion
vec3 hsl2rgb(vec3 hsl) {
  float h = hsl.x;
  float s = hsl.y;
  float l = hsl.z;
  
  float c = (1.0 - abs(2.0 * l - 1.0)) * s;
  float x = c * (1.0 - abs(mod(h * 6.0, 2.0) - 1.0));
  float m = l - c / 2.0;
  
  vec3 rgb;
  if(h < 1.0/6.0) {
    rgb = vec3(c, x, 0.0);
  } else if(h < 2.0/6.0) {
    rgb = vec3(x, c, 0.0);
  } else if(h < 3.0/6.0) {
    rgb = vec3(0.0, c, x);
  } else if(h < 4.0/6.0) {
    rgb = vec3(0.0, x, c);
  } else if(h < 5.0/6.0) {
    rgb = vec3(x, 0.0, c);
  } else {
    rgb = vec3(c, 0.0, x);
  }
  
  return rgb + m;
}

// ====== OKLAB COLOR SPACE ======
// Perceptually uniform color space for smooth blending without muddy grays

// sRGB to Linear RGB
vec3 srgbToLinear(vec3 srgb) {
  return mix(
    srgb / 12.92,
    pow((srgb + 0.055) / 1.055, vec3(2.4)),
    step(0.04045, srgb)
  );
}

// Linear RGB to sRGB
vec3 linearToSrgb(vec3 linear) {
  return mix(
    linear * 12.92,
    pow(linear, vec3(1.0/2.4)) * 1.055 - 0.055,
    step(0.0031308, linear)
  );
}

// Linear RGB to OKLab
vec3 rgbToOklab(vec3 rgb) {
  // Convert sRGB to linear
  vec3 linear = srgbToLinear(rgb);
  
  // Linear RGB to LMS cone response
  mat3 rgb2lms = mat3(
    0.4122214708, 0.5363325363, 0.0514459929,
    0.2119034982, 0.6806995451, 0.1073969566,
    0.0883024619, 0.2817188376, 0.6299787005
  );
  vec3 lms = rgb2lms * linear;
  
  // Apply cube root (perceptual compression)
  lms = sign(lms) * pow(abs(lms), vec3(1.0/3.0));
  
  // LMS to OKLab
  mat3 lms2lab = mat3(
    0.2104542553, 0.7936177850, -0.0040720468,
    1.9779984951, -2.4285922050, 0.4505937099,
    0.0259040371, 0.7827717662, -0.8086757660
  );
  return lms2lab * lms;
}

// OKLab to Linear RGB
vec3 oklabToRgb(vec3 lab) {
  // OKLab to LMS
  mat3 lab2lms = mat3(
    1.0, 0.3963377774, 0.2158037573,
    1.0, -0.1055613458, -0.0638541728,
    1.0, -0.0894841775, -1.2914855480
  );
  vec3 lms = lab2lms * lab;
  
  // Cube (undo perceptual compression)
  lms = lms * lms * lms;
  
  // LMS to Linear RGB
  mat3 lms2rgb = mat3(
    4.0767416621, -3.3077115913, 0.2309699292,
    -1.2684380046, 2.6097574011, -0.3413193965,
    -0.0041960863, -0.7034186147, 1.7076147010
  );
  vec3 linear = lms2rgb * lms;
  
  // Linear to sRGB
  return linearToSrgb(linear);
}

// Easing functions for smoother transitions
float easeInOutQuad(float t) {
  return t < 0.5 ? 2.0 * t * t : 1.0 - pow(-2.0 * t + 2.0, 2.0) / 2.0;
}

float easeInOutCubic(float t) {
  return t < 0.5 ? 4.0 * t * t * t : 1.0 - pow(-2.0 * t + 2.0, 3.0) / 2.0;
}

// Curl noise for organic, fluid-like flow (like ferrofluid)
vec2 curlNoise(vec3 p) {
  float eps = 0.01;
  float n1 = snoise(p + vec3(eps, 0.0, 0.0));
  float n2 = snoise(p - vec3(eps, 0.0, 0.0));
  float n3 = snoise(p + vec3(0.0, eps, 0.0));
  float n4 = snoise(p - vec3(0.0, eps, 0.0));
  
  // Compute curl (divergence-free flow)
  return vec2(n3 - n4, n2 - n1) / (2.0 * eps);
}

// Polar swirl for rotational flow (creates spiraling motion)
vec2 polarSwirl(vec2 uv, float amount) {
  vec2 centered = uv - 0.5;
  float angle = amount * length(centered);
  // Perpendicular vector rotated by angle strength
  return vec2(-centered.y, centered.x) * angle;
}

// Luminance calculation
float luminance(vec3 color) {
  return dot(color, vec3(0.299, 0.587, 0.114));
}

// Gaussian blur helper for Laplacian pyramid (5-tap cross pattern)
vec3 gaussianBlur(sampler2D tex, vec2 uv, float radius) {
  vec3 color = vec3(0.0);
  // Gaussian weights for 5-tap cross pattern
  color += texture2D(tex, uv).rgb * 0.4;
  color += texture2D(tex, uv + vec2(radius, 0.0)).rgb * 0.15;
  color += texture2D(tex, uv - vec2(radius, 0.0)).rgb * 0.15;
  color += texture2D(tex, uv + vec2(0.0, radius)).rgb * 0.15;
  color += texture2D(tex, uv - vec2(0.0, radius)).rgb * 0.15;
  return color;
}

// Sobel edge detection for edge-guided flow
// Returns: (edgeStrength, edgeTangentX, edgeTangentY)
vec3 sobelEdgeDetect(sampler2D tex, vec2 uv, float texelSize) {
  // Sample 3x3 neighborhood
  float tl = luminance(texture2D(tex, uv + vec2(-texelSize, -texelSize)).rgb);
  float tc = luminance(texture2D(tex, uv + vec2(0.0, -texelSize)).rgb);
  float tr = luminance(texture2D(tex, uv + vec2(texelSize, -texelSize)).rgb);
  
  float ml = luminance(texture2D(tex, uv + vec2(-texelSize, 0.0)).rgb);
  float mr = luminance(texture2D(tex, uv + vec2(texelSize, 0.0)).rgb);
  
  float bl = luminance(texture2D(tex, uv + vec2(-texelSize, texelSize)).rgb);
  float bc = luminance(texture2D(tex, uv + vec2(0.0, texelSize)).rgb);
  float br = luminance(texture2D(tex, uv + vec2(texelSize, texelSize)).rgb);
  
  // Sobel kernels
  // Gx: [-1 0 1; -2 0 2; -1 0 1]
  float Gx = -tl + tr - 2.0*ml + 2.0*mr - bl + br;
  // Gy: [-1 -2 -1; 0 0 0; 1 2 1]
  float Gy = -tl - 2.0*tc - tr + bl + 2.0*bc + br;
  
  // Edge strength (gradient magnitude)
  float edgeStrength = length(vec2(Gx, Gy));
  
  // Edge tangent (perpendicular to gradient for flow along edges)
  vec2 edgeTangent = normalize(vec2(-Gy, Gx) + vec2(0.001)); // Small offset to avoid zero
  
  return vec3(edgeStrength, edgeTangent);
}

void main() {
  vec2 uv = v_texCoord;
  vec2 pixel = gl_FragCoord.xy / u_resolution;
  
  // Apply easing to morph progress for smoother transitions
  float easedProgress = easeInOutCubic(u_morphProgress);
  
  // ====== DJ-STYLE KEN BURNS WITH PARALLAX ======
  // Uses u_zoomBias from MorphEngine: 0 at holds, 1 at peak burn
  
  // Zoom from 1.0x (holds) to 1.2x (peak burn) - enhanced zoom range for G-force feel
  float maxZoom = 1.2 + (u_burnIntensity * 0.3); // Extra zoom boost during burn
  float kenBurnsScale = 1.0 + (u_zoomBias * (maxZoom - 1.0));
  vec2 uvCentered = uv - 0.5;
  
  // ====== PARALLAX LAYERING ======
  // Frame A (foreground): Tighter zoom, faster translation
  // Frame B (background): Shallower zoom, slower movement
  
  // Frame A (foreground) - more zoom, more movement
  float zoomFactorA = 1.0 + (u_zoomBias * 0.15) * (1.0 + u_parallaxStrength * 0.3);
  vec2 parallaxA = uvCentered * u_zoomBias * u_parallaxStrength * 0.12; // Faster
  vec2 uvA_zoomed = uvCentered / zoomFactorA + 0.5 + parallaxA;
  
  // Frame B (background) - less zoom, less movement
  float zoomFactorB = 1.0 + (u_zoomBias * 0.08) * (1.0 + u_parallaxStrength * 0.15);
  vec2 parallaxB = uvCentered * u_zoomBias * u_parallaxStrength * 0.06; // Slower
  vec2 uvB_zoomed = uvCentered / zoomFactorB + 0.5 + parallaxB;
  
  // ====== ENHANCED AUDIO CONTROL MAPPING ======
  // Derive mid-frequency from bass and treble
  float midLevel = mix(u_bassLevel, u_trebleLevel, 0.5);
  
  // Tasteful ceilings: lerp(base, base + factor*audio, ceiling)
  // This prevents harsh jumps by limiting audio influence
  float flowMagBase = u_warpIntensity;
  float flowMagAudioReactive = flowMagBase + 0.35 * u_bassLevel;
  float flowMag = mix(flowMagBase, flowMagAudioReactive, 0.8); // 80% ceiling
  
  float curlScaleBase = u_flowScale * 0.3;
  float curlScaleAudioReactive = curlScaleBase + 0.50 * midLevel;
  float curlScale = mix(curlScaleBase, curlScaleAudioReactive, 0.7); // 70% ceiling
  
  float sparkleGainBase = 0.02;
  float sparkleGainAudioReactive = sparkleGainBase + 0.7 * u_trebleLevel;
  float sparkleGain = mix(sparkleGainBase, sparkleGainAudioReactive, 0.6); // 60% ceiling
  
  // Low-frequency organic flow (ferrofluid-like)
  float flowTime = u_time * u_flowSpeed * 0.5; // Slower for softer movement
  vec3 flowPos = vec3(uv * curlScale, flowTime * 0.08); // Lower frequency with audio-reactive scale
  
  // Use curl noise for divergence-free, organic flow
  vec2 curl = curlNoise(flowPos);
  
  // Soften displacement with smoothstep falloff based on distance from center
  float distFromCenter = length(pixel - 0.5) * 2.0;
  float edgeSoftness = smoothstep(1.0, 0.3, distFromCenter);
  
  // Combine curl with low-frequency noise for water-like fluidity
  float lowFreqNoise = snoise(vec3(uv * 2.0, flowTime * 0.1));
  vec2 fluidFlow = curl + vec2(lowFreqNoise * 0.3);
  
  // Add polar swirl for organic rotational motion (subtle, audio-reactive)
  float swirlAmount = 0.04 + u_bassLevel * 0.06; // Base swirl + bass boost
  vec2 polar = polarSwirl(pixel, swirlAmount);
  fluidFlow += polar * 0.3; // Blend swirl into flow
  
  // ====== EDGE-GUIDED DISPLACEMENT ======
  // Detect edges in both images to prevent shearing across strong lines
  float texelSize = 1.0 / 1024.0; // Assuming 1024x1024 textures
  vec3 edgeInfoA = sobelEdgeDetect(u_imageA, uvA_zoomed, texelSize);
  vec3 edgeInfoB = sobelEdgeDetect(u_imageB, uvB_zoomed, texelSize);
  
  // Extract edge data
  float edgeStrengthA = edgeInfoA.x;
  float edgeStrengthB = edgeInfoB.x;
  vec2 edgeTangentA = edgeInfoA.yz;
  vec2 edgeTangentB = edgeInfoB.yz;
  
  // Blend edge tangents based on morph progress
  float blendedEdgeStrength = mix(edgeStrengthA, edgeStrengthB, easedProgress);
  vec2 blendedEdgeTangent = normalize(mix(edgeTangentA, edgeTangentB, easedProgress));
  
  // Steer flow to align with edges (stronger edges = more alignment)
  float edgeWeight = smoothstep(0.1, 0.5, blendedEdgeStrength); // Only strong edges guide flow
  vec2 guidedFlow = mix(fluidFlow, blendedEdgeTangent * length(fluidFlow), edgeWeight);
  
  // ====== BEAT-TRIGGERED MICRO-BURSTS ======
  // Flow magnitude spike (×1.45) on beats
  // Use enhanced flowMag with tasteful ceiling, then add beat burst
  float flowMagnitude = flowMag * (1.0 + 0.45 * u_beatBurst);
  
  // Apply smooth, edge-guided displacement with beat bursts
  // Enhanced displacement during burn for G-force effect
  float displacementScale = 0.02 * (1.0 + u_burnIntensity * 0.5);
  vec2 displacement = guidedFlow * flowMagnitude * edgeSoftness * displacementScale;
  
  // Sample both images with parallax-layered UVs + edge-aware displacement
  // Frame A (foreground) gets more displacement
  vec2 uvA = uvA_zoomed + displacement * (1.0 + u_parallaxStrength * 0.3);
  vec2 uvB = uvB_zoomed + displacement * (1.0 - u_parallaxStrength * 0.2);
  
  // Gentle anomaly effect (optional chaotic regions)
  if(u_anomalyFactor > 0.7) {
    float anomaly = snoise(vec3(uv * 4.0, flowTime * 0.2)); // Lower frequency
    float anomalyWeight = smoothstep(0.5, 0.7, anomaly); // Soft threshold
    uvA += vec2(anomaly * 0.01 * anomalyWeight);
    uvB -= vec2(anomaly * 0.01 * anomalyWeight);
  }
  
  // ====== G-FORCE MOTION BLUR ======
  // Sample textures multiple times along displacement vector for motion blur effect
  // Intensity increases during burn and with audio
  float motionBlurStrength = u_burnIntensity * 0.4 + u_amplitude * 0.2;
  int motionBlurSamples = 5; // Number of samples along velocity vector
  
  vec3 blurredA = vec3(0.0);
  vec3 blurredB = vec3(0.0);
  
  if(motionBlurStrength > 0.01) {
    // Sample along displacement vector
    vec2 blurStep = displacement * motionBlurStrength / float(motionBlurSamples);
    float totalWeight = 0.0;
    
    for(int i = 0; i < 5; i++) {
      if(i >= motionBlurSamples) break;
      
      float t = float(i) / float(motionBlurSamples - 1); // 0 to 1
      float weight = 1.0 - abs(t - 0.5) * 2.0; // Bell curve weight
      weight = weight * weight; // Squared for sharper falloff
      
      vec2 offsetA = blurStep * (t - 0.5) * 2.0; // -1 to +1 range
      vec2 offsetB = blurStep * (t - 0.5) * 2.0;
      
      blurredA += texture2D(u_imageA, uvA + offsetA).rgb * weight;
      blurredB += texture2D(u_imageB, uvB + offsetB).rgb * weight;
      totalWeight += weight;
    }
    
    blurredA /= max(totalWeight, 0.001);
    blurredB /= max(totalWeight, 0.001);
  } else {
    // No motion blur, just sample normally
    blurredA = texture2D(u_imageA, uvA).rgb;
    blurredB = texture2D(u_imageB, uvB).rgb;
  }
  
  // ====== TRUE LAPLACIAN PYRAMID MULTIBAND BLENDING ======
  // Key: Extract frequency bands by subtracting adjacent Gaussian levels
  // This isolates coarse structure from fine texture for latent-space feel
  
  // Different blend rates for each frequency band
  float tCoarse = smoothstep(0.05, 0.95, easedProgress); // Coarsest: slowest (structure)
  float tMid = smoothstep(0.20, 0.80, easedProgress);    // Mid: moderate (forms)
  float tFine = smoothstep(0.30, 0.70, easedProgress);   // Finest: fastest (details)
  
  // === Build Gaussian Pyramid (progressively blurred levels) ===
  // Use motion-blurred samples for enhanced G-force effect
  vec3 A_G0 = blurredA;                                  // Level 0: Full detail (with motion blur)
  vec3 A_G1 = gaussianBlur(u_imageA, uvA, 0.003);        // Level 1: Slight blur
  vec3 A_G2 = gaussianBlur(u_imageA, uvA, 0.008);        // Level 2: More blur
  
  vec3 B_G0 = blurredB;                                  // Level 0: Full detail (with motion blur)
  vec3 B_G1 = gaussianBlur(u_imageB, uvB, 0.003);
  vec3 B_G2 = gaussianBlur(u_imageB, uvB, 0.008);
  
  // === Compute Laplacian Bands (band-pass via subtraction) ===
  // Each band contains ONLY its frequency range (no overlap)
  vec3 A_Lap_Fine = A_G0 - A_G1;    // High frequencies (fine detail)
  vec3 A_Lap_Mid  = A_G1 - A_G2;    // Mid frequencies (edges/forms)
  vec3 A_Lap_Coarse = A_G2;         // Base level (coarse structure)
  
  vec3 B_Lap_Fine = B_G0 - B_G1;
  vec3 B_Lap_Mid  = B_G1 - B_G2;
  vec3 B_Lap_Coarse = B_G2;
  
  // === Blend each Laplacian band at different rates ===
  // This is THE KEY to latent-space feel: structure evolves slowly, details quickly
  vec3 blendedCoarse = mix(A_Lap_Coarse, B_Lap_Coarse, tCoarse); // Slowest
  vec3 blendedMid    = mix(A_Lap_Mid, B_Lap_Mid, tMid);           // Moderate
  vec3 blendedFine   = mix(A_Lap_Fine, B_Lap_Fine, tFine);        // Fastest
  
  // === Reconstruct by SUMMING blended Laplacian bands ===
  // Unlike Gaussian pyramid, Laplacian bands must be ADDED (not weighted mix)
  // because they're residuals that sum to the original image
  vec3 multiband = blendedCoarse + blendedMid + blendedFine;
  
  // ====== SPATIAL MASKING FOR SELECTIVE COLOR EFFECTS ======
  // Create masks to prevent whole-screen pulsing (affects only selective areas)
  
  // Radial mask: stronger at center, weaker at edges
  float radialMask = 1.0 - smoothstep(0.0, 0.8, distFromCenter);
  
  // Edge-based mask: stronger near detected edges
  float edgeMask = smoothstep(0.2, 0.5, blendedEdgeStrength);
  
  // Combined spatial mask (center + edges get color effects)
  float spatialMask = max(radialMask * 0.7, edgeMask * 0.5);
  
  // ====== OKLAB COLOR BLENDING (SPATIALLY MASKED) ======
  // Perceptually uniform color space prevents muddy grays during transitions
  vec3 oklabMultiband = rgbToOklab(clamp(multiband, 0.0, 1.0));
  
  // DISABLED: Chroma boost and hue rotation removed per user request
  // No color pulsing or shifting - keep natural colors
  
  // Convert back to RGB
  vec3 finalColor = clamp(oklabToRgb(oklabMultiband), 0.0, 1.0);
  
  // Softer detail layer using low-frequency noise (not harsh fbm)
  // Use sparkleGain with tasteful ceiling for smooth reactivity
  float trebleDetail = u_trebleLevel * 0.3 + 0.3; // Reduced range
  float detail = snoise(vec3(uv * 8.0 * trebleDetail, flowTime * 0.15)) * 0.5 + 0.5;
  finalColor += (detail - 0.5) * sparkleGain * u_amplitude; // Enhanced sparkle control
  
  // ====== DREAMY BIRTHING EFFECT: ADDITIVE TRACE WITH BRIGHTNESS FLOOR ======
  // Sample the Frame B trace with parallax offset for depth
  vec2 traceUV = uv + vec2(u_traceParallaxOffset) / u_resolution;
  float traceMask = texture2D(u_traceTexture, traceUV).r;
  
  // CRITICAL FIX: Additive trace blending with proportional brightness floor
  // This prevents black frames while maintaining the dreamy birthing effect
  float traceWeight = clamp(traceMask * u_traceMultiplyStrength, 0.0, 1.0);
  
  // Floor scales with trace influence (0% when no trace, 30% at full trace)
  // This preserves dark regions when trace is absent
  float minFloor = mix(0.0, 0.3, traceWeight);
  vec3 floored = max(finalColor, vec3(minFloor));
  
  // Add trace as a subtle lift (additive, not multiplicative)
  vec3 traceLift = vec3(traceWeight) * 0.25;
  
  // Blend the floored color with the trace lift
  finalColor = clamp(mix(floored, floored + traceLift, traceWeight), 0.0, 1.0);
  
  // Add subtle glow from trace for ethereal birthing effect
  vec3 traceGlow = vec3(traceMask) * u_traceMultiplyStrength * 0.15;
  finalColor += traceGlow * u_burnIntensity; // Glow peaks during burn
  
  // Subtle vignette for depth
  float vignette = smoothstep(0.8, 0.2, length(pixel - 0.5));
  finalColor *= mix(0.8, 1.0, vignette);
  
  // ====== ABSOLUTE FINAL SAFETY FLOOR ======
  // CRITICAL: Guarantee no black frames - clamp to minimum 2% brightness
  // This is the LAST line of defense against any mathematical edge cases
  finalColor = max(finalColor, vec3(0.02));
  
  gl_FragColor = vec4(finalColor, 1.0);
}
`;

export const feedbackFragmentShader = `
precision highp float;

uniform sampler2D u_texture;
uniform sampler2D u_feedback;
uniform float u_time;
uniform float u_feedbackAmount;
uniform vec2 u_resolution;

varying vec2 v_texCoord;

// Luminance for edge detection
float luminance(vec3 color) {
  return dot(color, vec3(0.299, 0.587, 0.114));
}

// Simple edge detection to reduce feedback near edges (prevent ghosting)
float detectEdge(sampler2D tex, vec2 uv, float texelSize) {
  float center = luminance(texture2D(tex, uv).rgb);
  float left = luminance(texture2D(tex, uv + vec2(-texelSize, 0.0)).rgb);
  float right = luminance(texture2D(tex, uv + vec2(texelSize, 0.0)).rgb);
  float up = luminance(texture2D(tex, uv + vec2(0.0, -texelSize)).rgb);
  float down = luminance(texture2D(tex, uv + vec2(0.0, texelSize)).rgb);
  
  float edgeStrength = abs(center - left) + abs(center - right) + 
                       abs(center - up) + abs(center - down);
  return smoothstep(0.0, 0.2, edgeStrength);
}

void main() {
  vec2 uv = v_texCoord;
  float texelSize = 1.0 / 1024.0;
  
  // Current frame
  vec4 current = texture2D(u_texture, uv);
  
  // Previous frame (no offset for temporal coherence, not trails)
  vec4 previous = texture2D(u_feedback, uv);
  
  // Detect edges in current frame to reduce feedback near them
  float edgeMask = detectEdge(u_texture, uv, texelSize);
  
  // Temporal coherence: light frame-to-frame blending (6-8%)
  // Reduced near edges to prevent ghosting
  float feedbackWeight = 0.07 * (1.0 - edgeMask * 0.5);
  vec4 result = mix(current, previous, feedbackWeight);
  
  // ====== ABSOLUTE FINAL SAFETY FLOOR (FEEDBACK PASS) ======
  // CRITICAL: Prevent feedback buffer from producing black frames
  // Feedback can decay toward 0, so clamp before output
  result.rgb = max(result.rgb, vec3(0.02));
  
  gl_FragColor = result;
}
`;

// Particle system shaders for G-Force-like tracing effects
export const particleVertexShader = `
attribute vec2 a_position;
attribute vec2 a_velocity;
attribute float a_life;
attribute vec3 a_color;

uniform float u_time;
uniform float u_pointSize;
uniform vec2 u_resolution;

varying float v_life;
varying vec3 v_color;

void main() {
  // Particle fades out as life decreases
  v_life = a_life;
  v_color = a_color;
  
  // Convert particle position to clip space
  vec2 clipSpace = (a_position / u_resolution) * 2.0 - 1.0;
  gl_Position = vec4(clipSpace.x, -clipSpace.y, 0.0, 1.0);
  
  // Point size based on life (larger when young, smaller when old)
  gl_PointSize = u_pointSize * mix(0.5, 1.5, a_life);
}
`;

export const particleFragmentShader = `
precision highp float;

varying float v_life;
varying vec3 v_color;

void main() {
  // Create circular particle with soft edges
  vec2 center = gl_PointCoord - 0.5;
  float dist = length(center);
  
  if(dist > 0.5) {
    discard;
  }
  
  // Soft falloff for glow effect
  float alpha = (1.0 - smoothstep(0.0, 0.5, dist)) * v_life * 0.8;
  
  // Add bright center
  float glow = exp(-dist * 8.0) * 0.5;
  vec3 finalColor = v_color * (1.0 + glow);
  
  gl_FragColor = vec4(finalColor, alpha);
}
`;

// ====== TRACE EXTRACTION SHADER ======
// Extracts luminance and edges from Frame B to create soft "ghost" trace
export const traceExtractionFragmentShader = `
precision highp float;

uniform sampler2D u_imageB;
uniform sampler2D u_previousTrace; // Previous frame's trace for temporal accumulation
uniform vec2 u_resolution;
uniform float u_traceDecay; // 0.85-0.92 for temporal smoothing
uniform float u_traceIntensity; // DNA-controlled trace strength

varying vec2 v_texCoord;

// Luminance extraction
float getLuminance(vec3 rgb) {
  return dot(rgb, vec3(0.299, 0.587, 0.114));
}

// Sobel edge detection for Frame B
float getEdgeMagnitude(sampler2D tex, vec2 uv, vec2 texelSize) {
  // Sobel kernels
  float s00 = getLuminance(texture2D(tex, uv + vec2(-texelSize.x, -texelSize.y)).rgb);
  float s01 = getLuminance(texture2D(tex, uv + vec2(0.0, -texelSize.y)).rgb);
  float s02 = getLuminance(texture2D(tex, uv + vec2(texelSize.x, -texelSize.y)).rgb);
  
  float s10 = getLuminance(texture2D(tex, uv + vec2(-texelSize.x, 0.0)).rgb);
  float s12 = getLuminance(texture2D(tex, uv + vec2(texelSize.x, 0.0)).rgb);
  
  float s20 = getLuminance(texture2D(tex, uv + vec2(-texelSize.x, texelSize.y)).rgb);
  float s21 = getLuminance(texture2D(tex, uv + vec2(0.0, texelSize.y)).rgb);
  float s22 = getLuminance(texture2D(tex, uv + vec2(texelSize.x, texelSize.y)).rgb);
  
  // Sobel operator
  float gx = -s00 - 2.0*s10 - s20 + s02 + 2.0*s12 + s22;
  float gy = -s00 - 2.0*s01 - s02 + s20 + 2.0*s21 + s22;
  
  return sqrt(gx*gx + gy*gy);
}

// Simple 5x5 Gaussian blur for soft trace
// FULLY UNROLLED with COMPILE-TIME CONSTANT indices (WebGL GLSL ES 1.0 requirement)
float gaussianBlur(sampler2D tex, vec2 uv, vec2 texelSize) {
  float sum = 0.0;
  const float norm = 1.0 / 256.0;
  
  // Row -2
  sum += texture2D(tex, uv + vec2(-2.0, -2.0) * texelSize).r * 1.0 * norm;
  sum += texture2D(tex, uv + vec2(-1.0, -2.0) * texelSize).r * 4.0 * norm;
  sum += texture2D(tex, uv + vec2( 0.0, -2.0) * texelSize).r * 6.0 * norm;
  sum += texture2D(tex, uv + vec2( 1.0, -2.0) * texelSize).r * 4.0 * norm;
  sum += texture2D(tex, uv + vec2( 2.0, -2.0) * texelSize).r * 1.0 * norm;
  
  // Row -1
  sum += texture2D(tex, uv + vec2(-2.0, -1.0) * texelSize).r * 4.0 * norm;
  sum += texture2D(tex, uv + vec2(-1.0, -1.0) * texelSize).r * 16.0 * norm;
  sum += texture2D(tex, uv + vec2( 0.0, -1.0) * texelSize).r * 24.0 * norm;
  sum += texture2D(tex, uv + vec2( 1.0, -1.0) * texelSize).r * 16.0 * norm;
  sum += texture2D(tex, uv + vec2( 2.0, -1.0) * texelSize).r * 4.0 * norm;
  
  // Row 0 (center)
  sum += texture2D(tex, uv + vec2(-2.0,  0.0) * texelSize).r * 6.0 * norm;
  sum += texture2D(tex, uv + vec2(-1.0,  0.0) * texelSize).r * 24.0 * norm;
  sum += texture2D(tex, uv + vec2( 0.0,  0.0) * texelSize).r * 36.0 * norm;
  sum += texture2D(tex, uv + vec2( 1.0,  0.0) * texelSize).r * 24.0 * norm;
  sum += texture2D(tex, uv + vec2( 2.0,  0.0) * texelSize).r * 6.0 * norm;
  
  // Row 1
  sum += texture2D(tex, uv + vec2(-2.0,  1.0) * texelSize).r * 4.0 * norm;
  sum += texture2D(tex, uv + vec2(-1.0,  1.0) * texelSize).r * 16.0 * norm;
  sum += texture2D(tex, uv + vec2( 0.0,  1.0) * texelSize).r * 24.0 * norm;
  sum += texture2D(tex, uv + vec2( 1.0,  1.0) * texelSize).r * 16.0 * norm;
  sum += texture2D(tex, uv + vec2( 2.0,  1.0) * texelSize).r * 4.0 * norm;
  
  // Row 2
  sum += texture2D(tex, uv + vec2(-2.0,  2.0) * texelSize).r * 1.0 * norm;
  sum += texture2D(tex, uv + vec2(-1.0,  2.0) * texelSize).r * 4.0 * norm;
  sum += texture2D(tex, uv + vec2( 0.0,  2.0) * texelSize).r * 6.0 * norm;
  sum += texture2D(tex, uv + vec2( 1.0,  2.0) * texelSize).r * 4.0 * norm;
  sum += texture2D(tex, uv + vec2( 2.0,  2.0) * texelSize).r * 1.0 * norm;
  
  return sum;
}

void main() {
  vec2 texelSize = 1.0 / u_resolution;
  
  // Extract luminance from Frame B
  vec3 colorB = texture2D(u_imageB, v_texCoord).rgb;
  float luma = getLuminance(colorB);
  
  // Detect edges
  float edges = getEdgeMagnitude(u_imageB, v_texCoord, texelSize);
  
  // Combine luma + edges for trace mask
  // Bright areas and edges create stronger traces
  float traceMask = clamp(luma * 0.6 + edges * 1.5, 0.0, 1.0);
  
  // Apply gaussian blur for softness
  // Note: For performance, we skip blur here and do it in separate pass if needed
  // traceMask = gaussianBlur(u_imageB, v_texCoord, texelSize * 2.0);
  
  // Temporal accumulation: blend with previous frame's trace
  float previousTrace = texture2D(u_previousTrace, v_texCoord).r;
  float accumulated = mix(traceMask, previousTrace, u_traceDecay);
  
  // Apply DNA-controlled intensity
  accumulated *= u_traceIntensity;
  
  // Output trace mask (grayscale stored in all channels for easier sampling)
  gl_FragColor = vec4(accumulated, accumulated, accumulated, 1.0);
}
`;

// ====== KAWASE BLOOM SHADER ======
// Single-pass bloom for dreamy glow around bright regions
export const bloomFragmentShader = `
precision highp float;

uniform sampler2D u_image;
uniform vec2 u_resolution;
uniform float u_bloomIntensity;
uniform float u_bloomThreshold;

varying vec2 v_texCoord;

void main() {
  vec2 texelSize = 1.0 / u_resolution;
  
  // Kawase blur: sample 4 diagonal neighbors
  float offset = 1.5; // Controls blur radius
  vec3 color = vec3(0.0);
  
  color += texture2D(u_image, v_texCoord + vec2(-offset, -offset) * texelSize).rgb;
  color += texture2D(u_image, v_texCoord + vec2( offset, -offset) * texelSize).rgb;
  color += texture2D(u_image, v_texCoord + vec2(-offset,  offset) * texelSize).rgb;
  color += texture2D(u_image, v_texCoord + vec2( offset,  offset) * texelSize).rgb;
  
  color *= 0.25; // Average
  
  // Extract bright regions only
  float brightness = max(color.r, max(color.g, color.b));
  float bloomMask = smoothstep(u_bloomThreshold - 0.1, u_bloomThreshold + 0.1, brightness);
  
  // Apply bloom with intensity
  gl_FragColor = vec4(color * bloomMask * u_bloomIntensity, 1.0);
}
`;

// ====== SIMPLE COMPOSITING SHADER ======
// Pass-through shader for rendering textures with blending
export const compositeFragmentShader = `
precision highp float;

uniform sampler2D u_texture;
uniform float u_chromaticDrift;  // Horizontal drift in pixels
uniform vec2 u_resolution;
varying vec2 v_texCoord;

void main() {
  vec3 finalColor;
  
  // ====== CHROMATIC DRIFT POST-PROCESS ======
  // Apply subtle RGB channel separation for hallucinatory out-of-focus feel
  // Samples final composited framebuffer with horizontal offsets
  if (u_chromaticDrift > 0.0) {
    vec2 driftOffset = vec2(u_chromaticDrift / u_resolution.x, 0.0);
    
    // Sample RGB channels at offset positions (horizontal only)
    float r = texture2D(u_texture, v_texCoord - driftOffset * 0.5).r; // Red shifts left
    float g = texture2D(u_texture, v_texCoord).g;                       // Green centered
    float b = texture2D(u_texture, v_texCoord + driftOffset * 0.5).b; // Blue shifts right
    
    finalColor = vec3(r, g, b);
  } else {
    // No chromatic drift, pass through
    finalColor = texture2D(u_texture, v_texCoord).rgb;
  }
  
  // ====== ABSOLUTE FINAL SAFETY FLOOR (COMPOSITE PASS) ======
  // CRITICAL: Guarantee no black frames after all post-processing
  finalColor = max(finalColor, vec3(0.02));
  
  gl_FragColor = vec4(finalColor, 1.0);
}
`;

// Simple pass-through shader for additive bloom (NO SAFETY FLOOR)
// Used for bloom composite to avoid adding constant offset with additive blending
export const bloomPassthroughFragmentShader = `
precision highp float;

uniform sampler2D u_texture;
varying vec2 v_texCoord;

void main() {
  // Pure pass-through for additive blending
  // NO safety floor - this would add constant offset every frame
  gl_FragColor = texture2D(u_texture, v_texCoord);
}
`;
