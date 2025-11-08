/**
 * WebGL2 Shaders for Morpheus 0.4
 * Includes mesh warping, TPS displacement, and flow warping shaders
 */

// ============================================================================
// Common Vertex Shader (fullscreen quad)
// ============================================================================

export const fullscreenVertexShader = `#version 300 es
precision highp float;

in vec2 aPosition;
out vec2 vTexCoord;

void main() {
  vTexCoord = aPosition * 0.5 + 0.5;
  gl_Position = vec4(aPosition, 0.0, 1.0);
}
`;

// ============================================================================
// Mesh Warping Shader (Task 7)
// ============================================================================

export const meshVertexShader = `#version 300 es
precision highp float;

in vec2 aPosition;      // Vertex position in mesh space
in float aTriangleId;   // Triangle ID for texture lookup
uniform sampler2D uAffineTexture; // Packed affine matrices
uniform float uMorphProgress; // 0..1

out vec2 vTexCoord;

// Unpack affine transform from texture
mat3 unpackAffine(float triId) {
  // Each triangle uses 2 texels: [a,b,tx,c] [d,ty,0,0]
  float row = triId;
  vec4 texel0 = texelFetch(uAffineTexture, ivec2(0, int(row)), 0);
  vec4 texel1 = texelFetch(uAffineTexture, ivec2(1, int(row)), 0);
  
  return mat3(
    texel0.x, texel0.y, texel0.z,
    texel0.w, texel1.x, texel1.y,
    0.0, 0.0, 1.0
  );
}

void main() {
  // Get affine transforms for this triangle
  mat3 affineA = unpackAffine(aTriangleId);
  mat3 affineB = unpackAffine(aTriangleId); // Would be different texture in full impl
  
  // Transform vertex
  vec3 posA = affineA * vec3(aPosition, 1.0);
  vec3 posB = affineB * vec3(aPosition, 1.0);
  
  // Interpolate
  vec2 pos = mix(posA.xy, posB.xy, uMorphProgress);
  
  // Convert to clip space (-1..1)
  gl_Position = vec4(pos * 2.0 - 1.0, 0.0, 1.0);
  vTexCoord = aPosition;
}
`;

export const meshFragmentShader = `#version 300 es
precision highp float;

in vec2 vTexCoord;
uniform sampler2D uTextureA;
uniform sampler2D uTextureB;
uniform float uMorphProgress;

out vec4 fragColor;

void main() {
  vec4 colorA = texture(uTextureA, vTexCoord);
  vec4 colorB = texture(uTextureB, vTexCoord);
  
  // Simple crossfade
  fragColor = mix(colorA, colorB, uMorphProgress);
}
`;

// ============================================================================
// TPS Displacement Shader (Task 8)
// ============================================================================

export const tpsFragmentShader = `#version 300 es
precision highp float;

in vec2 vTexCoord;

uniform sampler2D uTextureA;
uniform sampler2D uTextureB;
uniform sampler2D uDisplacementMap; // RG32F displacement
uniform float uMorphProgress;       // 0..1
uniform float uDispAmp;             // Displacement amplitude
uniform vec2 uImageSize;            // Image dimensions

out vec4 fragColor;

void main() {
  // Sample displacement at current position
  vec2 displacement = texture(uDisplacementMap, vTexCoord).rg;
  
  // Scale by amplitude and progress
  displacement *= uDispAmp * uMorphProgress;
  
  // Sample textures with displacement
  vec2 uvA = vTexCoord;
  vec2 uvB = vTexCoord + displacement / uImageSize;
  
  // Clamp UVs
  uvB = clamp(uvB, 0.0, 1.0);
  
  vec4 colorA = texture(uTextureA, uvA);
  vec4 colorB = texture(uTextureB, uvB);
  
  // Crossfade
  fragColor = mix(colorA, colorB, uMorphProgress);
}
`;

