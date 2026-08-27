import type { ApprovalRequest, ReviewRequest, RiskAssessment, SafetyCase, ToolCall, VehicleCase, VehicleEvent } from "@/lib/types/domain";

let toolCounter = 0;

function nextToolId() {
  toolCounter += 1;
  return `tool-${toolCounter.toString().padStart(4, "0")}`;
}

export function resetToolCounter() {
  toolCounter = 0;
}

export function simulateTool(
  toolName: string,
  scenarioId: string,
  vehicleCase: VehicleCase,
  event: VehicleEvent,
  assessment: RiskAssessment,
  existingToolCalls: ToolCall[]
): ToolCall[] {
  const timestamp = event.timestamp;
  const base = {
    tool_call_id: nextToolId(),
    case_id: vehicleCase.case_id,
    tool_name: toolName,
    arguments: {
      vehicle_id: event.vehicle_id,
      risk_band: assessment.risk_band,
      score: assessment.safety_incident_risk_score
    },
    timestamp
  };

  if (
    scenarioId === "pm27-persistent-high-risk" &&
    toolName === "notify_supervisor" &&
    !existingToolCalls.some((call) => call.tool_name === "notify_supervisor" && call.status === "failed")
  ) {
    return [
      {
        ...base,
        status: "failed",
        result: null,
        error: "timeout"
      },
      {
        tool_call_id: nextToolId(),
        case_id: vehicleCase.case_id,
        tool_name: "fallback_notify_supervisor",
        arguments: base.arguments,
        status: "delivered",
        result: "Fallback supervisor notification delivered.",
        error: null,
        timestamp
      }
    ];
  }

  if (toolName === "request_human_approval") {
    return [
      {
        ...base,
        status: "pending",
        result: "Approval request opened for zone advisory.",
        error: null
      }
    ];
  }

  return [
    {
      ...base,
      status: toolName === "recommend_zone_advisory" ? "recommended" : "delivered",
      result: `${toolName} completed.`,
      error: null
    }
  ];
}


export function createReviewRequest(vehicleCase: VehicleCase, assessment: RiskAssessment): ReviewRequest {
  return {
    review_id: `review-${assessment.assessment_id}`,
    case_id: vehicleCase.case_id,
    reason: assessment.uncertainty_reason ?? "Risk evidence requires human review.",
    evidence: [
      `Risk ${assessment.safety_incident_risk_score.toFixed(2)} (${assessment.risk_band}) with ${assessment.confidence} confidence.`,
      ...assessment.top_risk_reasons
    ],
    status: "pending",
    reviewer: null,
    outcome: null,
    decision_time: null
  };
}

export function createApprovalRequest(vehicleCase: VehicleCase, assessment: RiskAssessment): ApprovalRequest {
  return {
    approval_id: `approval-${vehicleCase.case_id}`,
    case_id: vehicleCase.case_id,
    requested_action: "Recommend zone advisory for nearby Prime Movers.",
    rationale: assessment.top_risk_reasons.join(" "),
    status: "pending",
    approver: null,
    decision_time: null
  };
}

export function createSafetyCase(vehicleCase: VehicleCase, assessment: RiskAssessment, evidence: string[]): SafetyCase {
  return {
    safety_case_id: "SC-1007",
    case_id: vehicleCase.case_id,
    summary: `${vehicleCase.vehicle_id} escalated after persistent high safety incident risk.`,
    evidence: [
      `Latest risk score ${assessment.safety_incident_risk_score.toFixed(2)} (${assessment.risk_band}).`,
      ...evidence
    ],
    created_at: new Date().toISOString(),
    status: "created"
  };
}
