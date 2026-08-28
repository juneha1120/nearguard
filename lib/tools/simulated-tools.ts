import type { ApprovalRequest, RiskAssessment, SafetyCase, ScenarioToolOutcome, ToolCall, VehicleCase, VehicleEvent } from "@/lib/types/domain";

let toolCounter = 0;

function nextToolId() {
  toolCounter += 1;
  return `tool-${toolCounter.toString().padStart(4, "0")}`;
}

function addSeconds(timestamp: string, seconds: number) {
  return new Date(new Date(timestamp).getTime() + seconds * 1000).toISOString();
}

export function resetToolCounter() {
  toolCounter = 0;
}

export function simulateTool(
  toolName: string,
  scenarioToolOutcomes: ScenarioToolOutcome[] | undefined,
  vehicleCase: VehicleCase,
  event: VehicleEvent,
  assessment: RiskAssessment,
  existingToolCalls: ToolCall[]
): ToolCall[] {
  const defaultOffset = toolName === "notify_driver" ? 5 : toolName === "request_human_approval" ? 6 : 6;
  const timestamp = addSeconds(event.timestamp, defaultOffset);
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

  const scriptedOutcome = scenarioToolOutcomes?.find(
    (outcome) =>
      outcome.event_id === event.event_id &&
      outcome.tool_name === toolName &&
      !existingToolCalls.some((call) => call.tool_name === outcome.tool_name && call.timestamp === addSeconds(event.timestamp, outcome.offset_seconds ?? defaultOffset))
  );

  if (scriptedOutcome) {
    const scriptedCall: ToolCall = {
      ...base,
      status: scriptedOutcome.status,
      result: scriptedOutcome.result,
      error: scriptedOutcome.error,
      timestamp: addSeconds(event.timestamp, scriptedOutcome.offset_seconds ?? defaultOffset)
    };

    if (!scriptedOutcome.fallback) return [scriptedCall];

    return [
      scriptedCall,
      {
        ...base,
        tool_call_id: nextToolId(),
        tool_name: scriptedOutcome.fallback.tool_name,
        arguments: base.arguments,
        status: scriptedOutcome.fallback.status,
        result: scriptedOutcome.fallback.result,
        error: scriptedOutcome.fallback.error,
        timestamp: addSeconds(event.timestamp, scriptedOutcome.fallback.offset_seconds ?? defaultOffset + 1)
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

export function createSafetyCase(vehicleCase: VehicleCase, assessment: RiskAssessment, evidence: string[], createdAt = new Date().toISOString()): SafetyCase {
  return {
    safety_case_id: "SC-1007",
    case_id: vehicleCase.case_id,
    summary: `${vehicleCase.vehicle_id} escalated after persistent high safety incident risk.`,
    evidence: [
      `Latest risk score ${assessment.safety_incident_risk_score.toFixed(2)} (${assessment.risk_band}).`,
      ...evidence
    ],
    created_at: createdAt,
    status: "created"
  };
}
