import type { RiskAssessment, VehicleCase } from "@/lib/types/domain";

export interface PolicyDecision {
  recommendedAction: string;
  authorityClass:
    | "Automatic monitoring"
    | "Automatic advisory"
    | "Supervisor report required"
    | "Human review required"
    | "Human approval required"
    | "Urgent escalation required";
  toolNames: string[];
  shouldRequestReview: boolean;
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
    case "Persistent High":
      return {
        recommendedAction: "Zone advisory approval requested.",
        authorityClass: "Human approval required",
        toolNames: ["request_human_approval"],
        shouldRequestReview: false,
        shouldRequestApproval: true,
        shouldCreateSafetyCase: false,
        nextStatus: "pending_approval"
      };
    case "Critical / Low Confidence":
      return {
        recommendedAction: "Evidence quality requires human review before any stronger action.",
        authorityClass: "Human review required",
        toolNames: ["notify_supervisor"],
        shouldRequestReview: true,
        shouldRequestApproval: false,
        shouldCreateSafetyCase: false,
        nextStatus: "pending_review"
      };
  }
}
