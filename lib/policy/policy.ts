import type { ApprovalReasonCode, RiskAssessment, VehicleCase } from "@/lib/types/domain";

export const ZONE_ADVISORY_OPERATIONAL_RISK_THRESHOLD = 0.65;
export const ZONE_ADVISORY_MIN_ELEVATED_VEHICLES = 2;

export interface ZoneAdvisoryPolicyContext {
  zoneOperationalRisk: number | null;
  elevatedVehicleCountInZone: number;
  sharedHazardContext: boolean;
}

export interface ZoneAdvisoryEvidence {
  eligible: boolean;
  reasonCodes: ApprovalReasonCode[];
  reasons: string[];
}

export interface PolicyDecision {
  recommendedAction: string;
  authorityClass:
    | "Automatic monitoring"
    | "Automatic advisory"
    | "Supervisor report required"
    | "Signal review required"
    | "Zone action approval required"
    | "Urgent escalation required";
  toolNames: string[];
  shouldRequestReview: boolean;
  shouldRequestApproval: boolean;
  shouldCreateSafetyCase: boolean;
  nextStatus: VehicleCase["status"];
  zoneAdvisoryEvidence?: ZoneAdvisoryEvidence;
}

export function evaluateZoneAdvisoryEvidence(context?: ZoneAdvisoryPolicyContext): ZoneAdvisoryEvidence {
  if (!context) {
    return {
      eligible: false,
      reasonCodes: [],
      reasons: ["Zone advisory is gated until corroborating zone evidence is available."]
    };
  }

  const reasons: string[] = [];
  const reasonCodes: ApprovalReasonCode[] = [];
  if (context.zoneOperationalRisk !== null && context.zoneOperationalRisk >= ZONE_ADVISORY_OPERATIONAL_RISK_THRESHOLD) {
    reasonCodes.push("ZONE_RISK_CORROBORATED");
    reasons.push(
      `Zone operational risk ${context.zoneOperationalRisk.toFixed(2)} meets the ${ZONE_ADVISORY_OPERATIONAL_RISK_THRESHOLD.toFixed(2)} advisory gate.`
    );
  }

  if (context.elevatedVehicleCountInZone >= ZONE_ADVISORY_MIN_ELEVATED_VEHICLES && context.sharedHazardContext) {
    reasonCodes.push("MULTIPLE_ELEVATED_VEHICLES");
    reasons.push(
      `${context.elevatedVehicleCountInZone} elevated-risk Prime Movers share the same hazardous zone context.`
    );
  }

  return {
    eligible: reasons.length > 0,
    reasonCodes,
    reasons: reasons.length ? reasons : ["Persistent vehicle risk lacks corroborating zone-level or multi-vehicle evidence."]
  };
}

export function decidePolicy(assessment: RiskAssessment, currentCase?: VehicleCase, advisoryContext?: ZoneAdvisoryPolicyContext): PolicyDecision {
  const isCritical = assessment.safety_incident_risk_score >= 0.85;
  const isLowConfidenceHighRisk = assessment.confidence === "low" && assessment.safety_incident_risk_score >= 0.65;
  const isPersistentHighRisk =
    assessment.risk_band === "High" && Boolean(currentCase && currentCase.current_risk >= 0.65);

  if (isCritical || isLowConfidenceHighRisk) {
    return {
      recommendedAction: "Review signal quality before taking stronger action.",
      authorityClass: "Signal review required",
      toolNames: ["notify_supervisor"],
      shouldRequestReview: true,
      shouldRequestApproval: false,
      shouldCreateSafetyCase: false,
      nextStatus: "pending_review"
    };
  }

  if (isPersistentHighRisk) {
    const evidence = evaluateZoneAdvisoryEvidence(advisoryContext);
    if (!evidence.eligible) {
      return {
        recommendedAction: "Keep monitoring; zone action needs more corroborating evidence.",
        authorityClass: "Supervisor report required",
        toolNames: ["notify_supervisor"],
        shouldRequestReview: false,
        shouldRequestApproval: false,
        shouldCreateSafetyCase: false,
        nextStatus: "monitoring",
        zoneAdvisoryEvidence: evidence
      };
    }

    return {
      recommendedAction: "Persistent risk is corroborated; zone action approval requested.",
      authorityClass: "Zone action approval required",
      toolNames: ["request_human_approval"],
      shouldRequestReview: false,
      shouldRequestApproval: true,
      shouldCreateSafetyCase: false,
      nextStatus: "pending_approval",
      zoneAdvisoryEvidence: evidence
    };
  }

  switch (assessment.risk_band) {
    case "Low":
      return {
        recommendedAction: "Continue monitoring.",
        authorityClass: "Automatic monitoring",
        toolNames: [],
        shouldRequestReview: false,
        shouldRequestApproval: false,
        shouldCreateSafetyCase: false,
        nextStatus: "stabilized"
      };
    case "Medium":
      return {
        recommendedAction: "Driver advisory sent. Monitoring active.",
        authorityClass: "Automatic advisory",
        toolNames: ["notify_driver"],
        shouldRequestReview: false,
        shouldRequestApproval: false,
        shouldCreateSafetyCase: false,
        nextStatus: "monitoring"
      };
    case "High":
      return {
        recommendedAction: "Driver advisory and supervisor notification sent.",
        authorityClass: "Supervisor report required",
        toolNames: ["notify_driver", "notify_supervisor"],
        shouldRequestReview: false,
        shouldRequestApproval: false,
        shouldCreateSafetyCase: false,
        nextStatus: "monitoring"
      };
    case "Critical":
      return {
        recommendedAction: "Review signal quality before taking stronger action.",
        authorityClass: "Signal review required",
        toolNames: ["notify_supervisor"],
        shouldRequestReview: true,
        shouldRequestApproval: false,
        shouldCreateSafetyCase: false,
        nextStatus: "pending_review"
      };
  }
}
