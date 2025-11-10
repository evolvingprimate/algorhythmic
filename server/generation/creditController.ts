/**
 * Credit Controller - Intelligent Fresh vs Library Titration
 * 
 * Implements logistic surplus algorithm with hysteresis to optimize:
 * - Credit burn rate across monthly billing cycle
 * - User experience (no hard cutoffs, smooth transitions)
 * - System cost (prefer library when credits abundant, fresh when scarce)
 * 
 * Algorithm: S = remaining - (daily_target × days_left)
 * - S > 0: Surplus → nudge toward library
 * - S < 0: Deficit → nudge toward fresh
 * - S ≈ 0: Balanced → proportional mix
 */

import type { IStorage } from "../storage";
import type { UserCredits } from "@shared/schema";
import { SUBSCRIPTION_TIERS } from "@shared/schema";

// ==================== TYPES ====================

export interface ControllerState {
  lastMode: 'fresh' | 'library' | null;
  sessionFreshCount: number;
  sessionStartedAt: number; // Unix timestamp
  hysteresisThreshold: number; // Dynamic threshold to prevent flip-flopping
}

export interface TitrationDecision {
  mode: 'fresh' | 'library';
  reason: string;
  probability: number; // Fresh probability (0-1)
  metadata: {
    surplusDays: number;
    daysRemaining: number;
    creditsRemaining: number;
    dailyTarget: number;
    sessionFreshCount: number;
    sessionCap: number;
    coverageOk: boolean;
  };
}

export interface CatalogCoverage {
  totalLibrary: number;
  unseenCount: number;
  unseenRatio: number;
  distinctStyles: number;
}

// ==================== CONFIGURATION ====================

const CONFIG = {
  // Session limits
  SESSION_CAP: {
    free: 1,         // Max 1 fresh per session for free users
    basic: 3,        // Max 3 fresh per session for basic
    pro: 5,          // Max 5 fresh per session for pro
    premium: 10,     // Max 10 fresh per session for premium
  },
  SESSION_DURATION_MS: 5 * 60 * 1000, // 5 minutes

  // Logistic function parameters
  LOGISTIC_STEEPNESS: 0.3,  // Controls how sharply probability changes
  LOGISTIC_MIDPOINT: 3,     // Surplus days where P(fresh) = 0.5

  // Hysteresis parameters
  HYSTERESIS_INITIAL: 0.1,  // Initial threshold (10%)
  HYSTERESIS_MAX: 0.25,     // Max threshold (25%)
  HYSTERESIS_DECAY: 0.95,   // Decay factor per decision

  // Coverage thresholds (when library is insufficient)
  MIN_UNSEEN_FRAMES: 60,
  MIN_DISTINCT_STYLES: 5,
  MIN_UNSEEN_RATIO: 0.30,
};

// ==================== CREDIT CONTROLLER ====================

export class CreditController {
  constructor(private storage: IStorage) {}

  /**
   * Main decision function: Should we generate fresh artwork or use library?
   */
  async decideFreshOrLibrary(
    userId: string,
    orientation: 'portrait' | 'landscape' | 'square',
    tier: string = 'free',
    forceMode?: 'fresh' | 'library'
  ): Promise<TitrationDecision> {
    // 1. Fetch credits context
    const creditsCtx = await this.storage.getCreditsContext(userId);
    if (!creditsCtx) {
      throw new Error(`No credit account found for user ${userId}`);
    }

    // 2. Check catalog coverage
    const coverage = await this.storage.getCatalogCoverage(
      userId,
      orientation
    );

    // 3. Load/initialize controller state
    const user = await this.storage.getUser(userId);
    let state = this.parseControllerState(user?.controllerState || null);

    // 4. Check session reset
    state = this.checkSessionReset(state);

    // 5. Safeguard: Handle end-of-cycle (daysRemaining ≤ 0)
    if (creditsCtx.daysRemaining <= 0) {
      // Force library at end of cycle to preserve remaining credits
      const decision = this.buildDecision('library', creditsCtx, coverage, state, tier, 
        'End of billing cycle - forcing library mode');
      await this.saveControllerState(userId, state);
      return decision;
    }

    // 6. Force mode override (for testing or explicit user requests)
    if (forceMode) {
      const decision = this.buildDecision(forceMode, creditsCtx, coverage, state, tier, `Forced mode: ${forceMode}`);
      if (forceMode === 'fresh') state.sessionFreshCount++;
      state.lastMode = forceMode;
      await this.saveControllerState(userId, state);
      return decision;
    }

    // 7. Check coverage guardrails (force fresh if library inadequate)
    if (!this.isCoverageAdequate(coverage)) {
      state.sessionFreshCount++;
      state.lastMode = 'fresh';
      const decision = this.buildDecision('fresh', creditsCtx, coverage, state, tier, 
        `Coverage inadequate: ${coverage.unseenCount} unseen frames (need ${CONFIG.MIN_UNSEEN_FRAMES})`);
      await this.saveControllerState(userId, state);
      return decision;
    }

    // 8. Check session cap (force library if cap reached)
    const sessionCap = CONFIG.SESSION_CAP[tier as keyof typeof CONFIG.SESSION_CAP] || CONFIG.SESSION_CAP.free;
    if (state.sessionFreshCount >= sessionCap) {
      state.lastMode = 'library';
      const decision = this.buildDecision('library', creditsCtx, coverage, state, tier,
        `Session cap reached: ${state.sessionFreshCount}/${sessionCap}`);
      await this.saveControllerState(userId, state);
      return decision;
    }

    // 9. Calculate surplus days using ACTUAL daily target from tier
    const surplusDays = this.calculateSurplus(creditsCtx, tier);

    // 10. Apply logistic function with hysteresis
    const decision = this.applyLogisticWithHysteresis(surplusDays, state);

    // 11. Update state
    if (decision.mode === 'fresh') {
      state.sessionFreshCount++;
    }
    state.lastMode = decision.mode;
    state.hysteresisThreshold *= CONFIG.HYSTERESIS_DECAY;
    await this.saveControllerState(userId, state);

    return this.buildDecision(decision.mode, creditsCtx, coverage, state, tier, decision.reason);
  }

