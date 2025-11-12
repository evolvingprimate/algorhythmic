import { Component, ErrorInfo, ReactNode } from "react";
import { AlertCircle, RefreshCw, Home, Bug } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
  onError?: (error: Error, errorInfo: ErrorInfo) => void;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
  errorCount: number;
}

export class ArtworkErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null,
      errorCount: 0
    };
  }

  static getDerivedStateFromError(error: Error): Partial<State> {
    // Update state so the next render will show the fallback UI
    return {
      hasError: true,
      error
    };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    // Log error details
    console.error('[ArtworkErrorBoundary] Caught error:', error);
    console.error('[ArtworkErrorBoundary] Error info:', errorInfo);
    
    // Update state with error details
    this.setState(prevState => ({
      errorInfo,
      errorCount: prevState.errorCount + 1
    }));
    
    // Call optional error handler
    if (this.props.onError) {
      this.props.onError(error, errorInfo);
    }
    
    // Send error telemetry if available
    if (window.telemetryService) {
      (window as any).telemetryService.recordEvent('artwork_error', {
        errorMessage: error.message,
        errorStack: error.stack,
        componentStack: errorInfo.componentStack,
        errorCount: this.state.errorCount + 1
      });
    }
  }

  handleReset = () => {
    this.setState({
      hasError: false,
      error: null,
      errorInfo: null
    });
  };

  handleRefresh = () => {
    window.location.reload();
  };

  handleGoHome = () => {
    window.location.href = '/';
  };

  render() {
    if (this.state.hasError) {
      // Use custom fallback if provided
      if (this.props.fallback) {
        return <>{this.props.fallback}</>;
      }

      const { error, errorInfo, errorCount } = this.state;
      const isImageError = error?.message?.includes('image') || error?.message?.includes('texture');
      const isNetworkError = error?.message?.includes('network') || error?.message?.includes('fetch');
      
      return (
        <div className="flex items-center justify-center min-h-screen p-4 bg-background" data-testid="artwork-error-boundary">
          <Card className="max-w-lg w-full">
            <CardHeader className="text-center">
              <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-destructive/10">
                {isImageError ? (
                  <AlertCircle className="h-8 w-8 text-destructive" />
                ) : (
                  <Bug className="h-8 w-8 text-destructive" />
                )}
              </div>
              <CardTitle className="text-2xl">
                {isImageError ? 'Artwork Loading Issue' : 'Something went wrong'}
              </CardTitle>
              <CardDescription>
                {isNetworkError 
                  ? "We're having trouble connecting to our servers. Please check your internet connection."
                  : isImageError
                  ? "The artwork couldn't be displayed properly. This might be temporary."
                  : "An unexpected error occurred while displaying your artwork."
                }
              </CardDescription>
            </CardHeader>
            
            <CardContent className="space-y-4">
              {/* Error details for development */}
              {process.env.NODE_ENV === 'development' && (
                <details className="text-xs bg-muted/50 p-3 rounded-md">
                  <summary className="cursor-pointer text-muted-foreground font-medium mb-2">
                    Technical Details (Development Only)
                  </summary>
                  <div className="space-y-2">
                    <div>
                      <strong>Error:</strong> {error?.message}
                    </div>
                    {error?.stack && (
                      <div>
                        <strong>Stack:</strong>
                        <pre className="mt-1 overflow-auto max-h-32 text-xs">
                          {error.stack}
                        </pre>
                      </div>
                    )}
                    {errorInfo?.componentStack && (
                      <div>
                        <strong>Component Stack:</strong>
                        <pre className="mt-1 overflow-auto max-h-32 text-xs">
                          {errorInfo.componentStack}
                        </pre>
                      </div>
                    )}
                  </div>
                </details>
              )}
              
              {/* Error frequency warning */}
              {errorCount > 2 && (
                <div className="p-3 bg-warning/10 border border-warning/20 rounded-md">
                  <p className="text-sm text-warning">
                    This error has occurred {errorCount} times. If the problem persists, please contact support.
                  </p>
                </div>
              )}
              
              {/* Suggestions */}
              <div className="space-y-2 text-sm text-muted-foreground">
                <p className="font-medium">You can try:</p>
                <ul className="list-disc list-inside space-y-1">
                  <li>Refreshing the page to reload the artwork</li>
                  <li>Checking your internet connection</li>
                  <li>Clearing your browser cache</li>
                  <li>Using a different browser or device</li>
                </ul>
              </div>
            </CardContent>
            
            <CardFooter className="flex gap-2">
              <Button
                onClick={this.handleReset}
                variant="default"
                className="flex-1"
                data-testid="button-try-again"
              >
                <RefreshCw className="mr-2 h-4 w-4" />
                Try Again
              </Button>
              <Button
                onClick={this.handleRefresh}
                variant="outline"
                className="flex-1"
                data-testid="button-refresh-page"
              >
                Refresh Page
              </Button>
              <Button
                onClick={this.handleGoHome}
                variant="ghost"
                size="icon"
                data-testid="button-go-home"
              >
                <Home className="h-4 w-4" />
              </Button>
            </CardFooter>
          </Card>
        </div>
      );
    }

    return this.props.children;
  }
}

// Functional wrapper for easier use with hooks
export function withArtworkErrorBoundary<P extends object>(
  Component: React.ComponentType<P>,
  fallback?: ReactNode,
  onError?: (error: Error, errorInfo: ErrorInfo) => void
) {
  return (props: P) => (
    <ArtworkErrorBoundary fallback={fallback} onError={onError}>
      <Component {...props} />
    </ArtworkErrorBoundary>
  );
}