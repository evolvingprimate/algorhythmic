#!/usr/bin/env tsx
/**
 * Emergency script to reset the DALL-E circuit breaker
 */

import { generationHealthService } from '../server/generation-health';

console.log('[CircuitBreaker] Getting current status...');
const initialStatus = generationHealthService.getDetailedStatus();
console.log('[CircuitBreaker] Initial state:', {
  state: initialStatus.state,
  tokens: initialStatus.tokens,
  openUntil: initialStatus.openUntil
});

console.log('[CircuitBreaker] Resetting circuit breaker...');
const previousState = generationHealthService.forceClosed();

const newStatus = generationHealthService.getDetailedStatus();
console.log('[CircuitBreaker] Reset complete!');
console.log('[CircuitBreaker] Previous state:', previousState);
console.log('[CircuitBreaker] New state:', {
  state: newStatus.state,
  tokens: newStatus.tokens,
  openUntil: newStatus.openUntil
});