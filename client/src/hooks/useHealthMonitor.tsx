import { useState, useEffect, useCallback, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { useToast } from "./use-toast";
import { AlertCircle, CheckCircle, WifiOff } from "lucide-react";

interface HealthStatus {
  status: 'ok' | 'degraded' | 'down';
  components: {
    http: { status: string; message: string };
    database: { status: string; message: string };
    websocket: { status: string; message: string; clients?: number };
    queue: { status: string; message: string };
    circuitBreaker: { status: string; message: string; state?: string };
    pool?: { status: string; message: string; depth?: number; coverage?: number };
    timestamp: string;
  };
  timestamp: string;
}

interface HealthMonitorOptions {
  onDisconnect?: () => void;
  onReconnect?: () => void;
  enabled?: boolean;
}

export function useHealthMonitor(options: HealthMonitorOptions = {}) {
  const { onDisconnect, onReconnect, enabled = true } = options;
  const { toast } = useToast();
  const [isBackendAvailable, setIsBackendAvailable] = useState(true);
  const [showStatusBanner, setShowStatusBanner] = useState(false);
  const [pollingInterval, setPollingInterval] = useState(15000); // 15 seconds
  const [connectionStatus, setConnectionStatus] = useState<'connected' | 'connecting' | 'disconnected'>('connected');
  const lastConnectionState = useRef<boolean>(true);
  const reconnectToastId = useRef<string | null>(null);
  const disconnectToastId = useRef<string | null>(null);
  const consecutiveFailures = useRef(0);
  const queuedMutations = useRef<(() => void)[]>([]);
  
  // Exponential backoff calculation
  const calculateBackoff = (failures: number): number => {
    const baseInterval = 15000; // 15 seconds
    const maxInterval = 120000; // 120 seconds (2 minutes)
    const backoffMultiplier = 2;
    
    const interval = Math.min(
      baseInterval * Math.pow(backoffMultiplier, failures),
      maxInterval
    );
    
    return interval;
  };
  
  // Health check query
  const { data: healthStatus, error, isError, isLoading } = useQuery<HealthStatus>({
    queryKey: ["/api/health"],
    queryFn: async () => {
      const response = await fetch("/api/health", {
        headers: {
          'Accept': 'application/json',
        },
      });
      
      if (!response.ok && response.status !== 503) {
        throw new Error(`Health check failed: ${response.status}`);
      }
      
      return response.json();
    },
    enabled,
    refetchInterval: pollingInterval,
    retry: false, // We handle retries ourselves with exponential backoff
    gcTime: 0, // Don't cache health checks
  });
  
  // Handle health status changes
  useEffect(() => {
    const isCurrentlyAvailable = !isError && healthStatus?.status !== 'down';
    
    // Detect connection state changes
    if (isCurrentlyAvailable !== lastConnectionState.current) {
      if (isCurrentlyAvailable) {
        // Backend recovered
        handleReconnection();
      } else {
        // Backend went down
        handleDisconnection();
      }
      
      lastConnectionState.current = isCurrentlyAvailable;
    }
    
    // Update availability state
    setIsBackendAvailable(isCurrentlyAvailable);
    
    // Update connection status
    if (isCurrentlyAvailable) {
      setConnectionStatus('connected');
      consecutiveFailures.current = 0;
      setPollingInterval(15000); // Reset to normal interval
    } else if (isLoading) {
      setConnectionStatus('connecting');
    } else {
      setConnectionStatus('disconnected');
      // Increase backoff on failure
      consecutiveFailures.current++;
      const newInterval = calculateBackoff(consecutiveFailures.current);
      setPollingInterval(newInterval);
      
      console.log(`[HealthMonitor] Backend unavailable. Retry in ${newInterval / 1000}s`);
    }
    
    // Show/hide status banner
    setShowStatusBanner(!isCurrentlyAvailable || healthStatus?.status === 'degraded');
  }, [healthStatus, isError, isLoading]);
  
  // Handle disconnection
  const handleDisconnection = useCallback(() => {
    console.error('[HealthMonitor] Backend connection lost');
    
    // Dismiss any existing reconnect toast
    if (reconnectToastId.current) {
      toast({
        id: reconnectToastId.current,
        description: "Dismissed",
        duration: 1,
      });
      reconnectToastId.current = null;
    }
    
    // Show disconnection toast
    const toastResult = toast({
      title: "Connection Lost",
      description: "Attempting to reconnect to server...",
      variant: "destructive",
      duration: Infinity, // Keep showing until reconnected
      icon: <WifiOff className="h-4 w-4" />,
    });
    
    disconnectToastId.current = (toastResult as any)?.id || 'disconnect-toast';
    
    // Call optional callback
    onDisconnect?.();
    
    // Record telemetry (if available)
    try {
      const event = new CustomEvent('health-monitor-disconnect', {
        detail: { timestamp: new Date().toISOString() }
      });
      window.dispatchEvent(event);
    } catch (e) {
      // Telemetry might not be available
    }
  }, [toast, onDisconnect]);
  
  // Handle reconnection
  const handleReconnection = useCallback(() => {
    console.log('[HealthMonitor] Backend connection restored');
    
    // Dismiss disconnection toast
    if (disconnectToastId.current) {
      toast({
        id: disconnectToastId.current,
        description: "Dismissed",
        duration: 1,
      });
      disconnectToastId.current = null;
    }
    
    // Show success toast
    const toastResult = toast({
      title: "Connection Restored",
      description: "Successfully reconnected to server",
      duration: 3000,
      icon: <CheckCircle className="h-4 w-4" />,
    });
    
    reconnectToastId.current = (toastResult as any)?.id || 'reconnect-toast';
    
    // Process queued mutations
    if (queuedMutations.current.length > 0) {
      console.log(`[HealthMonitor] Processing ${queuedMutations.current.length} queued mutations`);
      queuedMutations.current.forEach(mutation => {
        try {
          mutation();
        } catch (error) {
          console.error('[HealthMonitor] Failed to process queued mutation:', error);
        }
      });
      queuedMutations.current = [];
    }
    
    // Call optional callback
    onReconnect?.();
    
    // Record telemetry (if available)
    try {
      const event = new CustomEvent('health-monitor-reconnect', {
        detail: { 
          timestamp: new Date().toISOString(),
          downtime: consecutiveFailures.current * (pollingInterval / 1000),
        }
      });
      window.dispatchEvent(event);
    } catch (e) {
      // Telemetry might not be available
    }
  }, [toast, onReconnect, pollingInterval]);
  
  // Queue a mutation for later execution
  const queueMutation = useCallback((mutation: () => void) => {
    if (!isBackendAvailable) {
      console.log('[HealthMonitor] Queueing mutation for later execution');
      queuedMutations.current.push(mutation);
    } else {
      // Execute immediately if backend is available
      mutation();
    }
  }, [isBackendAvailable]);
  
  // Get detailed component status
  const getComponentStatus = useCallback(() => {
    if (!healthStatus) return null;
    
    const components = healthStatus.components;
    
    // Guard against undefined or null components
    if (!components || typeof components !== 'object') {
      return {
        degraded: [],
        down: [],
        websocketClients: 0,
        circuitBreakerState: 'unknown',
        poolDepth: 0,
      };
    }
    
    const criticalComponents = ['database', 'websocket', 'queue'];
    const degradedComponents = Object.entries(components)
      .filter(([key, value]: [string, any]) => 
        criticalComponents.includes(key) && value?.status === 'degraded'
      )
      .map(([key]) => key);
    
    const downComponents = Object.entries(components)
      .filter(([key, value]: [string, any]) => 
        criticalComponents.includes(key) && value?.status === 'down'
      )
      .map(([key]) => key);
    
    return {
      degraded: degradedComponents,
      down: downComponents,
      websocketClients: components?.websocket?.clients || 0,
      circuitBreakerState: components?.circuitBreaker?.state || 'unknown',
      poolDepth: components?.pool?.depth || 0,
    };
  }, [healthStatus]);
  
  // Status banner component
  const StatusBanner = useCallback(() => {
    if (!showStatusBanner) return null;
    
    const componentStatus = getComponentStatus();
    const isDown = connectionStatus === 'disconnected';
    const isDegraded = healthStatus?.status === 'degraded';
    
    return (
      <div 
        data-testid="health-status-banner"
        className={`fixed top-0 left-0 right-0 z-50 px-4 py-2 text-sm font-medium text-center ${
          isDown 
            ? 'bg-red-500 text-white' 
            : isDegraded 
            ? 'bg-yellow-500 text-black' 
            : 'bg-blue-500 text-white'
        }`}
      >
        <div className="flex items-center justify-center gap-2">
          <AlertCircle className="h-4 w-4" />
          {isDown ? (
            <span>Connection lost. Attempting to reconnect...</span>
          ) : isDegraded ? (
            <span>
              System degraded: {componentStatus?.degraded.join(', ')} experiencing issues
            </span>
          ) : (
            <span>Connecting to server...</span>
          )}
          {connectionStatus === 'disconnected' && (
            <span className="ml-2 text-xs opacity-75">
              Next retry in {Math.round(pollingInterval / 1000)}s
            </span>
          )}
        </div>
      </div>
    );
  }, [showStatusBanner, connectionStatus, healthStatus, pollingInterval, getComponentStatus]);
  
  return {
    isBackendAvailable,
    connectionStatus,
    healthStatus,
    showStatusBanner,
    StatusBanner,
    queueMutation,
    getComponentStatus,
    retryInterval: pollingInterval,
  };
}