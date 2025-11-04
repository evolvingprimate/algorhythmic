import type { AudioAnalysis } from "@shared/schema";

export class AudioAnalyzer {
  private audioContext: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private microphone: MediaStreamAudioSourceNode | null = null;
  private dataArray: Uint8Array | null = null;
  private rafId: number | null = null;
  private onAnalysis: ((analysis: AudioAnalysis) => void) | null = null;

  async initialize(onAnalysisCallback: (analysis: AudioAnalysis) => void): Promise<void> {
    this.onAnalysis = onAnalysisCallback;

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      
      this.audioContext = new AudioContext();
      this.analyser = this.audioContext.createAnalyser();
      this.analyser.fftSize = 2048;
      
      this.microphone = this.audioContext.createMediaStreamSource(stream);
      this.microphone.connect(this.analyser);
      
      const bufferLength = this.analyser.frequencyBinCount;
      this.dataArray = new Uint8Array(bufferLength);
      
      this.startAnalysis();
    } catch (error) {
      console.error("Error accessing microphone:", error);
      throw new Error("Could not access microphone. Please grant permission.");
    }
  }

  private startAnalysis(): void {
    if (!this.analyser || !this.dataArray || !this.onAnalysis) return;

    const analyze = () => {
      if (!this.analyser || !this.dataArray) return;

      this.analyser.getByteFrequencyData(this.dataArray);
      
      // Calculate audio characteristics
      const average = this.dataArray.reduce((a, b) => a + b, 0) / this.dataArray.length;
      const amplitude = (average / 255) * 100;
      
      // Bass (low frequencies)
      const bassRange = this.dataArray.slice(0, Math.floor(this.dataArray.length * 0.2));
      const bassLevel = (bassRange.reduce((a, b) => a + b, 0) / bassRange.length / 255) * 100;
      
      // Treble (high frequencies)
      const trebleRange = this.dataArray.slice(Math.floor(this.dataArray.length * 0.7));
      const trebleLevel = (trebleRange.reduce((a, b) => a + b, 0) / trebleRange.length / 255) * 100;
      
      // Estimate tempo from amplitude variations
      const tempo = this.estimateTempo(amplitude);
      
      // Determine dominant frequency
      const maxIndex = this.dataArray.indexOf(Math.max(...Array.from(this.dataArray)));
      const frequency = (maxIndex * this.audioContext!.sampleRate) / this.analyser.fftSize;
      
      // Determine mood based on characteristics
      const mood = this.determineMood(amplitude, bassLevel, trebleLevel, tempo);
      
      const analysis: AudioAnalysis = {
        frequency,
        amplitude,
        tempo,
        bassLevel,
        trebleLevel,
        mood,
      };
      
      this.onAnalysis(analysis);
      
      this.rafId = requestAnimationFrame(analyze);
    };
    
    analyze();
  }

  private estimateTempo(amplitude: number): number {
    // Simple tempo estimation based on amplitude
    // In a production app, this would use beat detection algorithms
    if (amplitude > 60) return 140; // Fast/energetic
    if (amplitude > 30) return 110; // Moderate
    return 80; // Slow/calm
  }

  private determineMood(
    amplitude: number,
    bassLevel: number,
    trebleLevel: number,
    tempo: number
  ): AudioAnalysis["mood"] {
    // Simple mood classification based on audio characteristics
    if (amplitude > 60 && tempo > 120) return "energetic";
    if (amplitude < 30 && tempo < 90) return "calm";
    if (bassLevel > 50 && amplitude > 40) return "dramatic";
    if (trebleLevel > 50 && tempo > 100) return "playful";
    return "melancholic";
  }

  stop(): void {
    if (this.rafId) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    
    if (this.microphone) {
      this.microphone.disconnect();
      this.microphone = null;
    }
    
    if (this.audioContext) {
      this.audioContext.close();
      this.audioContext = null;
    }
  }

  getAudioLevel(): number {
    if (!this.analyser || !this.dataArray) return 0;
    this.analyser.getByteFrequencyData(this.dataArray);
    const average = this.dataArray.reduce((a, b) => a + b, 0) / this.dataArray.length;
    return (average / 255) * 100;
  }
}
