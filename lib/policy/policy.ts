import type { RiskAssessment, VehicleCase } from "@/lib/types/domain";

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
}

export function decidePolicy(assessment: RiskAssessment, currentCase?: VehicleCase): PolicyDecision {
  const isCritical = assessment.safety_incident_risk_score >= 0.85;
  const isLowConfidenceHighRisk = assessment.confidence === "low" && assessment.safety_incident_risk_score >= 0.65;
  const isPersistentHighRisk =
    assessment.risk_band === "High" && Boolean(currentCase && currentCase.current_risk >= 0.65);

  if (isCritical || isLowConfidenceHighRisk) {
    return {
      recommendedAction: "Supervisor review request sent.",
      authorityClass: "Urgent escalation required",
      toolNames: ["notify_supervisor"],
      shouldRequestApproval: false,
      shouldCreateSafetyCase: false,
      nextStatus: "escalated"
    };
  }

  if (isPersistentHighRisk) {
    return {
      recommendedAction: "Zone advisory approval requested.",
      authorityClass: "Human approval required",
      toolNames: ["request_human_approval"],
      shouldRequestApproval: true,
      shouldCreateSafetyCase: false,
      nextStatus: "pending_approval"
    };
  }

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
    case "Critical":
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
