import type { ArtSession } from "@shared/schema";

export interface CatalogMatchRequest {
  userId: string;
  styleTags: string[];
  audioMeta?: {
    tempo?: number;
    energy?: number;
    mood?: string;
  };
  trackId?: string;
}

export interface CatalogMatchResult {
  type: 'catalog' | 'procedural';
  artwork?: ArtSession;
  score?: number;
}

const dnaCache = new Map<string, Float32Array>();

function parseDNA(dnaString: string | null): Float32Array | null {
  if (!dnaString) return null;
  
  if (dnaCache.has(dnaString)) {
    return dnaCache.get(dnaString)!;
  }

  try {
    const dnaArray = JSON.parse(dnaString);
    const float32 = new Float32Array(dnaArray);
    
    if (dnaCache.size > 1000) {
      const firstKey = dnaCache.keys().next().value;
      dnaCache.delete(firstKey);
    }
    
    dnaCache.set(dnaString, float32);
    return float32;
  } catch (e) {
    console.error('[CatalogMatcher] Failed to parse DNA:', e);
    return null;
  }
}

function cosineSimilarity(vecA: Float32Array, vecB: Float32Array): number {
  if (vecA.length !== vecB.length) return 0;

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < vecA.length; i++) {
    dotProduct += vecA[i] * vecB[i];
    normA += vecA[i] * vecA[i];
    normB += vecB[i] * vecB[i];
  }

  const denominator = Math.sqrt(normA) * Math.sqrt(normB);
  if (denominator === 0) return 0;

  return dotProduct / denominator;
}

function calculateTagOverlap(artworkMotifs: string[] | null, requestedTags: string[]): number {
  if (!artworkMotifs || artworkMotifs.length === 0) return 0;
  if (requestedTags.length === 0) return 0;

  const artworkSet = new Set(artworkMotifs.map(m => m.toLowerCase()));
  const requestedSet = new Set(requestedTags.map(t => t.toLowerCase()));

  const intersection = [...artworkSet].filter(tag => requestedSet.has(tag));
  const union = new Set([...artworkSet, ...requestedSet]);

  return intersection.length / union.size;
}

export function findBestCatalogMatch(
  candidates: ArtSession[],
  request: CatalogMatchRequest,
  targetDNA?: Float32Array | null
): CatalogMatchResult {
  if (candidates.length === 0) {
    return { type: 'procedural' };
  }

  let bestMatch: ArtSession | null = null;
  let bestScore = -1;

  for (const candidate of candidates) {
    let score = 0;

    const tagOverlap = calculateTagOverlap(candidate.motifs, request.styleTags);
    score += tagOverlap * 0.4;

    if (targetDNA && candidate.dnaVector) {
      const candidateDNA = parseDNA(candidate.dnaVector);
      if (candidateDNA) {
        const dnaSimilarity = cosineSimilarity(targetDNA, candidateDNA);
        score += dnaSimilarity * 0.6;
      }
    } else {
      score += tagOverlap * 0.6;
    }

    if (score > bestScore) {
      bestScore = score;
      bestMatch = candidate;
    }
  }

  if (bestMatch && bestScore > 0.3) {
    return {
      type: 'catalog',
      artwork: bestMatch,
      score: bestScore
    };
  }

  return { type: 'procedural' };
}
