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

void main() {
  vec2 uv = v_texCoord;
  vec2 pixel = gl_FragCoord.xy / u_resolution;
  
  // Create flowing displacement field
  float flowTime = u_time * u_flowSpeed;
  vec3 flowPos = vec3(uv * u_flowScale, flowTime * 0.1);
  
  // Multi-octave noise for organic movement
  float noiseX = fbm(flowPos + vec3(100.0, 0.0, 0.0), 4);
  float noiseY = fbm(flowPos + vec3(0.0, 100.0, 0.0), 4);
  
  // Audio-reactive warp modulation
  float bassWarp = u_bassLevel * 0.05;
  float trebleDetail = u_trebleLevel * 0.5 + 0.5;
  
  // Curl noise for fluid-like displacement
  vec2 displacement = vec2(noiseX, noiseY) * u_warpIntensity * (1.0 + bassWarp);
  
  // Sample both images with displacement
  vec2 uvA = uv + displacement * (1.0 - u_morphProgress);
  vec2 uvB = uv + displacement * u_morphProgress;
  
  // Add anomaly factor for chaotic regions
  if(u_anomalyFactor > 0.5) {
    float anomaly = fbm(vec3(uv * 8.0, flowTime * 0.3), 3);
    if(anomaly > 0.3) {
      uvA += vec2(anomaly * 0.02);
      uvB -= vec2(anomaly * 0.02);
    }
  }
  
  vec4 colorA = texture2D(u_imageA, uvA);
  vec4 colorB = texture2D(u_imageB, uvB);
  
  // Intelligent color morphing in HSL space
  vec3 hslA = rgb2hsl(colorA.rgb);
  vec3 hslB = rgb2hsl(colorB.rgb);
  
  // Hue rotation with color shift rate
  float hueShift = u_colorShiftRate * sin(flowTime * 0.5) * 0.1;
  hslA.x = fract(hslA.x + hueShift);
  hslB.x = fract(hslB.x + hueShift);
  
  // Smooth HSL interpolation
  vec3 hslMorphed = mix(hslA, hslB, smoothstep(0.0, 1.0, u_morphProgress));
  
  // Convert back to RGB
  vec3 finalColor = hsl2rgb(hslMorphed);
  
  // Add detail layer based on high-frequency noise
  float detail = fbm(vec3(uv * 20.0 * trebleDetail, flowTime * 0.2), int(u_detailLevel * 4.0 + 2.0));
  finalColor += detail * 0.05 * u_amplitude;
  
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

// Simple hash for pseudo-random
float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

void main() {
  vec2 uv = v_texCoord;
  
  // Current frame
  vec4 current = texture2D(u_texture, uv);
  
  // Feedback with slight offset for trailing effect
  vec2 offset = vec2(
    sin(u_time * 0.5) * 0.001,
    cos(u_time * 0.3) * 0.001
  );
  vec4 feedback = texture2D(u_feedback, uv + offset);
  
  // Blend with decay
  vec4 result = mix(current, feedback, u_feedbackAmount * 0.3);
  
  // Add subtle grain for organic feel
  float grain = (hash(uv + u_time) - 0.5) * 0.02;
  result.rgb += grain;
  
  gl_FragColor = result;
}
`;
