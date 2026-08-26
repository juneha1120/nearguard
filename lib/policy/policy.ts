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

export function decidePolicy(assessment: RiskAssessment): PolicyDecision {
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
        recommendedAction: "Driver advisory sent; continue monitoring.",
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
    case "Persistent High":
      return {
        recommendedAction: "Zone advisory approval requested.",
        authorityClass: "Human approval required",
        toolNames: ["request_human_approval"],
        shouldRequestApproval: true,
        shouldCreateSafetyCase: false,
        nextStatus: "pending_approval"
      };
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
