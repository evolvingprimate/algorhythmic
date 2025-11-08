export { EngineRegistry } from './EngineRegistry';
export { Morpheus01Renderer } from './Morpheus01Renderer';
export { Morpheus02Renderer } from './Morpheus02Renderer';
export type { IMorphRenderer, RenderContext, RendererMetadata } from './types';

import { EngineRegistry } from './EngineRegistry';
import { Morpheus01Renderer } from './Morpheus01Renderer';
import { Morpheus02Renderer } from './Morpheus02Renderer';

const registry = EngineRegistry.getInstance();
registry.register('morpheus_0.1', Morpheus01Renderer);
registry.register('morpheus_0.2', Morpheus02Renderer);

console.log('[EngineRegistry] Registered all engines');
