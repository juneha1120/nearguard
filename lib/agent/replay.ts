import { getScenario, getScenarioPrediction, getZone } from "@/lib/data/repository";
import { deriveFeatures, recentVehicleEvents } from "@/lib/model/features";
import { riskBandFor } from "@/lib/model/risk";
import { decidePolicy } from "@/lib/policy/policy";
import { createApprovalRequest, createSafetyCase, resetToolCounter, simulateTool } from "@/lib/tools/simulated-tools";
import type {
  ApprovalRequest,
  ReplayState,
  RiskAssessment,
  Scenario,
  ToolCall,
  TraceEvent,
  VehicleCase,
  VehicleEvent,
  ZoneContext
} from "@/lib/types/domain";

let traceCounter = 0;
let assessmentCounter = 0;

function nextTraceId() {
  traceCounter += 1;
  return `trace-${traceCounter.toString().padStart(4, "0")}`;
}

function nextAssessmentId() {
  assessmentCounter += 1;
  return `risk-${assessmentCounter.toString().padStart(4, "0")}`;
}

function trace(caseId: string, timestamp: string, event_type: TraceEvent["event_type"], message: string, metadata = {}) {
  return {
    trace_id: nextTraceId(),
    case_id: caseId,
    timestamp,
    event_type,
    message,
    metadata
  };
}

export function validateEvent(event: VehicleEvent): string[] {
  const errors: string[] = [];
  if (!event.event_id) errors.push("event_id is required");
  if (!event.timestamp || Number.isNaN(new Date(event.timestamp).getTime())) errors.push("timestamp must be ISO 8601");
  if (!event.vehicle_id) errors.push("vehicle_id is required");
  if (!event.zone_id) errors.push("zone_id is required");
  if (event.speed < 0 || event.speed > 50) errors.push("speed must be between 0 and 50");
  if (![15, 25, 40].includes(event.speed_limit)) errors.push("speed_limit must be 15, 25 or 40");
  return errors;
}

export function createInitialReplayState(scenarioId?: string): ReplayState {
  traceCounter = 0;
  assessmentCounter = 0;
  resetToolCounter();
  const scenario = getScenario(scenarioId);
  return {
    selectedScenario: scenario,
    currentEventIndex: 0,
    activeCases: [],
    selectedCase: null,
    currentEvent: null,
    currentZone: null,
    latestFeatures: null,
    latestRiskAssessment: null,
    toolCalls: [],
    pendingApprovals: [],
    safetyCases: [],
    traceEvents: [],
    isComplete: scenario.events.length === 0
  };
}

function getOrCreateCase(state: ReplayState, event: VehicleEvent): VehicleCase {
  const existing = state.activeCases.find((item) => item.vehicle_id === event.vehicle_id);
  if (existing) return existing;
  return {
    case_id: `case-${event.vehicle_id}`,
    vehicle_id: event.vehicle_id,
    status: "open",
    current_risk: 0,
    previous_risk: 0,
    confidence: "medium",
    risk_reasons: [],
    recommended_action: "Collect initial telemetry.",
    authority_class: "Automatic monitoring",
    pending_approval: false,
    created_at: event.timestamp,
    updated_at: event.timestamp
  };
}

function missingContextForScenario(scenario: Scenario, event: VehicleEvent) {
  return scenario.scenario_id === "telemetry-uncertainty" && event.event_id !== "uncertain-003";
}

function buildAssessment(state: ReplayState, event: VehicleEvent, vehicleCase: VehicleCase): RiskAssessment {
  const prediction = getScenarioPrediction(state.selectedScenario.scenario_id, event.event_id);
  if (!prediction) {
    throw new Error(`Missing model prediction for ${state.selectedScenario.scenario_id}/${event.event_id}`);
  }
  const isUncertainHumanReview =
    state.selectedScenario.scenario_id === "telemetry-uncertainty" && event.event_id !== "uncertain-003";
  const score = isUncertainHumanReview ? Math.max(prediction.assessment.safety_incident_risk_score, 0.67) : prediction.assessment.safety_incident_risk_score;
  const topRiskReasons =
    event.event_type === "speed_normalized"
      ? ["Speed normalized below the zone limit.", "Risk trend is decreasing.", ...prediction.assessment.top_risk_reasons].slice(0, 4)
      : prediction.assessment.top_risk_reasons;
  const confidence = isUncertainHumanReview ? "low" : prediction.assessment.confidence;
  const uncertaintyReason =
    isUncertainHumanReview && prediction.assessment.uncertainty_reason
      ? prediction.assessment.uncertainty_reason
      : prediction.assessment.uncertainty_reason;
  return {
    assessment_id: nextAssessmentId(),
    case_id: vehicleCase.case_id,
    safety_incident_risk_score: score,
    risk_band: riskBandFor(score, confidence, vehicleCase.current_risk >= 0.65),
    confidence,
    uncertainty_reason: uncertaintyReason,
    top_risk_reasons: topRiskReasons,
    created_at: event.timestamp
  };
}

