import { describe, expect, it } from "vitest";
import { decidePolicy, evaluateZoneAdvisoryEvidence } from "@/lib/policy/policy";
import type { RiskAssessment } from "@/lib/types/domain";

function assessment(risk_band: RiskAssessment["risk_band"]): RiskAssessment {
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
    created_at: "2026-08-19T09:14:02+08:00"
  };
}

describe("policy engine", () => {
  it("holds a zone advisory when persistent vehicle risk has no corroborating evidence", () => {
    const decision = decidePolicy(assessment("Persistent High"), {
      zoneOperationalRisk: 0.54,
      elevatedVehicleCountInZone: 1,
      sharedHazardContext: true
    });

    expect(decision.shouldRequestApproval).toBe(false);
    expect(decision.authorityClass).toBe("Supervisor report required");
    expect(decision.toolNames).toEqual(["notify_supervisor"]);
    expect(decision.zoneAdvisoryEvidence?.eligible).toBe(false);
  });

  it("opens zone advisory authorization when zone operational risk corroborates persistent risk", () => {
    const decision = decidePolicy(assessment("Persistent High"), {
      zoneOperationalRisk: 0.78,
      elevatedVehicleCountInZone: 1,
      sharedHazardContext: true
    });

    expect(decision.shouldRequestApproval).toBe(true);
    expect(decision.authorityClass).toBe("Human approval required");
    expect(decision.toolNames).toContain("request_human_approval");
    expect(decision.zoneAdvisoryEvidence?.eligible).toBe(true);
  });

  it("opens zone advisory authorization for multiple elevated vehicles sharing hazardous context", () => {
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
    expect(decision.shouldRequestApproval).toBe(false);
  });

  it("escalates critical or low-confidence high risk to human review", () => {
    const decision = decidePolicy(assessment("Critical / Low Confidence"));
    expect(decision.authorityClass).toBe("Urgent escalation required");
    expect(decision.toolNames).toEqual(["notify_supervisor"]);
  });
});
