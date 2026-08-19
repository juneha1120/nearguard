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
        recommendedAction: "Monitor case briefly and wait for updated telemetry.",
        authorityClass: "Automatic monitoring",
        toolNames: [],
        shouldRequestApproval: false,
        shouldCreateSafetyCase: false,
        nextStatus: "stabilized"
      };
    case "Medium":
      return {
        recommendedAction: "Send concise driver advisory and continue monitoring.",
        authorityClass: "Automatic advisory",
        toolNames: ["notify_driver"],
        shouldRequestApproval: false,
        shouldCreateSafetyCase: false,
        nextStatus: "monitoring"
      };
    case "High":
      return {
        recommendedAction: "Warn driver and notify operations supervisor with risk reasons.",
        authorityClass: "Supervisor report required",
        toolNames: ["notify_driver", "notify_supervisor"],
        shouldRequestApproval: false,
        shouldCreateSafetyCase: false,
        nextStatus: "monitoring"
      };
    case "Persistent High":
      return {
        recommendedAction: "Request approval for zone advisory and prepare safety case evidence.",
        authorityClass: "Human approval required",
        toolNames: ["request_human_approval"],
        shouldRequestApproval: true,
        shouldCreateSafetyCase: false,
        nextStatus: "pending_approval"
      };
    case "Critical / Low Confidence":
      return {
        recommendedAction: "Escalate to safety supervisor for human review with uncertainty reason.",
        authorityClass: "Urgent escalation required",
        toolNames: ["notify_supervisor"],
        shouldRequestApproval: false,
        shouldCreateSafetyCase: false,
        nextStatus: "escalated"
      };
  }
}
