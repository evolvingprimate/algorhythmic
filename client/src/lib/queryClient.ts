import { QueryClient, QueryFunction } from "@tanstack/react-query";
import { 
  getNetworkStatus, 
  getAdaptiveTimeoutConfig, 
  adaptiveRetryDelay,
  NetworkQuality 
} from "./network-utils";

async function throwIfResNotOk(res: Response) {
  if (!res.ok) {
    const text = (await res.text()) || res.statusText;
    throw new Error(`${res.status}: ${text}`);
  }
}

/**
 * Make API request with adaptive timeout based on network quality
 */
export async function apiRequest(
  method: string,
  url: string,
  data?: unknown | undefined,
  options?: { skipTimeout?: boolean }
): Promise<Response> {
  // Get network status and adaptive timeout
  const networkStatus = getNetworkStatus();
  const timeoutConfig = getAdaptiveTimeoutConfig(networkStatus.quality);
  
  // Create abort controller for timeout
  const controller = new AbortController();
  let timeoutId: number | undefined;
  
  // Set timeout unless explicitly skipped
  if (!options?.skipTimeout && networkStatus.online) {
    timeoutId = window.setTimeout(() => {
      controller.abort();
    }, timeoutConfig.baseTimeout);
  }
  
  try {
    const res = await fetch(url, {
      method,
      headers: data ? { "Content-Type": "application/json" } : {},
      body: data ? JSON.stringify(data) : undefined,
      credentials: "include",
      signal: controller.signal,
    });

    if (timeoutId) clearTimeout(timeoutId);
    
    await throwIfResNotOk(res);
    return res;
  } catch (error: any) {
    if (timeoutId) clearTimeout(timeoutId);
    
    // Enhance timeout error messages
    if (error.name === 'AbortError') {
      throw new Error(`Request timeout after ${timeoutConfig.baseTimeout}ms (Network: ${networkStatus.quality})`);
    }
    throw error;
  }
}

type UnauthorizedBehavior = "returnNull" | "throw";

/**
 * Query function with adaptive timeout based on network quality
 */
export const getQueryFn: <T>(options: {
  on401: UnauthorizedBehavior;
}) => QueryFunction<T> =
  ({ on401: unauthorizedBehavior }) =>
  async ({ queryKey, signal }) => {
    // Get network status and adaptive timeout
    const networkStatus = getNetworkStatus();
    const timeoutConfig = getAdaptiveTimeoutConfig(networkStatus.quality);
    
    // Create abort controller that combines query signal with timeout
    const controller = new AbortController();
    let timeoutId: number | undefined;
    
    // Listen to the query's abort signal
    if (signal) {
      signal.addEventListener('abort', () => controller.abort());
    }
    
    // Set timeout based on network quality
    if (networkStatus.online) {
      timeoutId = window.setTimeout(() => {
        controller.abort();
      }, timeoutConfig.baseTimeout);
    }
    
    try {
      const res = await fetch(queryKey.join("/") as string, {
        credentials: "include",
        signal: controller.signal,
      });

      if (timeoutId) clearTimeout(timeoutId);

      if (unauthorizedBehavior === "returnNull" && res.status === 401) {
        return null;
      }

      await throwIfResNotOk(res);
      return await res.json();
    } catch (error: any) {
      if (timeoutId) clearTimeout(timeoutId);
      
      // Enhance timeout error messages
      if (error.name === 'AbortError') {
        throw new Error(`Request timeout after ${timeoutConfig.baseTimeout}ms (Network: ${networkStatus.quality})`);
      }
      throw error;
    }
  };

/**
 * QueryClient with adaptive retry configuration based on network quality
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      queryFn: getQueryFn({ on401: "throw" }),
      refetchInterval: false,
      refetchOnWindowFocus: false,
      staleTime: Infinity,
      // Enable retry with adaptive configuration
      retry: (failureCount, error) => {
        // Check network status
        const networkStatus = getNetworkStatus();
        
        // Don't retry if offline
        if (!networkStatus.online) {
          return false;
        }
        
        // Get retry config based on network quality
        const config = getAdaptiveTimeoutConfig(networkStatus.quality);
        
        // Don't retry server errors (5xx) more than once
        if (error instanceof Error && error.message.includes('5')) {
          return failureCount < 1;
        }
        
        // Retry up to max retries for network errors
        return failureCount < config.maxRetries;
      },
      // Use adaptive retry delay function
      retryDelay: adaptiveRetryDelay,
    },
    mutations: {
      // Enable retry for mutations too
      retry: (failureCount, error) => {
        // Check network status
        const networkStatus = getNetworkStatus();
        
        // Don't retry if offline
        if (!networkStatus.online) {
          return false;
        }
        
        // Get retry config based on network quality
        const config = getAdaptiveTimeoutConfig(networkStatus.quality);
        
        // Don't retry 4xx errors (client errors)
        if (error instanceof Error && error.message.includes('4')) {
          return false;
        }
        
        // Retry up to max retries for network/server errors
        return failureCount < config.maxRetries;
      },
      retryDelay: adaptiveRetryDelay,
    },
  },
});
