import type { IMorphRenderer, RendererMetadata } from './types';

export class EngineRegistry {
  private static instance: EngineRegistry;
  private engines: Map<string, new () => IMorphRenderer> = new Map();
  
  private constructor() {}
  
  static getInstance(): EngineRegistry {
    if (!EngineRegistry.instance) {
      EngineRegistry.instance = new EngineRegistry();
    }
    return EngineRegistry.instance;
  }
  
  register(key: string, engine: new () => IMorphRenderer): void {
    this.engines.set(key, engine);
    console.log(`[EngineRegistry] Registered: ${key}`);
  }
  
  create(key: string): IMorphRenderer | null {
    const EngineClass = this.engines.get(key);
    if (!EngineClass) {
      console.error(`[EngineRegistry] Engine not found: ${key}`);
      return null;
    }
    return new EngineClass();
  }
  
  listEngines(): RendererMetadata[] {
    const metadata: RendererMetadata[] = [];
    
    for (const [key, EngineClass] of Array.from(this.engines.entries())) {
      const instance = new EngineClass();
      metadata.push({
        name: key,
        version: instance.version,
        description: instance.description,
        family: key.split('_')[0],
      });
    }
    
    return metadata;
  }
  
  getDefaultEngine(): string {
    // Morpheus 0.5: Fully Maestro-controlled renderer with audio-reactive effects
    // All visual parameters driven by Maestro commands (mixer, warp, particles)
    return 'morpheus_0.5';
  }
}
