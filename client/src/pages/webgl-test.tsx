import { useState, useEffect, useRef } from "react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { ArrowLeft, Download, CheckCircle2, XCircle, Loader2, AlertCircle } from "lucide-react";
import { WebGLCapabilitiesTest, type TestResult } from "@/lib/webgl-test/WebGLCapabilitiesTest";

interface TestGroup {
  name: string;
  description: string;
  tests: TestResult[];
}

export default function WebGLTest() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [testGroups, setTestGroups] = useState<TestGroup[]>([
    {
      name: "Phase 1: WebGL2 Capabilities",
      description: "Test basic WebGL2 support and features",
      tests: [
        { name: "WebGL2 Context Creation", status: 'pending' },
        { name: "Max Texture Size", status: 'pending' },
        { name: "Vertex Shader Compilation", status: 'pending' },
        { name: "Fragment Shader Compilation", status: 'pending' },
        { name: "Float Texture Extension", status: 'pending' },
        { name: "Framebuffer Support", status: 'pending' },
      ]
    },
    {
      name: "Phase 2: Image Loading",
      description: "Test image loading and texture creation",
      tests: [
        { name: "Load Image from URL", status: 'pending' },
        { name: "Create Texture from Image", status: 'pending' },
        { name: "Render Texture to Canvas", status: 'pending' },
      ]
    },
    {
      name: "Phase 3: Visual Effects",
      description: "Test individual visual effect shaders",
      tests: [
        { name: "Simple Crossfade (Morpheus 0.1)", status: 'pending' },
        { name: "Ken Burns Zoom/Pan", status: 'pending' },
        { name: "Multi-Pass Framebuffers (Trace)", status: 'pending' },
        { name: "Downsampling & Bloom", status: 'pending' },
        { name: "Chromatic Aberration", status: 'pending' },
        { name: "Particle System", status: 'pending' },
      ]
    },
    {
      name: "Phase 4: External Libraries (Priority)",
      description: "Test OpenCV.js loading (critical for Morpheus 0.4)",
      tests: [
        { name: "OpenCV.js Loading", status: 'pending' },
        { name: "cv.Mat Creation", status: 'pending' },
      ]
    },
    {
      name: "Phase 5: Memory & Performance",
      description: "Test device limits",
      tests: [
        { name: "Multiple Large Textures (1024x1024)", status: 'pending' },
        { name: "Sustained Rendering (60fps)", status: 'pending' },
        { name: "Memory Usage", status: 'pending' },
      ]
    }
  ]);

  const runTests = async () => {
    if (!canvasRef.current) {
      console.error('[WebGLTest] Canvas ref not available');
      return;
    }

    setIsRunning(true);
    setProgress(0);
    
    // Calculate total tests
    const totalTests = testGroups.reduce((sum, group) => sum + group.tests.length, 0);
    let completedTests = 0;

    // Progress callback to update UI in real-time
    const onProgress = (testName: string, status: TestResult['status'], message?: string) => {
      setTestGroups(prev => {
        const updated = [...prev];
        for (let groupIndex = 0; groupIndex < updated.length; groupIndex++) {
          const testIndex = updated[groupIndex].tests.findIndex(t => t.name === testName);
          if (testIndex !== -1) {
            updated[groupIndex].tests[testIndex] = {
              ...updated[groupIndex].tests[testIndex],
              status,
              message,
            };
            break;
          }
        }
        return updated;
      });
    };

    // Phase 1: WebGL2 Capabilities
    const tester = new WebGLCapabilitiesTest(canvasRef.current, onProgress);
    
    try {
      const phase1Results = await tester.runPhase1Tests();
      
      // Update test results
      setTestGroups(prev => {
        const updated = [...prev];
        phase1Results.forEach((result) => {
          const testIndex = updated[0].tests.findIndex(t => t.name === result.name);
          if (testIndex !== -1) {
            updated[0].tests[testIndex] = result;
          }
        });
        return updated;
      });

      completedTests += phase1Results.length;
      setProgress((completedTests / totalTests) * 100);

      // Phase 2: Image Loading
      const phase2Results = await tester.runPhase2Tests();
      
      setTestGroups(prev => {
        const updated = [...prev];
        phase2Results.forEach((result) => {
          const testIndex = updated[1].tests.findIndex(t => t.name === result.name);
          if (testIndex !== -1) {
            updated[1].tests[testIndex] = result;
          }
        });
        return updated;
      });

      completedTests += phase2Results.length;
      setProgress((completedTests / totalTests) * 100);

      // Skip Phase 3 (visual effects) for now - complex shader tests
      // Mark Phase 3 tests as skipped
      setTestGroups(prev => {
        const updated = [...prev];
        updated[2].tests.forEach((_, idx) => {
          updated[2].tests[idx].status = 'skipped';
          updated[2].tests[idx].message = 'Skipped for now - complex shader tests';
        });
        return updated;
      });
      
      completedTests += testGroups[2].tests.length; // Count skipped tests for progress
      setProgress((completedTests / totalTests) * 100);

      // Phase 4: OpenCV.js Loading (CRITICAL - diagnose emergency fixes)
      const phase4Results = await tester.runPhase4Tests();
      
      setTestGroups(prev => {
        const updated = [...prev];
        phase4Results.forEach((result) => {
          const testIndex = updated[3].tests.findIndex(t => t.name === result.name);
          if (testIndex !== -1) {
            updated[3].tests[testIndex] = result;
          }
        });
        return updated;
      });

      completedTests += phase4Results.length;
      setProgress((completedTests / totalTests) * 100);

      // Skip Phase 5 (memory/performance) for now
      setTestGroups(prev => {
        const updated = [...prev];
        updated[4].tests.forEach((_, idx) => {
          updated[4].tests[idx].status = 'skipped';
          updated[4].tests[idx].message = 'Skipped for now - performance tests';
        });
        return updated;
      });

      completedTests += testGroups[4].tests.length; // Count skipped tests for progress
      setProgress(100); // All tests complete (run or skipped)

      console.log('[WebGLTest] Critical tests complete (Phases 1, 2, 4). Phases 3 & 5 skipped.');
      
    } catch (error) {
      console.error('[WebGLTest] Test execution error:', error);
    } finally {
      tester.cleanup();
      setIsRunning(false);
    }
  };

  const exportResults = () => {
    const results = {
      timestamp: new Date().toISOString(),
      userAgent: navigator.userAgent,
      platform: navigator.platform,
      groups: testGroups,
    };
    
    const blob = new Blob([JSON.stringify(results, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `webgl-test-results-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const getStatusIcon = (status: TestResult['status']) => {
    switch (status) {
      case 'passed':
        return <CheckCircle2 className="w-4 h-4 text-green-500" data-testid={`icon-passed`} />;
      case 'failed':
        return <XCircle className="w-4 h-4 text-red-500" data-testid={`icon-failed`} />;
      case 'running':
        return <Loader2 className="w-4 h-4 animate-spin text-blue-500" data-testid={`icon-running`} />;
      case 'skipped':
        return <AlertCircle className="w-4 h-4 text-yellow-500" data-testid={`icon-skipped`} />;
      default:
        return <div className="w-4 h-4 rounded-full border-2 border-muted" data-testid={`icon-pending`} />;
    }
  };

  const getStatusBadge = (status: TestResult['status']) => {
    switch (status) {
      case 'passed':
        return <Badge variant="default" className="bg-green-500" data-testid={`badge-passed`}>Passed</Badge>;
      case 'failed':
        return <Badge variant="destructive" data-testid={`badge-failed`}>Failed</Badge>;
      case 'running':
        return <Badge variant="default" className="bg-blue-500" data-testid={`badge-running`}>Running</Badge>;
      case 'skipped':
        return <Badge variant="secondary" data-testid={`badge-skipped`}>Skipped</Badge>;
      default:
        return <Badge variant="outline" data-testid={`badge-pending`}>Pending</Badge>;
    }
  };

  const totalTests = testGroups.reduce((sum, group) => sum + group.tests.length, 0);
  const passedTests = testGroups.reduce((sum, group) => 
    sum + group.tests.filter(t => t.status === 'passed').length, 0
  );
  const failedTests = testGroups.reduce((sum, group) => 
    sum + group.tests.filter(t => t.status === 'failed').length, 0
  );

  return (
    <div className="min-h-screen bg-background p-8" data-testid="page-webgl-test">
      <div className="max-w-6xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="space-y-1">
            <h1 className="text-3xl font-bold tracking-tight" data-testid="title-page">WebGL Capabilities Test Suite</h1>
            <p className="text-muted-foreground" data-testid="text-description">
              Comprehensive diagnostic tool to test device WebGL capabilities and identify feature support
            </p>
          </div>
          <Link href="/display">
            <Button variant="outline" data-testid="button-back-to-display">
              <ArrowLeft className="w-4 h-4 mr-2" />
              Back to Display
            </Button>
          </Link>
        </div>

        {/* Summary Card */}
        <Card data-testid="card-summary">
          <CardHeader>
            <CardTitle data-testid="title-test-summary">Test Summary</CardTitle>
            <CardDescription data-testid="text-summary-description">
              Overall progress and results
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between">
              <div className="space-y-1">
                <p className="text-sm text-muted-foreground">Progress</p>
                <p className="text-2xl font-bold" data-testid="text-progress-percentage">{Math.round(progress)}%</p>
              </div>
              <div className="flex gap-6">
                <div className="text-center">
                  <p className="text-sm text-muted-foreground">Total</p>
                  <p className="text-2xl font-bold" data-testid="text-total-tests">{totalTests}</p>
                </div>
                <div className="text-center">
                  <p className="text-sm text-muted-foreground">Passed</p>
                  <p className="text-2xl font-bold text-green-500" data-testid="text-passed-tests">{passedTests}</p>
                </div>
                <div className="text-center">
                  <p className="text-sm text-muted-foreground">Failed</p>
                  <p className="text-2xl font-bold text-red-500" data-testid="text-failed-tests">{failedTests}</p>
                </div>
              </div>
            </div>
            <Progress value={progress} className="w-full" data-testid="progress-bar" />
            <div className="flex gap-2">
              <Button 
                onClick={runTests} 
                disabled={isRunning}
                className="flex-1"
                data-testid="button-run-tests"
              >
                {isRunning ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Running Tests...
                  </>
                ) : (
                  'Run All Tests'
                )}
              </Button>
              <Button
                variant="outline"
                onClick={exportResults}
                disabled={isRunning || (passedTests === 0 && failedTests === 0)}
                data-testid="button-export-results"
              >
                <Download className="w-4 h-4 mr-2" />
                Export Results
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Test Groups */}
        <div className="space-y-4">
          {testGroups.map((group, groupIndex) => (
            <Card key={groupIndex} data-testid={`card-group-${groupIndex}`}>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle data-testid={`title-group-${groupIndex}`}>{group.name}</CardTitle>
                    <CardDescription data-testid={`text-group-description-${groupIndex}`}>{group.description}</CardDescription>
                  </div>
                  <div className="text-sm text-muted-foreground" data-testid={`text-group-progress-${groupIndex}`}>
                    {group.tests.filter(t => t.status === 'passed').length}/{group.tests.length} passed
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {group.tests.map((test, testIndex) => (
                    <div 
                      key={testIndex}
                      className="flex items-center justify-between p-3 rounded-lg border hover-elevate"
                      data-testid={`test-item-${groupIndex}-${testIndex}`}
                    >
                      <div className="flex items-center gap-3">
                        {getStatusIcon(test.status)}
                        <div>
                          <p className="font-medium" data-testid={`text-test-name-${groupIndex}-${testIndex}`}>{test.name}</p>
                          {test.message && (
                            <p className="text-sm text-muted-foreground" data-testid={`text-test-message-${groupIndex}-${testIndex}`}>
                              {test.message}
                            </p>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        {test.duration !== undefined && (
                          <span className="text-xs text-muted-foreground" data-testid={`text-test-duration-${groupIndex}-${testIndex}`}>
                            {test.duration.toFixed(0)}ms
                          </span>
                        )}
                        {getStatusBadge(test.status)}
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Device Info */}
        <Card data-testid="card-device-info">
          <CardHeader>
            <CardTitle data-testid="title-device-info">Device Information</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <p className="text-muted-foreground">User Agent</p>
                <p className="font-mono text-xs break-all" data-testid="text-user-agent">{navigator.userAgent}</p>
              </div>
              <div>
                <p className="text-muted-foreground">Platform</p>
                <p className="font-mono" data-testid="text-platform">{navigator.platform}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Hidden canvas for WebGL testing */}
        <canvas
          ref={canvasRef}
          width={512}
          height={512}
          className="hidden"
          data-testid="canvas-webgl-test"
        />
      </div>
    </div>
  );
}
