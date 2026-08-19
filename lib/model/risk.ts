import type { Confidence, RiskBand } from "@/lib/types/domain";

export function riskBandFor(score: number, confidence: Confidence, previousActionTaken = false): RiskBand {
  if (confidence === "low" && score >= 0.65) return "Critical / Low Confidence";
  if (previousActionTaken && score >= 0.65 && score <= 0.84) return "Persistent High";
  if (score >= 0.85) return "Critical / Low Confidence";
  if (score >= 0.65) return "High";
  if (score >= 0.4) return "Medium";
  return "Low";
}
