export { EngineRegistry } from './EngineRegistry';
export { Morpheus01Renderer } from './Morpheus01Renderer';
export { Morpheus02Renderer } from './Morpheus02Renderer';
export { Morpheus03Renderer } from './Morpheus03Renderer';
export { Morpheus04Renderer } from './Morpheus04Renderer';
export type { IMorphRenderer, RenderContext, RendererMetadata } from './types';

import { EngineRegistry } from './EngineRegistry';
import { Morpheus01Renderer } from './Morpheus01Renderer';
import { Morpheus02Renderer } from './Morpheus02Renderer';
import { Morpheus03Renderer } from './Morpheus03Renderer';
import { Morpheus04Renderer } from './Morpheus04Renderer';

const registry = EngineRegistry.getInstance();
registry.register('morpheus_0.1', Morpheus01Renderer);
registry.register('morpheus_0.2', Morpheus02Renderer);
registry.register('morpheus_0.3', Morpheus03Renderer);
registry.register('morpheus_0.4', Morpheus04Renderer);

console.log('[EngineRegistry] Registered all engines');
