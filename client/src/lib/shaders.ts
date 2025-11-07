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
float fbm(vec3 p, int octaves) {
  float value = 0.0;
  float amplitude = 0.5;
  float frequency = 1.0;
  
  for(int i = 0; i < 8; i++) {
    if(i >= octaves) break;
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
  
  // BELL-CURVE KEN BURNS: Zoom IN (0-50%), peak at 50%, then OUT (50-100%)
  // This syncs with the morph blend - closest to screen at 50% A/B mix
  float bellCurveZoom = abs(easedProgress - 0.5) * 2.0; // 0 at edges, 1.0 at center
  bellCurveZoom = 1.0 - bellCurveZoom; // Invert: 1.0 at center, 0 at edges
  bellCurveZoom = easeInOutCubic(bellCurveZoom); // Smooth the curve
  
  // Zoom from 1.0x (start/end) to 1.5x (50% peak) - very prominent!
  float kenBurnsScale = 1.0 + (bellCurveZoom * 0.5);
  vec2 uvCentered = uv - 0.5;
  
  // Add subtle parallax translation that also follows bell curve
  vec2 parallax = uvCentered * bellCurveZoom * 0.08;
  vec2 uvZoomed = uvCentered / kenBurnsScale + 0.5 + parallax;
  
  // Low-frequency organic flow (ferrofluid-like)
  float flowTime = u_time * u_flowSpeed * 0.5; // Slower for softer movement
  vec3 flowPos = vec3(uv * u_flowScale * 0.3, flowTime * 0.08); // Lower frequency
  
  // Use curl noise for divergence-free, organic flow
  vec2 curl = curlNoise(flowPos);
  
  // Soften displacement with smoothstep falloff based on distance from center
  float distFromCenter = length(pixel - 0.5) * 2.0;
  float edgeSoftness = smoothstep(1.0, 0.3, distFromCenter);
  
  // Audio-reactive warp with subtle modulation
  float bassWarp = u_bassLevel * 0.03; // Reduced for softer effect
  
  // Combine curl with low-frequency noise for water-like fluidity
  float lowFreqNoise = snoise(vec3(uv * 2.0, flowTime * 0.1));
  vec2 fluidFlow = curl + vec2(lowFreqNoise * 0.3);
  
  // ====== EDGE-GUIDED DISPLACEMENT ======
  // Detect edges in both images to prevent shearing across strong lines
  float texelSize = 1.0 / 1024.0; // Assuming 1024x1024 textures
  vec3 edgeInfoA = sobelEdgeDetect(u_imageA, uvZoomed, texelSize);
  vec3 edgeInfoB = sobelEdgeDetect(u_imageB, uv, texelSize);
  
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
  
  // Apply smooth, edge-guided displacement
  vec2 displacement = guidedFlow * u_warpIntensity * (1.0 + bassWarp) * edgeSoftness * 0.02;
  
  // Sample both images with edge-aware displacement
  vec2 uvA = uvZoomed + displacement * (1.0 - easedProgress) * 0.5;
  vec2 uvB = uv + displacement * easedProgress * 0.5;
  
  // Gentle anomaly effect (optional chaotic regions)
  if(u_anomalyFactor > 0.7) {
    float anomaly = snoise(vec3(uv * 4.0, flowTime * 0.2)); // Lower frequency
    float anomalyWeight = smoothstep(0.5, 0.7, anomaly); // Soft threshold
    uvA += vec2(anomaly * 0.01 * anomalyWeight);
    uvB -= vec2(anomaly * 0.01 * anomalyWeight);
  }
  
  // ====== TRUE LAPLACIAN PYRAMID MULTIBAND BLENDING ======
  // Key: Extract frequency bands by subtracting adjacent Gaussian levels
  // This isolates coarse structure from fine texture for latent-space feel
  
  // Different blend rates for each frequency band
  float tCoarse = smoothstep(0.05, 0.95, easedProgress); // Coarsest: slowest (structure)
  float tMid = smoothstep(0.20, 0.80, easedProgress);    // Mid: moderate (forms)
  float tFine = smoothstep(0.30, 0.70, easedProgress);   // Finest: fastest (details)
  
  // === Build Gaussian Pyramid (progressively blurred levels) ===
  vec3 A_G0 = texture2D(u_imageA, uvA).rgb;              // Level 0: Full detail
  vec3 A_G1 = gaussianBlur(u_imageA, uvA, 0.003);        // Level 1: Slight blur
  vec3 A_G2 = gaussianBlur(u_imageA, uvA, 0.008);        // Level 2: More blur
  
  vec3 B_G0 = texture2D(u_imageB, uvB).rgb;
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
  
  // ====== OKLAB COLOR BLENDING ======
  // Perceptually uniform color space prevents muddy grays during transitions
  // For subtle color enhancement, blend multiband with itself in OKLab
  vec3 oklabMultiband = rgbToOklab(clamp(multiband, 0.0, 1.0));
  
  // Subtle chroma boost and hue rotation in perceptual space
  float chromaBoost = 1.0 + u_colorShiftRate * 0.1;
  oklabMultiband.yz *= chromaBoost; // Boost a/b channels (chroma)
  
  // Subtle hue rotation (rotate in a/b plane)
  float hueShift = u_colorShiftRate * sin(flowTime * 0.5) * 0.1;
  float cosH = cos(hueShift);
  float sinH = sin(hueShift);
  vec2 rotatedChroma = vec2(
    oklabMultiband.y * cosH - oklabMultiband.z * sinH,
    oklabMultiband.y * sinH + oklabMultiband.z * cosH
  );
  oklabMultiband.yz = rotatedChroma;
  
  // Convert back to RGB
  vec3 finalColor = clamp(oklabToRgb(oklabMultiband), 0.0, 1.0);
  
  // Softer detail layer using low-frequency noise (not harsh fbm)
  float trebleDetail = u_trebleLevel * 0.3 + 0.3; // Reduced range
  float detail = snoise(vec3(uv * 8.0 * trebleDetail, flowTime * 0.15)) * 0.5 + 0.5;
  finalColor += (detail - 0.5) * 0.02 * u_amplitude; // Subtle detail layer
  
  // Subtle vignette for depth
  float vignette = smoothstep(0.8, 0.2, length(pixel - 0.5));
  finalColor *= mix(0.8, 1.0, vignette);
  
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
