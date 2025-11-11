import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { AlertTriangle, TrendingUp, Clock, Zap } from "lucide-react";

interface HistogramBucket {
  label: string;
  count: number;
}

interface LatencyHistogramProps {
  buckets: HistogramBucket[];
}

function LatencyHistogram({ buckets }: LatencyHistogramProps) {
  const bucketColors = [
    'bg-green-500',
    'bg-blue-500',
    'bg-yellow-500',
    'bg-orange-500',
    'bg-red-500',
  ];

  const totalCount = buckets.reduce((sum, bucket) => sum + bucket.count, 0);
  const maxCount = Math.max(...buckets.map(b => b.count), 1);

  return (
    <div className="space-y-4" data-testid="histogram-latency">
      {buckets.map((bucket, idx) => {
        const percentage = totalCount > 0 ? (bucket.count / totalCount) * 100 : 0;
        const barHeight = totalCount > 0 ? (bucket.count / maxCount) * 100 : 0;
        const color = bucketColors[idx] || 'bg-gray-500';

        return (
          <div key={bucket.label} className="space-y-1">
            <div className="flex items-center justify-between text-sm">
              <span className="font-medium">{bucket.label}</span>
              <div className="flex items-center gap-2">
                <span className="text-muted-foreground">{bucket.count} requests</span>
                <Badge variant="outline" className="font-mono text-xs">
                  {percentage.toFixed(1)}%
                </Badge>
              </div>
            </div>
            <div className="relative h-8 bg-secondary rounded-md overflow-hidden">
              <div 
                className={`absolute left-0 top-0 h-full ${color} transition-all duration-500`}
                style={{ width: `${barHeight}%` }}
                data-testid={`histogram-bar-${bucket.label}`}
              />
              <div className="absolute inset-0 flex items-center justify-center text-xs font-medium text-primary-foreground mix-blend-difference">
                {bucket.count > 0 ? `${bucket.count}` : ''}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

interface TelemetryStats {
  period: {
    since: string;
    hoursBack: number;
  };
  summary: {
    totalRequests: number;
    tierDistribution: {
      exact: number;
      related: number;
      global: number;
      procedural: number;
    };
    latencyStats: {
      avg: number;
      p50: number;
      p95: number;
      p99: number;
      min: number;
      max: number;
    };
  };
  tierStats: Array<{
    tier: string;
    count: number;
    avgLatency: number;
    p50: number;
    p95: number;
  }>;
  histogramBuckets: HistogramBucket[];
  alert: {
    level: string;
    message: string;
    recommendation: string;
  } | null;
  timestamp: string;
}

export default function TelemetryDashboard() {
  const { data: stats, isLoading, error } = useQuery<TelemetryStats>({
    queryKey: ['/api/telemetry/catalogue-bridge/stats'],
    refetchInterval: 30000,
  });

  if (error) {
    return (
      <div className="container mx-auto p-6 max-w-6xl">
        <Alert variant="destructive" data-testid="alert-error">
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription>
            Failed to load telemetry data. Please try again later.
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  if (isLoading || !stats) {
    return (
      <div className="container mx-auto p-6 max-w-6xl space-y-6">
        <div className="space-y-2">
          <Skeleton className="h-8 w-64" />
          <Skeleton className="h-4 w-96" />
        </div>
        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
          {[1, 2, 3, 4].map(i => (
            <Skeleton key={i} className="h-32" />
          ))}
        </div>
      </div>
    );
  }

  const { summary, tierStats, histogramBuckets, alert } = stats;
  const tier34Usage = summary.tierDistribution.global + summary.tierDistribution.procedural;

  return (
    <div className="container mx-auto p-6 max-w-6xl space-y-6" data-testid="page-telemetry">
      <div className="space-y-2">
        <h1 className="text-3xl font-bold" data-testid="text-page-title">
          Catalogue Bridge Performance
        </h1>
        <p className="text-muted-foreground" data-testid="text-page-description">
          Real-time metrics for the 4-tier cascading fallback system
        </p>
      </div>

      {alert && (
        <Alert variant="destructive" data-testid="alert-tier-warning">
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription>
            <div className="font-semibold">{alert.message}</div>
            <div className="text-sm mt-1">{alert.recommendation}</div>
          </AlertDescription>
        </Alert>
      )}

      {/* Summary Cards */}
      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
        <Card data-testid="card-total-requests">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Requests</CardTitle>
            <TrendingUp className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold" data-testid="text-total-requests">
              {summary.totalRequests.toLocaleString()}
            </div>
            <p className="text-xs text-muted-foreground">
              Last {stats.period.hoursBack} hours
            </p>
          </CardContent>
        </Card>

        <Card data-testid="card-avg-latency">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Avg Latency</CardTitle>
            <Clock className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold" data-testid="text-avg-latency">
              {summary.latencyStats.avg.toFixed(0)}ms
            </div>
            <p className="text-xs text-muted-foreground">
              P95: {summary.latencyStats.p95.toFixed(0)}ms
            </p>
          </CardContent>
        </Card>

        <Card data-testid="card-instant-matches">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Instant Matches</CardTitle>
            <Zap className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold" data-testid="text-instant-matches">
              {summary.tierDistribution.exact.toFixed(1)}%
            </div>
            <p className="text-xs text-muted-foreground">
              Tier-1 (library hits)
            </p>
          </CardContent>
        </Card>

        <Card data-testid="card-tier34-usage">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Fallback Rate</CardTitle>
            <AlertTriangle className={`h-4 w-4 ${tier34Usage > 20 ? 'text-destructive' : 'text-muted-foreground'}`} />
          </CardHeader>
          <CardContent>
            <div className={`text-2xl font-bold ${tier34Usage > 20 ? 'text-destructive' : ''}`} data-testid="text-tier34-usage">
              {tier34Usage.toFixed(1)}%
            </div>
            <p className="text-xs text-muted-foreground">
              Tier-3/4 (threshold: 20%)
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Tier Distribution */}
      <Card data-testid="card-tier-distribution">
        <CardHeader>
          <CardTitle>Tier Distribution</CardTitle>
          <CardDescription>
            Request distribution across 4-tier cascading fallback
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {tierStats
              .sort((a, b) => {
                const order = { exact: 0, related: 1, global: 2, procedural: 3 };
                return order[a.tier as keyof typeof order] - order[b.tier as keyof typeof order];
              })
              .map(tier => {
                const percentage = summary.totalRequests > 0 
                  ? (tier.count / summary.totalRequests) * 100 
                  : 0;
                
                const tierColors = {
                  exact: 'bg-green-500',
                  related: 'bg-blue-500',
                  global: 'bg-yellow-500',
                  procedural: 'bg-red-500'
                };

                const tierLabels = {
                  exact: 'Tier-1: Exact Match',
                  related: 'Tier-2: Related Style',
                  global: 'Tier-3: Global Pool',
                  procedural: 'Tier-4: Procedural Gen'
                };

                return (
                  <div key={tier.tier} className="space-y-2" data-testid={`tier-stats-${tier.tier}`}>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Badge variant="outline" className="font-mono text-xs">
                          {tierLabels[tier.tier as keyof typeof tierLabels]}
                        </Badge>
                        <span className="text-sm text-muted-foreground">
                          {tier.count} requests
                        </span>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="text-sm font-medium">
                          {percentage.toFixed(1)}%
                        </span>
                        <span className="text-sm text-muted-foreground">
                          ~{tier.avgLatency.toFixed(0)}ms
                        </span>
                      </div>
                    </div>
                    <div className="h-2 bg-secondary rounded-full overflow-hidden">
                      <div 
                        className={`h-full ${tierColors[tier.tier as keyof typeof tierColors]} transition-all duration-500`}
                        style={{ width: `${percentage}%` }}
                      />
                    </div>
                  </div>
                );
              })}
          </div>
        </CardContent>
      </Card>

      {/* Latency Histogram */}
      <Card data-testid="card-latency-histogram">
        <CardHeader>
          <CardTitle>Latency Histogram</CardTitle>
          <CardDescription>
            Distribution of response times across buckets
          </CardDescription>
        </CardHeader>
        <CardContent>
          <LatencyHistogram buckets={histogramBuckets} />
        </CardContent>
      </Card>

      {/* Latency Percentiles */}
      <Card data-testid="card-latency-percentiles">
        <CardHeader>
          <CardTitle>Latency Percentiles</CardTitle>
          <CardDescription>
            Response time percentiles (ms)
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
            {[
              { label: 'Min', value: summary.latencyStats.min },
              { label: 'P50', value: summary.latencyStats.p50 },
              { label: 'P95', value: summary.latencyStats.p95 },
              { label: 'P99', value: summary.latencyStats.p99 },
              { label: 'Max', value: summary.latencyStats.max },
            ].map(stat => (
              <div key={stat.label} className="text-center" data-testid={`latency-${stat.label.toLowerCase()}`}>
                <div className="text-2xl font-bold">{stat.value.toFixed(0)}ms</div>
                <div className="text-sm text-muted-foreground">{stat.label}</div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Footer */}
      <div className="text-sm text-muted-foreground text-center">
        Last updated: {new Date(stats.timestamp).toLocaleString()}
      </div>
    </div>
  );
}
