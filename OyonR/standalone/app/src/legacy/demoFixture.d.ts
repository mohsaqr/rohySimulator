declare module '@/legacy/demoFixture.js' {
  export function generateDemoFixture(): {
    windows: any[];
    metrics: any[];
    events: any[];
  };
  export function loadDemoData(): void;
  export function clearAllStreams(): void;
}
