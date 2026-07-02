declare module '@/legacy/dashboard.js' {
  export const EMOTION_COLORS: Record<string, string>;
  export const NAMED_3x3_ZONES: string[];

  export function parseTime(value: unknown): number;
  export function getSessionId(item: unknown): string;
  export function normalizedEmotion(value: unknown): string;
  export function titleCase(value: unknown): string;
  export function clamp01(value: unknown): number;
  export function normAffect(value: unknown): number | null;
  export function percent(value: unknown): string;
  export function formatNumber(value: unknown): string;
  export function colorFor(label: unknown): string;
  export function shortDateTime(value: unknown): string;

  export function enrichWindows(rawWindows: unknown[]): any[];
  export function buildSequencesFromWindows(windows: any[]): string[][];
  export function computeTna(windows: any[]): any | null;
  export function computeTnaFromSequences(sequences: string[][]): any | null;
  export function summarizeKpis(
    windows: any[],
    logs?: any[],
    metrics?: any[],
  ): {
    events: number;
    metrics: number;
    windows: number;
    errors: number;
    warnings: number;
    latestQuality: string;
    analyzedWindows: number;
    latestState: string;
    affectSpeed: string;
    instability: string;
    phase: string;
    sampleLatency: string;
  };

  export function drawTimeline(canvas: HTMLCanvasElement, windows: any[]): void;
  export function drawDistribution(canvas: HTMLCanvasElement, windows: any[]): void;
  export function drawNetwork(
    container: HTMLElement,
    result: any | null,
  ): { nodes: number; edges: number };
  export function drawDynamics(canvas: HTMLCanvasElement, windows: any[]): void;
  export function drawSequenceDistribution(canvas: HTMLCanvasElement, result: any | null): void;
  export function renderCentralityTable(tbody: HTMLTableSectionElement, result: any | null): void;
  export function renderPatternsTable(tbody: HTMLTableSectionElement, result: any | null): void;
  export function renderMatrixHeatmap(container: HTMLElement, result: any | null): void;
  export function renderIndexPlotPanel(container: HTMLElement, result: any | null): void;
  export function renderDistributionPlotPanel(container: HTMLElement, result: any | null): void;
  export function renderSequenceSummary(wrap: HTMLElement, result: any | null): void;

  export function summarizeGazeKpis(gazeWindows: any[]): {
    windows: number;
    meanSigma: string;
    meanValid: string;
    offScreen: string;
    calibration: string;
    calibrationDetail: string | null;
    samples: number;
  };
  export function renderGazeHeatmap(
    canvas: HTMLCanvasElement,
    legendEl: HTMLElement | null,
    gazeWindows: any[],
    aois?: any[],
  ): { meta: string };
  export function renderGazeScanpath(
    container: HTMLElement,
    legendEl: HTMLElement | null,
    gazeWindows: any[],
    aois?: any[],
    options?: {
      nodeMetric?: 'instrength' | 'outstrength' | 'visits';
      edgeMetric?: 'counts' | 'probabilities';
      showSelfLoops?: boolean;
    },
  ): { meta: string };
  export function renderGazeZoneRef(root: HTMLElement, gazeWindows: any[]): { meta: string };
  export function renderGazeQuality(canvas: HTMLCanvasElement, gazeWindows: any[]): void;
  export function renderGazeAoi(canvas: HTMLCanvasElement, gazeWindows: any[]): void;
  export function renderGazeCalibration(canvas: HTMLCanvasElement, gazeWindows: any[]): void;
  export function renderGazeTable(tbody: HTMLTableSectionElement, gazeWindows: any[]): void;
}
