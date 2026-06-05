import type { ParsedRecord } from "./parser.js";

export const DEFAULT_PARSER_CONFIDENCE_THRESHOLD = 0.6;

export interface ParserCalibrationSample {
  name: string;
  expectedAccept: boolean;
  parsed: ParsedRecord;
}

export interface ParserCalibrationOptions {
  candidateThresholds?: number[];
}

export interface ParserCalibrationResult {
  recommendedThreshold: number;
  falseAccepts: number;
  falseRejects: number;
  total: number;
  evaluated: Array<{
    threshold: number;
    falseAccepts: number;
    falseRejects: number;
  }>;
}

const DEFAULT_CANDIDATE_THRESHOLDS = [
  0.5,
  DEFAULT_PARSER_CONFIDENCE_THRESHOLD,
  0.7,
  0.8,
  0.9,
];

function normalizeThresholds(thresholds: number[]): number[] {
  const unique = new Set<number>();
  for (const threshold of thresholds) {
    if (!Number.isFinite(threshold) || threshold < 0 || threshold > 1) {
      throw new Error(`Invalid parser confidence threshold: ${threshold}`);
    }
    unique.add(threshold);
  }
  return [...unique].sort((a, b) => a - b);
}

function errorCounts(samples: ParserCalibrationSample[], threshold: number) {
  let falseAccepts = 0;
  let falseRejects = 0;
  for (const sample of samples) {
    const accepted = sample.parsed.confidence >= threshold;
    if (accepted && !sample.expectedAccept) falseAccepts += 1;
    if (!accepted && sample.expectedAccept) falseRejects += 1;
  }
  return { falseAccepts, falseRejects };
}

export function calibrateParserThreshold(
  samples: ParserCalibrationSample[],
  options: ParserCalibrationOptions = {},
): ParserCalibrationResult {
  if (samples.length === 0) {
    throw new Error("Parser calibration requires at least one sample");
  }

  const candidateThresholds = normalizeThresholds(options.candidateThresholds ?? DEFAULT_CANDIDATE_THRESHOLDS);
  const evaluated = candidateThresholds.map(threshold => ({
    threshold,
    ...errorCounts(samples, threshold),
  }));

  const zeroError = evaluated.filter(item => item.falseAccepts === 0 && item.falseRejects === 0);
  const best = zeroError.length > 0
    ? zeroError[0]!
    : [...evaluated].sort((a, b) => {
        const aErrors = a.falseAccepts + a.falseRejects;
        const bErrors = b.falseAccepts + b.falseRejects;
        if (aErrors !== bErrors) return aErrors - bErrors;
        if (a.falseAccepts !== b.falseAccepts) return a.falseAccepts - b.falseAccepts;
        return b.threshold - a.threshold;
      })[0]!;

  return {
    recommendedThreshold: best.threshold,
    falseAccepts: best.falseAccepts,
    falseRejects: best.falseRejects,
    total: samples.length,
    evaluated,
  };
}
