import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Separator } from "@/components/ui/separator";
import { RefreshCw, ZapOff, Zap, Activity, AlertCircle, CheckCircle } from "lucide-react";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";

// Type definitions for API responses
interface BreakerStatus {
  state: 'closed' | 'open' | 'half-open';
  tokenBucket?: {
    currentTokens: number;
    maxTokens: number;
  };
  timeoutMs?: number;
  metrics?: {
    successRate: number;
  };
  recoveryProgress?: {
    consecutiveSuccesses: number;
    requiredSuccesses: number;
    batchSize: number;
  };
  openUntil?: string;
}

interface ResilienceData {
  fallbackCascade?: {
    catalogHits: number;
    proceduralHits: number;
    totalFallbacks: number;
    lastFallbackTier?: string;
    lastFallbackTime?: string;
  };
  recentGenerations?: Array<{
    id?: string;
    status: string;
    source: string;
    fallbackTier?: string;
    latencyMs?: number;
    timestamp: string;
  }>;
}

interface GenerationResponse {
  status: string;
  fallbackTier?: string;
}

export default function BreakerTest() {
  const { toast } = useToast();
  const { user, isLoading: authLoading } = useAuth();
  const [autoRefresh, setAutoRefresh] = useState(true);

  // Fetch circuit breaker status
  const { data: breakerStatus, refetch: refetchStatus } = useQuery<BreakerStatus>({
    queryKey: ["/api/test/breaker-status"],
    enabled: !!user,
    refetchInterval: autoRefresh ? 2000 : false,
  });

  // Fetch resilience monitoring data
  const { data: resilienceData, refetch: refetchResilience } = useQuery<ResilienceData>({
    queryKey: ["/api/monitoring/resilience"],
    enabled: !!user,
    refetchInterval: autoRefresh ? 5000 : false,
  });

  // Force breaker open mutation
  const forceBreakerOpen = useMutation({
    mutationFn: async (durationMs?: number) => {
      const res = await apiRequest('POST', '/api/test/force-breaker-open', durationMs ? { durationMs } : undefined);
      return res.json();
    },
    onSuccess: () => {
      toast({
        title: "Circuit Breaker Forced Open",
        description: "The circuit breaker has been forced into the open state.",
        className: "border-destructive",
      });
      refetchStatus();
      refetchResilience();
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to force breaker open",
        variant: "destructive",
      });
    },
  });

  // Reset breaker mutation
  const resetBreaker = useMutation({
    mutationFn: async () => {
      const res = await apiRequest('POST', '/api/test/force-breaker-closed');
      return res.json();
    },
    onSuccess: () => {
      toast({
        title: "Circuit Breaker Reset",
        description: "The circuit breaker has been reset to closed state.",
        className: "border-green-500",
      });
      refetchStatus();
      refetchResilience();
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to reset breaker",
        variant: "destructive",
      });
    },
  });

  // Test generation mutation
  const testGeneration = useMutation<GenerationResponse>({
    mutationFn: async () => {
      const sessionId = `test-session-${Date.now()}`;
      const res = await apiRequest('POST', '/api/artwork/generate', {
        sessionId,
        audioAnalysis: {
          energy: 0.7,
          danceability: 0.6,
          valence: 0.8,
          tempo: 120,
          loudness: -5,
        },
        preferences: {
          styles: ["Abstract"],
          artists: [],
        },
      });
      return res.json();
    },
    onSuccess: (data) => {
      const source = data.status === 'fallback' ? 'Fallback' : 'Fresh Generation';
      const tier = data.fallbackTier || 'N/A';
      
      toast({
        title: `Test Generation: ${source}`,
        description: tier !== 'N/A' ? `Fallback tier: ${tier}` : "Successfully generated new artwork",
        className: data.status === 'fallback' ? "border-yellow-500" : "border-green-500",
      });
      refetchResilience();
    },
    onError: (error: any) => {
      toast({
        title: "Generation Failed",
        description: error.message || "Failed to generate artwork",
        variant: "destructive",
      });
    },
  });

  const getBreakerStateColor = (state: string) => {
    switch (state) {
      case 'closed':
        return 'bg-green-500';
      case 'open':
        return 'bg-red-500';
      case 'half-open':
        return 'bg-yellow-500';
      default:
        return 'bg-secondary';
    }
  };

  const getBreakerStateIcon = (state: string) => {
    switch (state) {
      case 'closed':
        return <CheckCircle className="h-5 w-5" />;
      case 'open':
        return <AlertCircle className="h-5 w-5" />;
      case 'half-open':
        return <Activity className="h-5 w-5" />;
      default:
        return null;
    }
  };

  if (authLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <RefreshCw className="h-8 w-8 animate-spin mx-auto mb-4" />
          <p>Loading...</p>
        </div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Card>
          <CardHeader>
            <CardTitle>Authentication Required</CardTitle>
            <CardDescription>Please log in to access the circuit breaker test interface.</CardDescription>
          </CardHeader>
          <CardContent>
            <Button onClick={() => window.location.href = '/api/auth/login'}>
              Log In
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="container mx-auto p-8 space-y-8">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-4xl font-bold" data-testid="text-page-title">Circuit Breaker Test Interface</h1>
          <p className="text-muted-foreground mt-2">Test and monitor the resilience system</p>
        </div>
        <div className="flex items-center gap-4">
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={autoRefresh}
              onChange={(e) => setAutoRefresh(e.target.checked)}
              className="h-4 w-4"
              data-testid="checkbox-auto-refresh"
            />
            <span>Auto-refresh</span>
          </label>
          <Button
            onClick={() => {
              refetchStatus();
              refetchResilience();
            }}
            variant="outline"
            size="sm"
            data-testid="button-manual-refresh"
          >
            <RefreshCw className="h-4 w-4 mr-2" />
            Refresh
          </Button>
        </div>
      </div>

      {/* Circuit Breaker Status */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-3">
            Circuit Breaker Status
            {breakerStatus && (
              <Badge className={`${getBreakerStateColor(breakerStatus.state)} text-white`}>
                {getBreakerStateIcon(breakerStatus.state)}
                <span className="ml-2">{breakerStatus.state.toUpperCase()}</span>
              </Badge>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Control Buttons */}
          <div className="flex gap-4">
            <Button
              onClick={() => forceBreakerOpen.mutate(undefined)}
              variant="destructive"
              disabled={forceBreakerOpen.isPending || breakerStatus?.state === 'open'}
              data-testid="button-force-open"
            >
              <ZapOff className="h-4 w-4 mr-2" />
              Force Breaker Open
            </Button>
            <Button
              onClick={() => forceBreakerOpen.mutate(60000)}
              variant="outline"
              disabled={forceBreakerOpen.isPending}
              data-testid="button-force-open-1min"
            >
              <ZapOff className="h-4 w-4 mr-2" />
              Force Open (1 min)
            </Button>
            <Button
              onClick={() => resetBreaker.mutate(undefined)}
              variant="default"
              disabled={resetBreaker.isPending || breakerStatus?.state === 'closed'}
              data-testid="button-reset"
            >
              <Zap className="h-4 w-4 mr-2" />
              Reset to Closed
            </Button>
          </div>

          {breakerStatus && (
            <>
              <Separator />
              
              {/* Token Bucket Status */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div>
                  <p className="text-sm text-muted-foreground">Current Tokens</p>
                  <p className="text-2xl font-bold" data-testid="text-current-tokens">
                    {breakerStatus.tokenBucket?.currentTokens || 0}
                  </p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Max Tokens</p>
                  <p className="text-2xl font-bold" data-testid="text-max-tokens">
                    {breakerStatus.tokenBucket?.maxTokens || 0}
                  </p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Timeout (ms)</p>
                  <p className="text-2xl font-bold" data-testid="text-timeout">
                    {breakerStatus.timeoutMs || 0}
                  </p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Success Rate</p>
                  <p className="text-2xl font-bold" data-testid="text-success-rate">
                    {breakerStatus.metrics ? 
                      `${(breakerStatus.metrics.successRate * 100).toFixed(1)}%` : 
                      'N/A'}
                  </p>
                </div>
              </div>

              {/* Recovery Progress (if in half-open state) */}
              {breakerStatus.state === 'half-open' && breakerStatus.recoveryProgress && (
                <>
                  <Separator />
                  <Alert>
                    <AlertDescription>
                      <div className="space-y-2">
                        <p className="font-semibold">Recovery in Progress</p>
                        <div className="flex justify-between text-sm">
                          <span>Consecutive Successes:</span>
                          <span data-testid="text-recovery-progress">
                            {breakerStatus.recoveryProgress.consecutiveSuccesses} / {breakerStatus.recoveryProgress.requiredSuccesses}
                          </span>
                        </div>
                        <div className="flex justify-between text-sm">
                          <span>Batch Size:</span>
                          <span data-testid="text-batch-size">{breakerStatus.recoveryProgress.batchSize}</span>
                        </div>
                      </div>
                    </AlertDescription>
                  </Alert>
                </>
              )}

              {/* Open Until (if breaker is open) */}
              {breakerStatus.openUntil && (
                <Alert className="border-destructive">
                  <AlertDescription>
                    <p className="font-semibold">Breaker Open Until:</p>
                    <p className="text-sm" data-testid="text-open-until">
                      {new Date(breakerStatus.openUntil).toLocaleString()}
                    </p>
                  </AlertDescription>
                </Alert>
              )}
            </>
          )}
        </CardContent>
      </Card>

      {/* Test Generation */}
      <Card>
        <CardHeader>
          <CardTitle>Test Generation</CardTitle>
          <CardDescription>
            Trigger a test generation to see if it uses fresh generation or falls back to catalog
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button
            onClick={() => testGeneration.mutate(undefined)}
            disabled={testGeneration.isPending}
            data-testid="button-test-generation"
          >
            <Activity className="h-4 w-4 mr-2" />
            {testGeneration.isPending ? 'Generating...' : 'Trigger Test Generation'}
          </Button>
        </CardContent>
      </Card>

      {/* Fallback Cascade Metrics */}
      {resilienceData?.fallbackCascade && (
        <Card>
          <CardHeader>
            <CardTitle>Fallback Cascade Metrics</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
              <div>
                <p className="text-sm text-muted-foreground">Catalog Hits</p>
                <p className="text-2xl font-bold" data-testid="text-catalog-hits">
                  {resilienceData.fallbackCascade.catalogHits}
                </p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Procedural Hits</p>
                <p className="text-2xl font-bold" data-testid="text-procedural-hits">
                  {resilienceData.fallbackCascade.proceduralHits}
                </p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Total Fallbacks</p>
                <p className="text-2xl font-bold" data-testid="text-total-fallbacks">
                  {resilienceData.fallbackCascade.totalFallbacks}
                </p>
              </div>
            </div>
            {resilienceData.fallbackCascade.lastFallbackTier && (
              <div className="mt-4 p-4 bg-secondary rounded-lg">
                <p className="text-sm text-muted-foreground">Last Fallback</p>
                <div className="flex justify-between items-center mt-2">
                  <Badge variant="outline" data-testid="text-last-tier">
                    {resilienceData.fallbackCascade.lastFallbackTier}
                  </Badge>
                  <span className="text-xs text-muted-foreground" data-testid="text-last-fallback-time">
                    {resilienceData.fallbackCascade.lastFallbackTime && 
                      new Date(resilienceData.fallbackCascade.lastFallbackTime).toLocaleTimeString()}
                  </span>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Recent Generations */}
      {resilienceData?.recentGenerations && resilienceData.recentGenerations.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Recent Generation Attempts</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {resilienceData.recentGenerations.slice(0, 10).map((gen: any, index: number) => (
                <div
                  key={gen.id || index}
                  className="flex items-center justify-between p-3 rounded-lg bg-secondary"
                  data-testid={`generation-${index}`}
                >
                  <div className="flex items-center gap-3">
                    <Badge
                      variant={gen.status === 'success' ? 'default' : 'destructive'}
                      className={gen.status === 'success' ? 'bg-green-500' : ''}
                    >
                      {gen.status}
                    </Badge>
                    <Badge variant="outline">
                      {gen.source}
                    </Badge>
                    {gen.fallbackTier && (
                      <Badge variant="secondary">
                        Tier: {gen.fallbackTier}
                      </Badge>
                    )}
                  </div>
                  <div className="flex items-center gap-4 text-sm text-muted-foreground">
                    {gen.latencyMs && (
                      <span>{gen.latencyMs}ms</span>
                    )}
                    <span>{new Date(gen.timestamp).toLocaleTimeString()}</span>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}