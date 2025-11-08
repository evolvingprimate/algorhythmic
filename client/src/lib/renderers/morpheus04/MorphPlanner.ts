/**
 * Morph Planner Module
 * Uses heuristic decision tree to choose optimal morphing strategy
 */

import type { ImageAnalysisResult, MorphPlan, MorphStage, MorphMode } from './types';

export class MorphPlanner {
  /**
   * Generate a morph plan based on image analysis metrics
   */
  plan(analysis: ImageAnalysisResult): MorphPlan {
    console.log('[MorphPlanner] Planning morph strategy...');

    const {
      inlierRatio,
      coverageScore,
      edgeOverlap,
      histogramDistance,
      inlierCount
    } = analysis;

    // Classify image pair relationship
    const isGeometricallyAligned = inlierRatio > 0.6 && inlierCount >= 10;
    const hasModerateAlignment = inlierRatio > 0.3 && inlierRatio <= 0.6;
    const hasGoodCoverage = coverageScore > 0.5;
    const hasStrongEdges = edgeOverlap > 0.4;
    const isSimilarColor = histogramDistance < 0.3;

    let stages: MorphStage[] = [];
    let reasoning = '';
    let confidence = 0;

    // ========================================================================
    // Decision Tree
    // ========================================================================

    if (isGeometricallyAligned && hasGoodCoverage) {
      // Case 1: Strong geometric correspondence → Multi-stage mesh + TPS
      reasoning = 'High geometric similarity with good spatial coverage. Using multi-stage mesh warping with TPS refinement for smooth, feature-aligned morphing.';
      confidence = 0.9;

      stages = [
        // Stage 1: Mesh warping (first 40% of morph)
        {
          mode: 'mesh',
          tStart: 0,
          tEnd: 0.4,
          triCount: 150,
          rigidity: 0.3,
          seamFeather: 2.0,
          dispAmp: 0.008,
          dispFreq: 1.5
        },
        // Stage 2: TPS for smooth mid-transition (40-70%)
        {
          mode: 'tps',
          tStart: 0.4,
          tEnd: 0.7,
          lambda: 0.02,
          seamFeather: 1.5,
          dispAmp: 0.006,
          dispFreq: 1.0
        },
        // Stage 3: Final crossfade (70-100%)
        {
          mode: 'crossfade',
          tStart: 0.7,
          tEnd: 1.0,
          seamFeather: 1.0,
          dispAmp: 0.003,
          dispFreq: 0.5
        }
      ];
    } else if (hasModerateAlignment && hasGoodCoverage) {
      // Case 2: Moderate alignment → Optical flow + crossfade
      reasoning = 'Moderate geometric similarity. Using optical flow for motion-based morphing with crossfade blend.';
      confidence = 0.75;

      stages = [
        // Stage 1: Optical flow (first 60%)
        {
          mode: 'flow',
          tStart: 0,
          tEnd: 0.6,
          flowWeight: 0.8,
          seamFeather: 2.5,
          dispAmp: 0.010,
          dispFreq: 2.0
        },
        // Stage 2: Crossfade (60-100%)
        {
          mode: 'crossfade',
          tStart: 0.6,
          tEnd: 1.0,
          seamFeather: 1.0,
          dispAmp: 0.004,
          dispFreq: 0.8
        }
      ];
    } else if (hasStrongEdges && !hasGoodCoverage) {
      // Case 3: Strong edges but poor coverage → Mesh with careful feathering
      reasoning = 'Strong structural features but limited match coverage. Using mesh warping with aggressive edge feathering.';
      confidence = 0.65;

      stages = [
        // Stage 1: Mesh with heavy feathering (first 50%)
        {
          mode: 'mesh',
          tStart: 0,
          tEnd: 0.5,
          triCount: 100,
          rigidity: 0.5,
          seamFeather: 3.0,
          dispAmp: 0.007,
          dispFreq: 1.2
        },
        // Stage 2: Crossfade (50-100%)
        {
          mode: 'crossfade',
          tStart: 0.5,
          tEnd: 1.0,
          seamFeather: 1.5,
          dispAmp: 0.005,
          dispFreq: 1.0
        }
      ];
    } else if (isSimilarColor && !isGeometricallyAligned) {
      // Case 4: Similar colors but different geometry → TPS or flow
      reasoning = 'Similar color distribution but different structure. Using TPS for smooth color-preserving morph.';
      confidence = 0.7;

      stages = [
        // Stage 1: TPS (first 70%)
        {
          mode: 'tps',
          tStart: 0,
          tEnd: 0.7,
          lambda: 0.03,
          seamFeather: 2.0,
          dispAmp: 0.009,
          dispFreq: 1.5
        },
        // Stage 2: Crossfade (70-100%)
        {
          mode: 'crossfade',
          tStart: 0.7,
          tEnd: 1.0,
          seamFeather: 1.0,
          dispAmp: 0.004,
          dispFreq: 0.7
        }
      ];
    } else if (inlierRatio > 0.15 && inlierCount >= 5) {
      // Case 5: Weak but present alignment → Simple flow or mesh
      reasoning = 'Weak geometric correspondence. Using simple optical flow for best-effort alignment.';
      confidence = 0.5;

      stages = [
        {
          mode: 'flow',
          tStart: 0,
          tEnd: 1.0,
          flowWeight: 0.6,
          seamFeather: 2.0,
          dispAmp: 0.008,
          dispFreq: 1.8
        }
      ];
    } else {
      // Case 6: No meaningful correspondence → Pure crossfade
      reasoning = 'No geometric correspondence found. Using simple crossfade transition.';
      confidence = 0.9; // High confidence in the decision, even if it's simple

      stages = [
        {
          mode: 'crossfade',
          tStart: 0,
          tEnd: 1.0,
          seamFeather: 1.0,
          dispAmp: 0.005,
          dispFreq: 1.0
        }
      ];
    }

    const plan: MorphPlan = {
      stages,
      reasoning,
      confidence
    };

    console.log('[MorphPlanner] Plan created:', {
      stages: plan.stages.length,
      modes: plan.stages.map(s => s.mode).join(' → '),
      confidence: plan.confidence.toFixed(2),
      reasoning: plan.reasoning.substring(0, 80) + '...'
    });

    return plan;
  }