// ============================================================================
// Optical Flow Warp Shader (Task 9)
// ============================================================================

export const flowFragmentShader = `#version 300 es
precision highp float;

in vec2 vTexCoord;

uniform sampler2D uTextureA;
uniform sampler2D uTextureB;
uniform sampler2D uFlowTexture;      // RG32F flow field
uniform sampler2D uConfidenceTexture; // R32F confidence
uniform float uMorphProgress;         // 0..1
uniform float uFlowWeight;            // How much to trust flow
uniform vec2 uImageSize;              // Image dimensions

out vec4 fragColor;

void main() {
  // Sample flow and confidence
  vec2 flow = texture(uFlowTexture, vTexCoord).rg;
  float confidence = texture(uConfidenceTexture, vTexCoord).r;
  
  // Apply flow with progress and confidence weighting
  vec2 warpedFlow = flow * uMorphProgress * uFlowWeight * confidence;
  
  // Sample textures
  vec2 uvA = vTexCoord;
  vec2 uvB = vTexCoord + warpedFlow / uImageSize;
  
  // Clamp UVs
  uvB = clamp(uvB, 0.0, 1.0);
  
  vec4 colorA = texture(uTextureA, uvA);
  vec4 colorB = texture(uTextureB, uvB);
  
  // Blend based on confidence
  float blendFactor = mix(uMorphProgress, uMorphProgress * confidence, 0.5);
  fragColor = mix(colorA, colorB, blendFactor);
}
`;

// ============================================================================
// Simple Crossfade Shader (fallback)
// ============================================================================

export const crossfadeFragmentShader = `#version 300 es
precision highp float;

in vec2 vTexCoord;

uniform sampler2D uTextureA;
uniform sampler2D uTextureB;
uniform float uMorphProgress;

out vec4 fragColor;

void main() {
  vec4 colorA = texture(uTextureA, vTexCoord);
  vec4 colorB = texture(uTextureB, vTexCoord);
  
  fragColor = mix(colorA, colorB, uMorphProgress);
}
`;

// ============================================================================
// Shader Compilation Utilities
// ============================================================================

export function compileShader(
  gl: WebGL2RenderingContext,
  type: number,
  source: string
): WebGLShader | null {
  const shader = gl.createShader(type);
  if (!shader) return null;

  gl.shaderSource(shader, source);
  gl.compileShader(shader);

  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    console.error('Shader compile error:', gl.getShaderInfoLog(shader));
    gl.deleteShader(shader);
    return null;
  }

  return shader;
}

export function createProgram(
  gl: WebGL2RenderingContext,
  vertexSource: string,
  fragmentSource: string
): WebGLProgram | null {
  const vertexShader = compileShader(gl, gl.VERTEX_SHADER, vertexSource);
  const fragmentShader = compileShader(gl, gl.FRAGMENT_SHADER, fragmentSource);

  if (!vertexShader || !fragmentShader) {
    return null;
  }

  const program = gl.createProgram();
  if (!program) return null;

  gl.attachShader(program, vertexShader);
  gl.attachShader(program, fragmentShader);
  gl.linkProgram(program);

  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    console.error('Program link error:', gl.getProgramInfoLog(program));
    gl.deleteProgram(program);
    return null;
  }

  return program;
}

// ============================================================================
// Shader Program Factory
// ============================================================================

export function createShaderPrograms(gl: WebGL2RenderingContext): {
  mesh: WebGLProgram | null;
  tps: WebGLProgram | null;
  flow: WebGLProgram | null;
  crossfade: WebGLProgram | null;
} {
  return {
    mesh: createProgram(gl, meshVertexShader, meshFragmentShader),
    tps: createProgram(gl, fullscreenVertexShader, tpsFragmentShader),
    flow: createProgram(gl, fullscreenVertexShader, flowFragmentShader),
    crossfade: createProgram(gl, fullscreenVertexShader, crossfadeFragmentShader)
  };
}
