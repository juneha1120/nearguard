import type { Confidence, RiskBand } from "@/lib/types/domain";

export function riskBandFor(score: number, confidence: Confidence, previousActionTaken = false): RiskBand {
  void confidence;
  void previousActionTaken;
  if (score >= 0.85) return "Critical";
  if (score >= 0.65) return "High";
  if (score >= 0.4) return "Medium";
  return "Low";
}
