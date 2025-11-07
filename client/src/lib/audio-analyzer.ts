import type { AudioAnalysis } from "@shared/schema";

export interface AudioDevice {
  deviceId: string;
  label: string;
  groupId: string;
}

export class AudioAnalyzer {
  private audioContext: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private microphone: MediaStreamAudioSourceNode | null = null;
  private mediaStream: MediaStream | null = null;
  private dataArray: Uint8Array | null = null;
  private rafId: number | null = null;
  private onAnalysis: ((analysis: AudioAnalysis) => void) | null = null;
  
  // G-Force-style exponential smoothing with attack/decay envelopes
  private smoothedBass: number = 0;
  private smoothedMids: number = 0;
  private smoothedTreble: number = 0;
  private smoothedAmplitude: number = 0;
  private readonly ATTACK_ALPHA = 0.3;  // Fast attack (responsive)
  private readonly DECAY_ALPHA = 0.1;    // Slow decay (smooth)

  static async enumerateDevices(): Promise<AudioDevice[]> {
    try {
      // Request initial permission to get device labels
      const tempStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      tempStream.getTracks().forEach(track => track.stop());

      const devices = await navigator.mediaDevices.enumerateDevices();
      return devices
        .filter(device => device.kind === 'audioinput')
        .map(device => ({
          deviceId: device.deviceId,
          label: device.label || `Microphone ${device.deviceId.slice(0, 8)}`,
          groupId: device.groupId,
        }));
    } catch (error) {
      console.error("Error enumerating audio devices:", error);
      throw new Error("Could not access microphone. Please grant permission.");
    }
  }

  async initialize(
    onAnalysisCallback: (analysis: AudioAnalysis) => void,
    deviceId?: string
  ): Promise<void> {
    this.onAnalysis = onAnalysisCallback;

    try {
      const constraints: MediaStreamConstraints = {
        audio: deviceId ? { deviceId: { exact: deviceId } } : true
      };
      
      this.mediaStream = await navigator.mediaDevices.getUserMedia(constraints);
      
      this.audioContext = new AudioContext();
      this.analyser = this.audioContext.createAnalyser();
      this.analyser.fftSize = 2048;
      
      this.microphone = this.audioContext.createMediaStreamSource(this.mediaStream);
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
      
      // Calculate raw audio characteristics
      const average = this.dataArray.reduce((a, b) => a + b, 0) / this.dataArray.length;
      const rawAmplitude = (average / 255) * 100;
      
      // Bass (low frequencies: 20Hz - 250Hz, roughly first 10% of spectrum)
      const bassRange = this.dataArray.slice(0, Math.floor(this.dataArray.length * 0.1));
      const rawBass = (bassRange.reduce((a, b) => a + b, 0) / bassRange.length / 255) * 100;
      
      // Mids (mid frequencies: 250Hz - 4000Hz, roughly 10% - 50% of spectrum)
      const midsRange = this.dataArray.slice(
        Math.floor(this.dataArray.length * 0.1), 
        Math.floor(this.dataArray.length * 0.5)
      );
      const rawMids = (midsRange.reduce((a, b) => a + b, 0) / midsRange.length / 255) * 100;
      
      // Treble/Highs (high frequencies: 4000Hz+, roughly last 50% of spectrum)
      const trebleRange = this.dataArray.slice(Math.floor(this.dataArray.length * 0.5));
      const rawTreble = (trebleRange.reduce((a, b) => a + b, 0) / trebleRange.length / 255) * 100;
      
      // Apply G-Force-style exponential smoothing with attack/decay envelopes
      // Fast attack when value increases, slow decay when value decreases
      this.smoothedBass = this.applySmoothing(this.smoothedBass, rawBass);
      this.smoothedMids = this.applySmoothing(this.smoothedMids, rawMids);
      this.smoothedTreble = this.applySmoothing(this.smoothedTreble, rawTreble);
      this.smoothedAmplitude = this.applySmoothing(this.smoothedAmplitude, rawAmplitude);
      
      const bassLevel = this.smoothedBass;
      const midsLevel = this.smoothedMids;
      const trebleLevel = this.smoothedTreble;
      const amplitude = this.smoothedAmplitude;
      
      // Estimate tempo from amplitude variations
      const tempo = this.estimateTempo(amplitude);
      
      // Determine dominant frequency
      const maxIndex = this.dataArray.indexOf(Math.max(...Array.from(this.dataArray)));
      const frequency = (maxIndex * this.audioContext!.sampleRate) / this.analyser.fftSize;
      
      // Determine mood based on characteristics
      const mood = this.determineMood(amplitude, bassLevel, trebleLevel, tempo);
      
      const analysis: AudioAnalysis = {
        frequency,
        amplitude: midsLevel, // Use mids for overall amplitude
        tempo,
        bassLevel,
        trebleLevel,
        mood,
      };
      
      if (this.onAnalysis) {
        this.onAnalysis(analysis);
      }
      
      this.rafId = requestAnimationFrame(analyze);
    };
    
    analyze();
  }

  private applySmoothing(smoothed: number, raw: number): number {
    // G-Force-style exponential smoothing with attack/decay envelopes
    // Fast attack when value increases, slow decay when value decreases
    const alpha = raw > smoothed ? this.ATTACK_ALPHA : this.DECAY_ALPHA;
    return alpha * raw + (1 - alpha) * smoothed;
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
    // Improved mood classification for better genre detection
    // Hip-hop/rap: High bass, moderate-to-high amplitude
    if (bassLevel > 40 && amplitude > 25) return "energetic";
    
    // Very high energy music
    if (amplitude > 50 && tempo > 120) return "energetic";
    
    // Bass-heavy dramatic music (electronic, dubstep, trap)
    if (bassLevel > 45) return "dramatic";
    
    // Calm/quiet music
    if (amplitude < 20 && tempo < 90) return "calm";
    
    // Bright, upbeat music (pop, dance)
    if (trebleLevel > 40 && tempo > 100) return "playful";
    
    // Medium energy
    if (amplitude > 30) return "energetic";
    
    return "melancholic";
  }

  stop(): void {
    if (this.rafId) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    
    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach(track => track.stop());
      this.mediaStream = null;
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

  async captureAudioSample(durationMs: number = 5000): Promise<Blob | null> {
    if (!this.mediaStream) {
      console.warn("No media stream available for audio capture");
      return null;
    }

    try {
      const mediaRecorder = new MediaRecorder(this.mediaStream, {
        mimeType: 'audio/webm',
      });

      const chunks: Blob[] = [];

      return new Promise((resolve, reject) => {
        mediaRecorder.ondataavailable = (event) => {
          if (event.data.size > 0) {
            chunks.push(event.data);
          }
        };

        mediaRecorder.onstop = () => {
          const audioBlob = new Blob(chunks, { type: 'audio/webm' });
          resolve(audioBlob);
        };

        mediaRecorder.onerror = (error) => {
          console.error("MediaRecorder error:", error);
          reject(error);
        };

        mediaRecorder.start();

        setTimeout(() => {
          if (mediaRecorder.state === 'recording') {
            mediaRecorder.stop();
          }
        }, durationMs);
      });
    } catch (error) {
      console.error("Error capturing audio sample:", error);
      return null;
    }
  }
}
