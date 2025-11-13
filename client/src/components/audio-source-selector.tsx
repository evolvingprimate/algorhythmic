import { useState, useEffect, useRef } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Mic, MicOff, AlertCircle } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { AudioAnalyzer, type AudioDevice } from "@/lib/audio-analyzer";

interface NormalizedAudioDevice extends AudioDevice {
  uiId: string; // For UI purposes (data-testid, radio values)
  originalDeviceId: string; // Original deviceId for API calls
}

interface AudioSourceSelectorProps {
  open: boolean;
  onClose: () => void;
  onConfirm: (deviceId: string | undefined) => void;
}

export function AudioSourceSelector({ open, onClose, onConfirm }: AudioSourceSelectorProps) {
  const [devices, setDevices] = useState<NormalizedAudioDevice[]>([]);
  const [selectedUiId, setSelectedUiId] = useState<string>("");
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [audioLevel, setAudioLevel] = useState(0);
  const [isPreviewing, setIsPreviewing] = useState(false);
  const [useNoAudio, setUseNoAudio] = useState(false);
  
  const previewAnalyzerRef = useRef<AudioAnalyzer | null>(null);
  const previewIntervalRef = useRef<number | null>(null);

  useEffect(() => {
    if (open) {
      loadDevices();
    } else {
      stopPreview();
    }
    
    return () => {
      stopPreview();
    };
  }, [open]);

  const loadDevices = async () => {
    setIsLoading(true);
    setError(null);
    
    try {
      const audioDevices = await AudioAnalyzer.enumerateDevices();
      
      // Normalize device data - preserve original deviceId for API, create UI-safe ID
      const normalizedDevices: NormalizedAudioDevice[] = audioDevices.map((device, index) => ({
        ...device,
        originalDeviceId: device.deviceId, // Preserve original for API
        uiId: device.deviceId || `default-${index}`, // UI-safe ID
        deviceId: device.deviceId, // Keep original deviceId
        label: device.label || `Microphone ${index + 1}`,
      }));
      
      setDevices(normalizedDevices);
      
      if (normalizedDevices.length > 0) {
        // Default to first microphone (not "No Audio")
        const firstDevice = normalizedDevices[0];
        setSelectedUiId(firstDevice.uiId);
        setUseNoAudio(false);
        startPreview(firstDevice.originalDeviceId);
      } else {
        // If no devices, default to "No Audio" option
        setUseNoAudio(true);
        setSelectedUiId("no-audio");
      }
    } catch (err: any) {
      setError(err.message || "Failed to access audio devices");
      // Default to "No Audio" when microphone access fails
      setUseNoAudio(true);
      setSelectedUiId("no-audio");
    } finally {
      setIsLoading(false);
    }
  };

  const startPreview = async (originalDeviceId: string) => {
    stopPreview();
    
    try {
      setIsPreviewing(true);
      setError(null);
      previewAnalyzerRef.current = new AudioAnalyzer();
      
      // Pass deviceId to API - empty strings become undefined for default device
      const apiDeviceId = originalDeviceId || undefined;
      await previewAnalyzerRef.current.initialize(() => {}, apiDeviceId);
      
      // Update audio level preview
      previewIntervalRef.current = window.setInterval(() => {
        if (previewAnalyzerRef.current) {
          const level = previewAnalyzerRef.current.getAudioLevel();
          setAudioLevel(level);
        }
      }, 100);
    } catch (err: any) {
      console.error("Preview error:", err);
      setIsPreviewing(false);
      setError(err.message || "Failed to preview selected microphone. Please try another device.");
      // Stop the broken preview completely
      stopPreview();
    }
  };

  const stopPreview = () => {
    if (previewIntervalRef.current) {
      clearInterval(previewIntervalRef.current);
      previewIntervalRef.current = null;
    }
    
    if (previewAnalyzerRef.current) {
      previewAnalyzerRef.current.stop();
      previewAnalyzerRef.current = null;
    }
    
    setAudioLevel(0);
    setIsPreviewing(false);
  };

  const handleDeviceChange = (uiId: string) => {
    setSelectedUiId(uiId);
    
    if (uiId === "no-audio") {
      setUseNoAudio(true);
      stopPreview();
    } else {
      setUseNoAudio(false);
      const device = devices.find(d => d.uiId === uiId);
      if (device) {
        startPreview(device.originalDeviceId);
      }
    }
  };

  const handleConfirm = () => {
    stopPreview();
    
    if (useNoAudio || selectedUiId === "no-audio") {
      // Pass "no-audio" to indicate no audio should be used
      onConfirm("no-audio");
    } else {
      const device = devices.find(d => d.uiId === selectedUiId);
      // Pass original deviceId to API, or undefined for default device
      onConfirm(device?.originalDeviceId || undefined);
    }
  };

  const handleCancel = () => {
    stopPreview();
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={handleCancel}>
      <DialogContent className="sm:max-w-md" data-testid="dialog-audio-source-selector">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Mic className="w-5 h-5" />
            Choose Audio Source
          </DialogTitle>
          <DialogDescription>
            Choose which microphone to use for audio-reactive art generation
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {isLoading && (
            <div className="flex items-center justify-center py-8" data-testid="loading-devices">
              <div className="text-sm text-muted-foreground">Loading audio devices...</div>
            </div>
          )}

          {error && (
            <Alert variant="destructive" data-testid="alert-error">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          {!isLoading && (
            <>
              <RadioGroup value={selectedUiId} onValueChange={handleDeviceChange}>
                <div className="space-y-2">
                  {/* No Audio Option */}
                  <div
                    className="flex items-center space-x-2 rounded-md border p-3 hover-elevate"
                    data-testid="device-option-no-audio"
                  >
                    <RadioGroupItem value="no-audio" id="no-audio" data-testid="radio-no-audio" />
                    <Label
                      htmlFor="no-audio"
                      className="flex-1 cursor-pointer font-normal"
                    >
                      <div className="flex items-center gap-2">
                        <MicOff className="w-4 h-4 text-muted-foreground" />
                        <span>No Audio (Visual Art Only)</span>
                      </div>
                    </Label>
                  </div>
                  
                  {/* Microphone Options */}
                  {devices.map((device) => (
                    <div
                      key={device.uiId}
                      className="flex items-center space-x-2 rounded-md border p-3 hover-elevate"
                      data-testid={`device-option-${device.uiId}`}
                    >
                      <RadioGroupItem value={device.uiId} id={device.uiId} data-testid={`radio-${device.uiId}`} />
                      <Label
                        htmlFor={device.uiId}
                        className="flex-1 cursor-pointer font-normal"
                      >
                        {device.label}
                      </Label>
                      {selectedUiId === device.uiId && isPreviewing && (
                        <Mic className="w-4 h-4 text-primary" />
                      )}
                    </div>
                  ))}
                </div>
              </RadioGroup>

              {/* Audio Level Preview */}
              <div className="space-y-2">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Audio Level</span>
                  {isPreviewing ? (
                    <span className="text-xs text-green-600 dark:text-green-400" data-testid="text-preview-active">
                      Listening...
                    </span>
                  ) : (
                    <span className="text-xs text-muted-foreground" data-testid="text-preview-inactive">
                      No signal
                    </span>
                  )}
                </div>
                <Progress value={audioLevel} className="h-2" data-testid="progress-audio-level" />
                <p className="text-xs text-muted-foreground">
                  Make some noise to test the selected microphone
                </p>
              </div>
            </>
          )}

        </div>

        <div className="flex gap-2 justify-end mt-4">
          <Button variant="outline" onClick={handleCancel} data-testid="button-cancel">
            Cancel
          </Button>
          <Button
            onClick={handleConfirm}
            disabled={isLoading || (!selectedUiId && devices.length === 0)}
            data-testid="button-confirm"
          >
            Confirm & Start
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