  /**
   * Calculate surplus days: S = (remaining - target × days_left) / target
   * Normalized to "days" for tier-invariant logistic function
   */
  private calculateSurplus(ctx: {
    balance: number;
    baseQuota: number;
    daysRemaining: number;
  }, tier: string): number {
    // Calculate daily target from base quota (30-day billing cycle)
    const dailyTarget = Math.max(ctx.baseQuota / 30, 0.1); // Guard against zero
    
    // Raw surplus in credits
    const rawSurplus = ctx.balance - (dailyTarget * ctx.daysRemaining);
    
    // Normalize to days: divide by daily target
    // S > 0: ahead of pace by N days (prefer library)
    // S < 0: behind pace by N days (prefer fresh)
    // S ≈ 0: on pace (balanced mix)
    // 
    // Example: Free tier (90 credits/month, 15 days left, 50 remaining)
    //   dailyTarget = 3, rawSurplus = 50 - (3×15) = 5 credits
    //   surplusDays = 5 / 3 = 1.67 days ahead
    return rawSurplus / dailyTarget;
  }

  /**
   * Logistic function: P(fresh) = 1 / (1 + e^(k × (S - S₀)))
   * - S > S₀: Surplus → P(fresh) < 0.5 → prefer library
   * - S < S₀: Deficit → P(fresh) > 0.5 → prefer fresh
   */
  private applyLogisticWithHysteresis(
    surplusDays: number,
    state: ControllerState
  ): { mode: 'fresh' | 'library'; reason: string; probability: number } {
    // Calculate raw probability
    const exponent = CONFIG.LOGISTIC_STEEPNESS * (surplusDays - CONFIG.LOGISTIC_MIDPOINT);
    const freshProb = 1 / (1 + Math.exp(exponent));

    // Apply hysteresis to prevent flip-flopping
    let mode: 'fresh' | 'library';
    let reason: string;

    if (state.lastMode === null) {
      // First decision: use raw probability
      mode = Math.random() < freshProb ? 'fresh' : 'library';
      reason = `Initial decision: P(fresh)=${freshProb.toFixed(2)}, surplus=${surplusDays.toFixed(1)}d`;
    } else {
      // Subsequent decisions: require crossing hysteresis threshold
      const switchThreshold = state.lastMode === 'fresh' 
        ? freshProb - state.hysteresisThreshold  // Harder to switch away from fresh
        : freshProb + state.hysteresisThreshold; // Harder to switch away from library

      if (state.lastMode === 'fresh' && freshProb < switchThreshold) {
        mode = 'library';
        reason = `Switched to library: P(fresh)=${freshProb.toFixed(2)} crossed threshold ${switchThreshold.toFixed(2)}`;
        state.hysteresisThreshold = Math.min(CONFIG.HYSTERESIS_MAX, state.hysteresisThreshold * 1.2); // Increase threshold
      } else if (state.lastMode === 'library' && freshProb > switchThreshold) {
        mode = 'fresh';
        reason = `Switched to fresh: P(fresh)=${freshProb.toFixed(2)} crossed threshold ${switchThreshold.toFixed(2)}`;
        state.hysteresisThreshold = Math.min(CONFIG.HYSTERESIS_MAX, state.hysteresisThreshold * 1.2); // Increase threshold
      } else {
        mode = state.lastMode;
        reason = `Maintained ${mode}: P(fresh)=${freshProb.toFixed(2)}, hysteresis=${state.hysteresisThreshold.toFixed(2)}`;
      }
    }

    return { mode, reason, probability: freshProb };
  }