  /**
   * Validate and adjust a morph plan
   */
  validatePlan(plan: MorphPlan): MorphPlan {
    const stages = [...plan.stages];

    // Ensure stages are sorted by tStart
    stages.sort((a, b) => a.tStart - b.tStart);

    // Ensure no gaps or overlaps
    for (let i = 0; i < stages.length - 1; i++) {
      const current = stages[i];
      const next = stages[i + 1];

      // Fix overlaps
      if (current.tEnd > next.tStart) {
        current.tEnd = next.tStart;
      }

      // Fix gaps
      if (current.tEnd < next.tStart) {
        current.tEnd = next.tStart;
      }
    }

    // Ensure first stage starts at 0
    if (stages.length > 0 && stages[0].tStart > 0) {
      stages[0].tStart = 0;
    }

    // Ensure last stage ends at 1
    if (stages.length > 0 && stages[stages.length - 1].tEnd < 1) {
      stages[stages.length - 1].tEnd = 1;
    }

    return {
      ...plan,
      stages
    };
  }

  /**
   * Get the active stage(s) for a given morph progress
   */
  getActiveStages(plan: MorphPlan, t: number): {
    current: MorphStage | null;
    next: MorphStage | null;
    blendFactor: number;
  } {
    t = Math.max(0, Math.min(1, t));

    let current: MorphStage | null = null;
    let next: MorphStage | null = null;
    let blendFactor = 0;

    // Find the stage(s) that contain t
    for (let i = 0; i < plan.stages.length; i++) {
      const stage = plan.stages[i];

      if (t >= stage.tStart && t <= stage.tEnd) {
        current = stage;

        // Check if we're near the end and should blend with next stage
        const stageProgress = (t - stage.tStart) / (stage.tEnd - stage.tStart);
        const blendZone = 0.2; // Blend over last 20% of stage

        if (stageProgress > (1 - blendZone) && i < plan.stages.length - 1) {
          next = plan.stages[i + 1];
          blendFactor = (stageProgress - (1 - blendZone)) / blendZone;
        }

        break;
      }
    }

    // Fallback: if no stage found, use last stage
    if (!current && plan.stages.length > 0) {
      current = plan.stages[plan.stages.length - 1];
    }

    return { current, next, blendFactor };
  }

  /**
   * Get a simple description of the plan for debugging
   */
  describePlan(plan: MorphPlan): string {
    const stageDesc = plan.stages.map((stage, i) => {
      const duration = ((stage.tEnd - stage.tStart) * 100).toFixed(0);
      return `${i + 1}. ${stage.mode} (${duration}%)`;
    }).join(', ');

    return `${plan.stages.length} stages: ${stageDesc}. ${plan.reasoning}`;
  }
}