function updateCase(vehicleCase: VehicleCase, assessment: RiskAssessment, event: VehicleEvent, decision = decidePolicy(assessment)): VehicleCase {
  return {
    ...vehicleCase,
    previous_risk: vehicleCase.current_risk,
    current_risk: assessment.safety_incident_risk_score,
    confidence: assessment.confidence,
    risk_reasons: assessment.top_risk_reasons,
    recommended_action: decision.recommendedAction,
    authority_class: decision.authorityClass,
    status: decision.nextStatus,
    pending_approval: decision.shouldRequestApproval,
    updated_at: event.timestamp
  };
}

export function advanceReplay(inputState: ReplayState): ReplayState {
  if (inputState.isComplete) return inputState;

  const state = structuredClone(inputState) as ReplayState;
  const event = state.selectedScenario.events[state.currentEventIndex];
  const vehicleCase = getOrCreateCase(state, event);
  const traceEvents: TraceEvent[] = [];
  const validationErrors = validateEvent(event);

  traceEvents.push(trace(vehicleCase.case_id, event.timestamp, "event_received", `${event.vehicle_id} ${event.event_type} event received.`, { event }));

  if (validationErrors.length > 0) {
    traceEvents.push(trace(vehicleCase.case_id, event.timestamp, "validation_error", validationErrors.join("; "), { validationErrors }));
    return {
      ...state,
      currentEvent: event,
      selectedCase: vehicleCase,
      traceEvents: [...state.traceEvents, ...traceEvents],
      currentEventIndex: state.currentEventIndex + 1,
      isComplete: state.currentEventIndex + 1 >= state.selectedScenario.events.length
    };
  }

  const zone = getZone(event.zone_id);
  const missingContext = missingContextForScenario(state.selectedScenario, event);
  const zoneForFeatures: ZoneContext = zone ?? {
    zone_id: event.zone_id,
    zone_name: "Unavailable zone context",
    traffic_level: "high",
    weather: "rain",
    zone_historical_risk: 0.66,
    restriction_level: "restricted",
    slow_down_zone_active: false,
    pedestrian_exposure: "medium"
  };

  if (missingContext) {
    traceEvents.push(trace(vehicleCase.case_id, event.timestamp, "context_missing", "Zone context lookup unavailable; confidence will be reduced.", { zone_id: event.zone_id }));
  } else {
    traceEvents.push(trace(vehicleCase.case_id, event.timestamp, "context_enriched", `Zone context loaded: ${zoneForFeatures.zone_name}.`, { zone: zoneForFeatures }));
  }

  const processedEvents = state.selectedScenario.events.slice(0, state.currentEventIndex);
  const recentEvents = recentVehicleEvents(processedEvents, event);
  const latestFeatures = deriveFeatures(event, zoneForFeatures, recentEvents, vehicleCase);
  traceEvents.push(trace(vehicleCase.case_id, event.timestamp, "features_derived", "Derived model features updated.", { latestFeatures }));

  const assessment = buildAssessment(state, event, vehicleCase);
  traceEvents.push(
    trace(
      vehicleCase.case_id,
      event.timestamp,
      "risk_assessed",
      `Risk model returned ${assessment.safety_incident_risk_score.toFixed(2)} (${assessment.risk_band}, ${assessment.confidence} confidence).`,
      { assessment }
    )
  );

  const decision = decidePolicy(assessment);
  traceEvents.push(trace(vehicleCase.case_id, event.timestamp, "policy_decision", `Policy decision: ${decision.recommendedAction}`, { decision }));

  let toolCalls: ToolCall[] = [...state.toolCalls];
  let approvals: ApprovalRequest[] = [...state.pendingApprovals];
  let updatedCase = updateCase(vehicleCase, assessment, event, decision);

  for (const toolName of decision.toolNames) {
    const results = simulateTool(toolName, state.selectedScenario.scenario_id, updatedCase, event, assessment, toolCalls);
    toolCalls = [...toolCalls, ...results];
    for (const result of results) {
      traceEvents.push(
        trace(
          updatedCase.case_id,
          result.timestamp,
          result.status === "failed" ? "tool_failure" : "tool_call",
          result.status === "failed" ? `${result.tool_name} failed: ${result.error}` : `${result.tool_name} ${result.status}.`,
          { toolCall: result }
        )
      );
    }
  }

  if (decision.shouldRequestApproval && !approvals.some((approval) => approval.case_id === updatedCase.case_id && approval.status === "pending")) {
    const approval = createApprovalRequest(updatedCase, assessment);
    approvals = [...approvals, approval];
    traceEvents.push(trace(updatedCase.case_id, event.timestamp, "approval_requested", "Approval requested for zone advisory.", { approval }));
  }

  if (assessment.risk_band === "Low" && event.event_type === "speed_normalized") {
    updatedCase = { ...updatedCase, status: "stabilized" };
    traceEvents.push(trace(updatedCase.case_id, event.timestamp, "case_stabilized", "Risk reduced; case stabilized for continued monitoring.", {}));
  }

  const activeCases = [...state.activeCases.filter((item) => item.case_id !== updatedCase.case_id), updatedCase];
  const nextIndex = state.currentEventIndex + 1;

  return {
    ...state,
    currentEventIndex: nextIndex,
    activeCases,
    selectedCase: updatedCase,
    currentEvent: event,
    currentZone: missingContext ? null : zoneForFeatures,
    latestFeatures,
    latestRiskAssessment: assessment,
    toolCalls,
    pendingApprovals: approvals,
    traceEvents: [...state.traceEvents, ...traceEvents],
    isComplete: nextIndex >= state.selectedScenario.events.length
  };
}

