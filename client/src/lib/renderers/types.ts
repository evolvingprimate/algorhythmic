import type { MorphState } from '../morphEngine';
import type { AudioAnalysis } from '@shared/schema';

export interface RenderContext {
  gl: WebGL2RenderingContext;
  canvas: HTMLCanvasElement;
  frameA: {
    texture: WebGLTexture;
    imageData: HTMLImageElement;
  };
  frameB: {
    texture: WebGLTexture;
    imageData: HTMLImageElement;
  };
  morphState: MorphState;
  audioAnalysis?: AudioAnalysis;
  time: number;
  // Maestro parameter store (Phase 2)
  parameters?: Map<string, number | number[] | boolean | string>;
}

export interface IMorphRenderer {
  readonly name: string;
  readonly version: string;
  readonly description: string;
  
  initialize(gl: WebGL2RenderingContext): void;
  render(context: RenderContext): void;
  destroy(): void;
}

export interface RendererMetadata {
  name: string;
  version: string;
  description: string;
  family: string;
}
