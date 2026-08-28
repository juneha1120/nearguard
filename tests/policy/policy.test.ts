import { describe, expect, it } from "vitest";
import { decidePolicy, evaluateZoneAdvisoryEvidence } from "@/lib/policy/policy";
import type { RiskAssessment, VehicleCase } from "@/lib/types/domain";

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
  const priorHighRiskCase: VehicleCase = {
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
  };

  it("holds a zone advisory when persistent vehicle risk has no corroborating evidence", () => {
    const decision = decidePolicy(assessment("High"), priorHighRiskCase, {
      zoneOperationalRisk: 0.54,
      elevatedVehicleCountInZone: 1,
      sharedHazardContext: true
    });
    expect(decision.shouldRequestApproval).toBe(false);
    expect(decision.authorityClass).toBe("Supervisor report required");
    expect(decision.toolNames).toEqual(["notify_supervisor"]);
    expect(decision.zoneAdvisoryEvidence?.eligible).toBe(false);
  });

  it("opens zone action approval when zone operational risk corroborates persistent risk", () => {
    const decision = decidePolicy(assessment("High"), priorHighRiskCase, {
      zoneOperationalRisk: 0.78,
      elevatedVehicleCountInZone: 1,
      sharedHazardContext: true
    });
    expect(decision.shouldRequestReview).toBe(false);
    expect(decision.shouldRequestApproval).toBe(true);
    expect(decision.authorityClass).toBe("Zone action approval required");
    expect(decision.toolNames).toContain("request_human_approval");
    expect(decision.zoneAdvisoryEvidence?.eligible).toBe(true);
  });

  it("opens zone action approval for multiple elevated vehicles sharing hazardous context", () => {
    const evidence = evaluateZoneAdvisoryEvidence({
      zoneOperationalRisk: 0.51,
      elevatedVehicleCountInZone: 2,
      sharedHazardContext: true
    });

    expect(evidence.eligible).toBe(true);
    expect(evidence.reasons.join(" ")).toMatch(/2 elevated-risk Prime Movers/);
  });

  it("does not treat multiple vehicles as corroboration without shared hazardous context", () => {
    const evidence = evaluateZoneAdvisoryEvidence({
      zoneOperationalRisk: 0.51,
      elevatedVehicleCountInZone: 2,
      sharedHazardContext: false
    });

    expect(evidence.eligible).toBe(false);
  });

  it("notifies driver and supervisor for high risk", () => {
    const decision = decidePolicy(assessment("High"));
    expect(decision.toolNames).toEqual(["notify_driver", "notify_supervisor"]);
    expect(decision.shouldRequestReview).toBe(false);
    expect(decision.shouldRequestApproval).toBe(false);
  });

  it("routes low-confidence high risk to signal review, not zone approval", () => {
    const decision = decidePolicy(assessment("High", { confidence: "low" }));
    expect(decision.authorityClass).toBe("Signal review required");
    expect(decision.shouldRequestReview).toBe(true);
    expect(decision.shouldRequestApproval).toBe(false);
    expect(decision.toolNames).toEqual(["notify_supervisor"]);
    expect(decision.nextStatus).toBe("pending_review");
  });
});