export function decideApproval(inputState: ReplayState, approvalId: string, approved: boolean, approver = "Safety Supervisor"): ReplayState {
  const state = structuredClone(inputState) as ReplayState;
  const approval = state.pendingApprovals.find((item) => item.approval_id === approvalId);
  if (!approval || !state.latestRiskAssessment) return state;
  const decisionTime = new Date().toISOString();
  const updatedApprovals: ApprovalRequest[] = state.pendingApprovals.map((item) =>
    item.approval_id === approvalId
      ? {
          ...item,
          status: approved ? "approved" : "rejected",
          approver,
          decision_time: decisionTime
        }
      : item
  );
  const selectedCase = state.selectedCase;
  if (!selectedCase) return { ...state, pendingApprovals: updatedApprovals };

  const traceEvents = [
    trace(
      selectedCase.case_id,
      decisionTime,
      "approval_decision",
      `${approver} ${approved ? "approved" : "rejected"} ${approval.requested_action}`,
      { approval_id: approvalId }
    )
  ];

  let safetyCases = state.safetyCases;
  let activeCases = state.activeCases;
  let toolCalls = state.toolCalls;
  let updatedCase = selectedCase;

  if (approved) {
    const advisoryTool: ToolCall = {
      tool_call_id: `tool-zone-advisory-${state.toolCalls.length + 1}`,
      case_id: selectedCase.case_id,
      tool_name: "recommend_zone_advisory",
      arguments: { requested_action: approval.requested_action },
      status: "recommended",
      result: "Zone advisory recommendation recorded after approval.",
      error: null,
      timestamp: decisionTime
    };
    const safetyCase = createSafetyCase(
      selectedCase,
      state.latestRiskAssessment,
      state.traceEvents.slice(-6).map((item) => item.message)
    );
    updatedCase = { ...selectedCase, status: "escalated", pending_approval: false, updated_at: decisionTime };
    toolCalls = [...toolCalls, advisoryTool];
    safetyCases = [...safetyCases, safetyCase];
    activeCases = state.activeCases.map((item) => (item.case_id === updatedCase.case_id ? updatedCase : item));
    traceEvents.push(trace(selectedCase.case_id, decisionTime, "tool_call", "recommend_zone_advisory recommended.", { toolCall: advisoryTool }));
    traceEvents.push(trace(selectedCase.case_id, decisionTime, "safety_case_created", `Safety case ${safetyCase.safety_case_id} created.`, { safetyCase }));
  } else {
    updatedCase = { ...selectedCase, status: "monitoring", pending_approval: false, updated_at: decisionTime };
    activeCases = state.activeCases.map((item) => (item.case_id === updatedCase.case_id ? updatedCase : item));
  }

  return {
    ...state,
    selectedCase: updatedCase,
    activeCases,
    pendingApprovals: updatedApprovals,
    toolCalls,
    safetyCases,
    traceEvents: [...state.traceEvents, ...traceEvents]
  };
}
