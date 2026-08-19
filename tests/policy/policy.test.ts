import { describe, expect, it } from "vitest";
import { decidePolicy } from "@/lib/policy/policy";
import type { RiskAssessment } from "@/lib/types/domain";

function assessment(risk_band: RiskAssessment["risk_band"]): RiskAssessment {
  return {
    assessment_id: "risk-1",
    case_id: "case-PM-27",
    safety_incident_risk_score: 0.7,
    risk_band,
    confidence: "high",
    uncertainty_reason: null,
    top_risk_reasons: ["reason"],
    created_at: "2026-08-19T09:14:02+08:00"
  };
}

describe("policy engine", () => {
  it("keeps disruptive actions behind approval", () => {
    const decision = decidePolicy(assessment("Persistent High"));
    expect(decision.shouldRequestApproval).toBe(true);
    expect(decision.authorityClass).toBe("Human approval required");
    expect(decision.toolNames).toContain("request_human_approval");
  });

  it("notifies driver and supervisor for high risk", () => {
    const decision = decidePolicy(assessment("High"));
    expect(decision.toolNames).toEqual(["notify_driver", "notify_supervisor"]);
    expect(decision.shouldRequestApproval).toBe(false);
  });

  it("escalates critical or low-confidence high risk to human review", () => {
    const decision = decidePolicy(assessment("Critical / Low Confidence"));
    expect(decision.authorityClass).toBe("Urgent escalation required");
    expect(decision.toolNames).toEqual(["notify_supervisor"]);
  });
});
