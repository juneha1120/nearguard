import { getLatestScenarioZoneTelemetrySample, getScenario, getScenarioPrediction, getZone } from "@/lib/data/repository";
import { deriveFeatures, recentVehicleEvents } from "@/lib/model/features";
import { calculateZoneOperationalRisk } from "@/lib/model/live-risk";
import { riskBandFor } from "@/lib/model/risk";
import { decidePolicy, type ZoneAdvisoryPolicyContext } from "@/lib/policy/policy";
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
  ZoneContext,
  ZoneRegistryEntry
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

function fallbackOperatingContext(zone: ZoneRegistryEntry, zoneId = zone.zone_id): ZoneContext {
  return {
    ...zone,
    zone_id: zoneId,
    traffic_level: "high",
    weather: "rain",
    restriction_level: "restricted",
    slow_down_zone_active: false,
    pedestrian_exposure: "medium"
  };
}

function zoneContextForFeatures(scenario: Scenario, event: VehicleEvent, zone: ZoneRegistryEntry): ZoneContext {
  const dynamicTelemetry = getLatestScenarioZoneTelemetrySample(scenario.scenario_id, event.zone_id, event.timestamp);
  if (!dynamicTelemetry) return fallbackOperatingContext(zone);

  return {
    ...zone,
    traffic_level: dynamicTelemetry.traffic_pressure >= 0.75 ? "high" : dynamicTelemetry.traffic_pressure >= 0.45 ? "medium" : "low",
    weather: dynamicTelemetry.weather,
    restriction_level: dynamicTelemetry.restriction_level,
    slow_down_zone_active: dynamicTelemetry.slow_down_zone_active,
    pedestrian_exposure: dynamicTelemetry.pedestrian_exposure
  };
}

export function isDecisionPointEvent(event: VehicleEvent) {
  return event.event_type !== "normal_update";
}

function nextDecisionPointIndex(state: ReplayState) {
  return state.selectedScenario.events.findIndex((event, index) => index >= state.currentEventIndex && isDecisionPointEvent(event));
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
    prediction_horizon: prediction.assessment.prediction_horizon,
    evidence_authority: prediction.assessment.evidence_authority,
    risk_band: riskBandFor(score, confidence, vehicleCase.current_risk >= 0.65),
    confidence,
    uncertainty_reason: uncertaintyReason,
    top_risk_reasons: topRiskReasons,
    created_at: event.timestamp
  };
}

function zoneAdvisoryPolicyContext(
  state: ReplayState,
  event: VehicleEvent,
  assessment: RiskAssessment,
  zoneForFeatures: ZoneContext
): ZoneAdvisoryPolicyContext {
  const dynamicZone = getLatestScenarioZoneTelemetrySample(state.selectedScenario.scenario_id, event.zone_id, event.timestamp);
  const zoneOperationalRisk = dynamicZone
    ? calculateZoneOperationalRisk({
        ...dynamicZone,
        updated_at: dynamicZone.timestamp,
        prime_movers: []
      })
    : null;

  const processedEvents = state.selectedScenario.events.slice(0, state.currentEventIndex + 1);
  const elevatedVehicleIds = new Set(
    state.activeCases.filter((vehicleCase) => vehicleCase.current_risk >= 0.65).map((vehicleCase) => vehicleCase.vehicle_id)
  );
  if (assessment.safety_incident_risk_score >= 0.65) elevatedVehicleIds.add(event.vehicle_id);

  const elevatedVehicleCountInZone = [...elevatedVehicleIds].filter((vehicleId) => {
    const latestVehicleEvent = processedEvents
      .filter((candidate) => candidate.vehicle_id === vehicleId)
      .at(-1);
    return latestVehicleEvent?.zone_id === event.zone_id;
  }).length;

  const sharedHazardContext =
    zoneForFeatures.traffic_level === "high" ||
    zoneForFeatures.weather !== "clear" ||
    zoneForFeatures.restriction_level !== "normal" ||
    zoneForFeatures.pedestrian_exposure !== "low";

  return { zoneOperationalRisk, elevatedVehicleCountInZone, sharedHazardContext };
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
  const decisionPointIndex = nextDecisionPointIndex(state);
  if (decisionPointIndex === -1) {
    return {
      ...state,
      currentEventIndex: state.selectedScenario.events.length,
      isComplete: true
    };
  }
  state.currentEventIndex = decisionPointIndex;
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
  const fallbackZone: ZoneRegistryEntry = zone ?? {
    zone_id: event.zone_id,
    zone_name: "Unavailable zone context",
    zone_historical_risk: 0.66,
  };
  const zoneForFeatures = missingContext ? fallbackOperatingContext(fallbackZone, event.zone_id) : zoneContextForFeatures(state.selectedScenario, event, fallbackZone);

  if (missingContext) {
    traceEvents.push(trace(vehicleCase.case_id, event.timestamp, "context_missing", "Zone context lookup unavailable; confidence will be reduced.", { zone_id: event.zone_id }));
  } else {
    traceEvents.push(
      trace(
        vehicleCase.case_id,
        event.timestamp,
        "context_enriched",
        `Zone context loaded: ${zoneForFeatures.zone_name}; latest dynamic telemetry applied where available.`,
        { zone: zoneForFeatures }
      )
    );
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
      `Continuous assessment returned ${assessment.safety_incident_risk_score.toFixed(2)} synthetic near-miss risk within next ${assessment.prediction_horizon}; policy maps ${assessment.risk_band} risk to the intervention threshold (${assessment.confidence} confidence).`,
      { assessment }
    )
  );

  const policyContext = zoneAdvisoryPolicyContext(state, event, assessment, zoneForFeatures);
  const decision = decidePolicy(assessment, policyContext);
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
    const approval = createApprovalRequest(updatedCase, assessment, decision.zoneAdvisoryEvidence?.reasons);
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

