import type { DetectorStatus } from '../types';

export interface VolumeWindow {
  itemId: string;
  spanStart: number;
  spanEnd: number;
  length: number;
  count: number;
  baselineWindows: number;
  median: number;
  mad: number;
  scale: number;
  z: number;
}
export type SpanStatus = 'flagged' | 'volume-only' | 'unassessable' | 'not-tested';
export type SpanReason = 'thin-reference' | 'item-cap' | 'dataset-cap';
export interface BurstSpan {
  itemId: string;
  /** Inclusive UTC day indices. */
  spanStart: number;
  spanEnd: number;
  maxZ: number;
  windows: VolumeWindow[];
  status: SpanStatus;
  reason: SpanReason | null;
  inSpanCount: number;
  referenceCount: number;
  meanInSpan: number | null;
  meanReference: number | null;
  /** Signed mean(in span) - mean(reference). */
  shift: number | null;
  verifiedShare: number | null;
  pValue: number | null;
  holmThreshold: number | null;
}
export type ItemReason = 'too-few-reviews' | 'too-young' | 'insufficient-baseline-history' | 'thin-reference' | 'item-cap' | 'dataset-cap';
export interface ItemDetection {
  itemId: string;
  status: DetectorStatus;
  reasons: ItemReason[];
  candidateWindowCount: number;
  assessableWindowCount: number;
  unassessableWindowCount: number;
  spanCount: number;
  testedSpanCount: number;
}
export interface DetectionResult {
  schema: 'bursts-1';
  datasetHash: string;
  detectorConfigHash: string;
  status: DetectorStatus;
  /** Item-id order, plain objects for worker structured cloning. */
  items: ItemDetection[];
  /** All merged spans, including untested ones, in C17 priority order. */
  spans: BurstSpan[];
  testedSpanCount: number;
  diagnostics: { candidateDays: number; baselineWindowsEvaluated: number };
}