  /**
   * Check if catalog coverage meets minimum thresholds
   */
  private isCoverageAdequate(coverage: CatalogCoverage): boolean {
    return (
      coverage.unseenCount >= CONFIG.MIN_UNSEEN_FRAMES &&
      coverage.distinctStyles >= CONFIG.MIN_DISTINCT_STYLES &&
      coverage.unseenRatio >= CONFIG.MIN_UNSEEN_RATIO
    );
  }

  /**
   * Parse controller state from JSON string
   */
  private parseControllerState(stateJson: string | null): ControllerState {
    if (!stateJson) {
      return {
        lastMode: null,
        sessionFreshCount: 0,
        sessionStartedAt: Date.now(),
        hysteresisThreshold: CONFIG.HYSTERESIS_INITIAL,
      };
    }

    try {
      return JSON.parse(stateJson) as ControllerState;
    } catch (e) {
      console.error('[CreditController] Failed to parse state:', e);
      return {
        lastMode: null,
        sessionFreshCount: 0,
        sessionStartedAt: Date.now(),
        hysteresisThreshold: CONFIG.HYSTERESIS_INITIAL,
      };
    }
  }

  /**
   * Check if session has expired and reset if needed
   */
  private checkSessionReset(state: ControllerState): ControllerState {
    const now = Date.now();
    const elapsed = now - state.sessionStartedAt;

    if (elapsed > CONFIG.SESSION_DURATION_MS) {
      return {
        ...state,
        sessionFreshCount: 0,
        sessionStartedAt: now,
      };
    }

    return state;
  }

  /**
   * Save controller state to database
   */
  private async saveControllerState(userId: string, state: ControllerState): Promise<void> {
    const user = await this.storage.getUser(userId);
    if (!user) {
      throw new Error(`User ${userId} not found`);
    }

    await this.storage.upsertUser({
      id: userId,
      controllerState: JSON.stringify(state),
    });
  }

  /**
   * Build final decision object
   */
  private buildDecision(
    mode: 'fresh' | 'library',
    creditsCtx: { balance: number; baseQuota: number; daysRemaining: number },
    coverage: CatalogCoverage,
    state: ControllerState,
    tier: string,
    reason: string
  ): TitrationDecision {
    const dailyTarget = creditsCtx.baseQuota / 30; // Use base quota for daily target
    const surplusDays = this.calculateSurplus(creditsCtx, tier);
    const sessionCap = CONFIG.SESSION_CAP[tier as keyof typeof CONFIG.SESSION_CAP] || CONFIG.SESSION_CAP.free;

    // Calculate raw probability for metadata
    const exponent = CONFIG.LOGISTIC_STEEPNESS * (surplusDays - CONFIG.LOGISTIC_MIDPOINT);
    const freshProb = 1 / (1 + Math.exp(exponent));

    return {
      mode,
      reason,
      probability: freshProb,
      metadata: {
        surplusDays,
        daysRemaining: creditsCtx.daysRemaining,
        creditsRemaining: creditsCtx.balance,
        dailyTarget,
        sessionFreshCount: state.sessionFreshCount,
        sessionCap,
        coverageOk: this.isCoverageAdequate(coverage),
      },
    };
  }

  /**
   * Utility: Get recommended daily target for tier
   */
  static getDailyTarget(tier: keyof typeof SUBSCRIPTION_TIERS): number {
    const dailyLimit = SUBSCRIPTION_TIERS[tier].dailyLimit;
    return dailyLimit; // Return daily limit directly
  }

  /**
   * Utility: Format decision for logging
   */
  static formatDecision(decision: TitrationDecision): string {
    return `[CreditController] ${decision.mode.toUpperCase()}: ${decision.reason} | ` +
           `Credits: ${decision.metadata.creditsRemaining} (${decision.metadata.surplusDays.toFixed(1)}d surplus) | ` +
           `Session: ${decision.metadata.sessionFreshCount}/${decision.metadata.sessionCap} | ` +
           `Coverage: ${decision.metadata.coverageOk ? 'OK' : 'INADEQUATE'}`;
  }
}
