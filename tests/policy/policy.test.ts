import { describe, expect, it } from "vitest";
import { decidePolicy } from "@/lib/policy/policy";
import type { RiskAssessment } from "@/lib/types/domain";

function assessment(risk_band: RiskAssessment["risk_band"], overrides: Partial<RiskAssessment> = {}): RiskAssessment {
  return {
    assessment_id: "risk-1",
    case_id: "case-PM-27",
    safety_incident_risk_score: 0.7,
    prediction_horizon: "15m",
    evidence_authority: "SYNTHETIC_DATA",
    risk_band,
    confidence: "high",
    uncertainty_reason: null,
    top_risk_reasons: ["reason"],
    created_at: "2026-08-19T09:14:02+08:00",
    ...overrides
  };
}

describe("policy engine", () => {
  it("keeps disruptive actions behind approval", () => {
    const decision = decidePolicy(assessment("High"), {
      case_id: "case-PM-27",
      vehicle_id: "PM-27",
      status: "monitoring",
      current_risk: 0.7,
      previous_risk: 0.66,
      confidence: "high",
      risk_reasons: ["reason"],
      recommended_action: "Driver advisory and supervisor notification sent.",
      authority_class: "Supervisor report required",
      pending_approval: false,
      created_at: "2026-08-19T09:14:02+08:00",
      updated_at: "2026-08-19T09:15:26+08:00"
    });
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
    const decision = decidePolicy(assessment("High", { confidence: "low" }));
    expect(decision.authorityClass).toBe("Urgent escalation required");
    expect(decision.toolNames).toEqual(["notify_supervisor"]);
  });
});