export function rewindReplay(inputState: ReplayState): ReplayState {
  const processedDecisionPointCount = inputState.selectedScenario.events
    .slice(0, inputState.currentEventIndex)
    .filter(isDecisionPointEvent).length;
  const targetDecisionPointCount = Math.max(0, processedDecisionPointCount - 1);
  const retainedApprovals = inputState.pendingApprovals.filter((approval) => approval.status !== "pending");
  const retainedApprovalIds = new Set(retainedApprovals.map((approval) => approval.approval_id));
  const retainedToolCalls = inputState.toolCalls.filter((tool) => tool.tool_name === "recommend_zone_advisory");
  const retainedToolCallIds = new Set(retainedToolCalls.map((tool) => tool.tool_call_id));
  const retainedSafetyCaseIds = new Set(inputState.safetyCases.map((safetyCase) => safetyCase.safety_case_id));
  const retainedTraceEvents = inputState.traceEvents.filter((event) => {
    const metadata = event.metadata as {
      approval_id?: string;
      toolCall?: ToolCall;
      safetyCase?: { safety_case_id?: string };
    };

    return (
      (metadata.approval_id && retainedApprovalIds.has(metadata.approval_id)) ||
      (metadata.toolCall && retainedToolCallIds.has(metadata.toolCall.tool_call_id)) ||
      (metadata.safetyCase?.safety_case_id && retainedSafetyCaseIds.has(metadata.safetyCase.safety_case_id))
    );
  });
  let state = createInitialReplayState(inputState.selectedScenario.scenario_id);

  for (let index = 0; index < targetDecisionPointCount; index += 1) {
    state = advanceReplay(state);
  }

  const activeCases: VehicleCase[] = state.activeCases.map((vehicleCase) => {
    const decidedApproval = retainedApprovals.find((approval) => approval.case_id === vehicleCase.case_id);
    if (!decidedApproval) return vehicleCase;

    return {
      ...vehicleCase,
      status: decidedApproval.status === "approved" ? "escalated" : "monitoring",
      pending_approval: false,
      updated_at: decidedApproval.decision_time ?? vehicleCase.updated_at
    };
  });
  const selectedCase = state.selectedCase
    ? activeCases.find((vehicleCase) => vehicleCase.case_id === state.selectedCase?.case_id) ?? state.selectedCase
    : null;

  return {
    ...state,
    activeCases,
    selectedCase,
    pendingApprovals: [
      ...state.pendingApprovals.filter((approval) => !retainedApprovalIds.has(approval.approval_id)),
      ...retainedApprovals
    ],
    toolCalls: [
      ...state.toolCalls.filter((tool) => !retainedToolCallIds.has(tool.tool_call_id)),
      ...retainedToolCalls
    ],
    safetyCases: inputState.safetyCases,
    traceEvents: [...state.traceEvents, ...retainedTraceEvents].sort(
      (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
    )
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
