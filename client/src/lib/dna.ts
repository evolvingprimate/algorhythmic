export type DNAVector = number[];

export interface DNAFrame {
  imageUrl: string;
  dnaVector: DNAVector;
  prompt: string;
  explanation: string;
  artworkId: string | null;
  musicInfo: any;
  audioAnalysis: any;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function easeInOutSine(t: number): number {
  return -(Math.cos(Math.PI * t) - 1) / 2;
}

export function easeInOutCubic(t: number): number {
  return t < 0.5
    ? 4 * t * t * t
    : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

export function interpolateDNA(
  dnaA: DNAVector,
  dnaB: DNAVector,
  progress: number,
  easeFunc: (t: number) => number = easeInOutSine
): DNAVector {
  if (dnaA.length !== 50 || dnaB.length !== 50) {
    console.warn(`Invalid DNA vectors: A=${dnaA.length}, B=${dnaB.length}. Expected 50 points.`);
    return dnaA.length === 50 ? dnaA : dnaB.length === 50 ? dnaB : Array(50).fill(0.5);
  }

  const easedProgress = easeFunc(Math.max(0, Math.min(1, progress)));
  const result: number[] = [];

  for (let i = 0; i < 44; i++) {
    result.push(lerp(dnaA[i], dnaB[i], easedProgress));
  }

  for (let i = 44; i < 50; i++) {
    result.push(dnaA[i]);
  }

  return result;
}

function clampDNAValue(value: number): number {
  return Math.max(0, Math.min(3, value));
}

export function applyAudioReactivity(
  dna: DNAVector,
  audioAnalysis: {
    bassLevel: number;
    amplitude: number;
    tempo: number;
    trebleLevel: number;
  }
): DNAVector {
  if (dna.length !== 50) {
    console.warn(`Invalid DNA vector for audio reactivity: ${dna.length} points`);
    return dna;
  }

  const modifiedDNA = [...dna];

  const bassIntensity = Math.min(audioAnalysis.bassLevel / 100, 1);
  const amplitudeNorm = Math.min(audioAnalysis.amplitude / 100, 1);
  const trebleIntensity = Math.min(audioAnalysis.trebleLevel / 100, 1);
  const tempoFactor = Math.min(audioAnalysis.tempo / 200, 1.5);

  modifiedDNA[44] = clampDNAValue(dna[44] * (1 + bassIntensity * 0.5));
  modifiedDNA[45] = clampDNAValue(dna[45] * (1 + amplitudeNorm * 0.4));
  modifiedDNA[46] = clampDNAValue(dna[46] * tempoFactor);
  
  const midFrequencyDecay = (bassIntensity + trebleIntensity) / 2;
  modifiedDNA[47] = clampDNAValue(dna[47] * (1 + midFrequencyDecay * 0.3));
  
  modifiedDNA[48] = clampDNAValue(dna[48] * (1 + trebleIntensity * 0.4));
  modifiedDNA[49] = clampDNAValue(dna[49] * (1 + amplitudeNorm * 0.2));

  return modifiedDNA;
}

export function getDNACategory(dna: DNAVector, category: 'color' | 'texture' | 'composition' | 'mood' | 'morph'): number[] {
  const ranges = {
    color: [0, 12],
    texture: [12, 24],
    composition: [24, 34],
    mood: [34, 44],
    morph: [44, 50]
  };

  const [start, end] = ranges[category];
  return dna.slice(start, end);
}

export function parseDNAFromSession(session: any): DNAVector | null {
  if (!session?.dnaVector) return null;
  
  try {
    const parsed = typeof session.dnaVector === 'string' 
      ? JSON.parse(session.dnaVector)
      : session.dnaVector;
      
    if (Array.isArray(parsed) && parsed.length === 50) {
      return parsed;
    }
    
    console.warn(`Invalid DNA vector in session: expected 50 points, got ${parsed?.length || 0}`);
    return null;
  } catch (e) {
    console.error('Failed to parse DNA vector from session:', e);
    return null;
  }
}
