import { Switch, Route } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ThemeProvider } from "@/components/theme-provider";
import Landing from "@/pages/landing";
import Display from "@/pages/display";
import Maestro from "@/pages/maestro";
import Gallery from "@/pages/gallery";
import Subscribe from "@/pages/subscribe";
import WebGLTest from "@/pages/webgl-test";
import TelemetryDashboard from "@/pages/telemetry";
import BreakerTest from "@/pages/breaker-test";
import NotFound from "@/pages/not-found";

function Router() {
  return (
    <Switch>
      <Route path="/" component={Landing} />
      <Route path="/display" component={Display} />
      <Route path="/maestro" component={Maestro} />
      <Route path="/gallery" component={Gallery} />
      <Route path="/subscribe" component={Subscribe} />
      <Route path="/webgl-test" component={WebGLTest} />
      <Route path="/breaker-test" component={BreakerTest} />
      <Route path="/admin/telemetry" component={TelemetryDashboard} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider defaultTheme="light">
        <TooltipProvider>
          <Toaster />
          <Router />
        </TooltipProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}

export default App;
