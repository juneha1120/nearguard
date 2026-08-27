import type { RiskAssessment, VehicleCase } from "@/lib/types/domain";

export const ZONE_ADVISORY_OPERATIONAL_RISK_THRESHOLD = 0.65;
export const ZONE_ADVISORY_MIN_ELEVATED_VEHICLES = 2;

export interface ZoneAdvisoryPolicyContext {
  zoneOperationalRisk: number | null;
  elevatedVehicleCountInZone: number;
  sharedHazardContext: boolean;
}

export interface ZoneAdvisoryEvidence {
  eligible: boolean;
  reasons: string[];
}

export interface PolicyDecision {
  recommendedAction: string;
  authorityClass:
    | "Automatic monitoring"
    | "Automatic advisory"
    | "Supervisor report required"
    | "Human approval required"
    | "Urgent escalation required";
  toolNames: string[];
  shouldRequestApproval: boolean;
  shouldCreateSafetyCase: boolean;
  nextStatus: VehicleCase["status"];
  zoneAdvisoryEvidence?: ZoneAdvisoryEvidence;
}

export function evaluateZoneAdvisoryEvidence(context?: ZoneAdvisoryPolicyContext): ZoneAdvisoryEvidence {
  if (!context) {
    return {
      eligible: false,
      reasons: ["Zone advisory is gated until corroborating zone evidence is available."]
    };
  }

  const reasons: string[] = [];
  if (context.zoneOperationalRisk !== null && context.zoneOperationalRisk >= ZONE_ADVISORY_OPERATIONAL_RISK_THRESHOLD) {
    reasons.push(
      `Zone operational risk ${context.zoneOperationalRisk.toFixed(2)} meets the ${ZONE_ADVISORY_OPERATIONAL_RISK_THRESHOLD.toFixed(2)} advisory gate.`
    );
  }

  if (context.elevatedVehicleCountInZone >= ZONE_ADVISORY_MIN_ELEVATED_VEHICLES && context.sharedHazardContext) {
    reasons.push(
      `${context.elevatedVehicleCountInZone} elevated-risk Prime Movers share the same hazardous zone context.`
    );
  }

  return {
    eligible: reasons.length > 0,
    reasons: reasons.length ? reasons : ["Persistent vehicle risk lacks corroborating zone-level or multi-vehicle evidence."]
  };
}

export function decidePolicy(assessment: RiskAssessment, context?: ZoneAdvisoryPolicyContext): PolicyDecision {
  switch (assessment.risk_band) {
    case "Low":
      return {
        recommendedAction: "Continue monitoring.",
        authorityClass: "Automatic monitoring",
        toolNames: [],
        shouldRequestApproval: false,
        shouldCreateSafetyCase: false,
        nextStatus: "stabilized"
      };
    case "Medium":
      return {
        recommendedAction: "Driver advisory sent. Monitoring active.",
        authorityClass: "Automatic advisory",
        toolNames: ["notify_driver"],
        shouldRequestApproval: false,
        shouldCreateSafetyCase: false,
        nextStatus: "monitoring"
      };
    case "High":
      return {
        recommendedAction: "Driver advisory and supervisor notification sent.",
        authorityClass: "Supervisor report required",
        toolNames: ["notify_driver", "notify_supervisor"],
        shouldRequestApproval: false,
        shouldCreateSafetyCase: false,
        nextStatus: "monitoring"
      };
    case "Persistent High": {
      const evidence = evaluateZoneAdvisoryEvidence(context);
      if (!evidence.eligible) {
        return {
          recommendedAction: "Persistent vehicle risk detected; zone advisory held pending corroborating zone evidence.",
          authorityClass: "Supervisor report required",
          toolNames: ["notify_supervisor"],
          shouldRequestApproval: false,
          shouldCreateSafetyCase: false,
          nextStatus: "monitoring",
          zoneAdvisoryEvidence: evidence
        };
      }

      return {
        recommendedAction: "Corroborating evidence met; zone advisory approval requested.",
        authorityClass: "Human approval required",
        toolNames: ["request_human_approval"],
        shouldRequestApproval: true,
        shouldCreateSafetyCase: false,
        nextStatus: "pending_approval",
        zoneAdvisoryEvidence: evidence
      };
    }
    case "Critical / Low Confidence":
      return {
        recommendedAction: "Supervisor review request sent.",
        authorityClass: "Urgent escalation required",
        toolNames: ["notify_supervisor"],
        shouldRequestApproval: false,
        shouldCreateSafetyCase: false,
        nextStatus: "escalated"
      };
  }
}
