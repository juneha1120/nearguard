import type {
  ApprovalRequest,
  EventType,
  LivePrediction,
  LivePrimeMoverSnapshot,
  LiveTelemetrySample,
  LiveZoneSnapshot,
  ReplayState,
  ReviewRequest,
  RiskAssessment,
  RiskBand,
  ScenarioTelemetrySample,
  ScenarioZoneTelemetrySample,
  ToolCall,
  TraceEvent,
  VehicleCase,
  VehicleEvent,
  ZoneRegistryEntry
} from "@/lib/types/domain";

export type ScenarioMetadata = {
  scenario_id: string;
  name: string;
  description: string;
  primary_vehicle_id: string;
  highlights: string[];
};

export type ZoneRiskCard = {
  zone: ZoneRegistryEntry;
  level: "Low" | "Medium" | "High";
  className: "low" | "medium" | "high";
  flags: string[];
  live: LiveZoneSnapshot | null;
  operationalRisk: number;
};

export type LiveModelAssessment = {
  features: LivePrediction["features"];
  assessment: RiskAssessment;
};

const ABNORMAL_EVENTS: EventType[] = ["speeding", "harsh_brake", "sharp_turn", "stale_gps", "risk_persistent"];

export function bandClass(band?: RiskBand) {
  if (!band) return "neutral";
  if (band === "Low") return "low";
  if (band === "Medium") return "medium";
  if (band === "Critical") return "critical";
  return "high";
}

export function timeLabel(timestamp?: string | null) {
  if (!timestamp) return "--:--";
  return new Intl.DateTimeFormat("en-SG", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    timeZone: "Asia/Singapore",
    hour12: false
  }).format(new Date(timestamp));
}

export function eventSeverityClass(event: VehicleEvent) {
  if (event.event_type === "risk_persistent") return "persistent";
  if (event.event_type === "stale_gps") return "uncertain";
  if (event.event_type === "speed_normalized") return "resolved";
  if (ABNORMAL_EVENTS.includes(event.event_type)) return "abnormal";
  return "normal";
}

export function isDecisionPointEvent(event: VehicleEvent) {
  return event.event_type !== "normal_update";
}

export function formatEventLabel(eventType?: EventType) {
  if (!eventType) return "monitoring";
  return eventType.replaceAll("_", " ");
}

export function baselineZoneRiskLevel(score: number): ZoneRiskCard["level"] {
  if (score < 0.45) return "Low";
  if (score < 0.7) return "Medium";
  return "High";
}

export function liveRiskLevel(score: number): ZoneRiskCard["level"] {
  if (score < 0.45) return "Low";
  if (score < 0.68) return "Medium";
  return "High";
}

export function riskPercent(score?: number | null) {
  return `${Math.round((score ?? 0) * 100)}%`;
}

export function scoreSeverityClass(score?: number | null) {
  if (score === null || score === undefined) return "neutral";
  if (score < 0.45) return "low";
  if (score < 0.68) return "medium";
  if (score < 0.82) return "high";
  return "critical";
}

export function scoreSeverityLabel(score?: number | null) {
  const severity = scoreSeverityClass(score);
  if (severity === "low") return "Low";
  if (severity === "medium") return "Medium";
  if (severity === "high") return "High";
  if (severity === "critical") return "Critical";
  return "Pending";
}

export function speedSeverityClass(speed?: number | null, speedLimit?: number | null) {
  if (speed === null || speed === undefined || speedLimit === null || speedLimit === undefined) return "neutral";
  const overLimit = speed - speedLimit;
  if (overLimit <= 0) return "low";
  if (overLimit <= 5) return "medium";
  if (overLimit <= 10) return "high";
  return "critical";
}

export function countSeverityClass(count?: number | null) {
  if (count === null || count === undefined) return "neutral";
  if (count === 0) return "low";
  if (count <= 1) return "medium";
  if (count <= 2) return "high";
  return "critical";
}

export function distanceSeverityClass(distance?: number | null, available = true) {
  if (!available || distance === null || distance === undefined || distance >= 999) return "neutral";
  if (distance <= 15) return "critical";
  if (distance <= 25) return "high";
  if (distance <= 50) return "medium";
  return "low";
}

export function closingSeverityClass(closingRate?: number | null, available = true) {
  if (!available || closingRate === null || closingRate === undefined) return "neutral";
  if (closingRate >= 2.5) return "critical";
  if (closingRate >= 1.2) return "high";
  if (closingRate >= 0.5) return "medium";
  return "low";
}

export function gpsSeverityClass(gps?: string | null) {
  if (gps === "fresh") return "low";
  if (gps === "delayed") return "medium";
  if (gps === "stale") return "high";
  return "neutral";
}

export function trafficSeverityClass(traffic?: string | null) {
  if (traffic === "low") return "low";
  if (traffic === "medium") return "medium";
  if (traffic === "high") return "high";
  return "neutral";
}

export function weatherSeverityClass(weather?: string | null) {
  if (weather === "clear") return "low";
  if (weather === "rain") return "medium";
  if (weather === "heavy_rain") return "high";
  return "neutral";
}

export function trafficLevelFromPressure(pressure?: number | null) {
  if (pressure === null || pressure === undefined) return null;
  if (pressure >= 0.75) return "high";
  if (pressure >= 0.45) return "medium";
  return "low";
}

export function eventSignalClass(event?: string | null) {
  if (!event) return "neutral";
  if (event === "normal_update" || event === "normal" || event === "recovering" || event === "speed_normalized") return "low";
  if (event === "watching") return "medium";
  if (event === "speeding" || event === "harsh_brake" || event === "sharp_turn" || event === "stale GPS" || event === "stale_gps") {
    return "high";
  }
  if (event === "risk_persistent") return "critical";
  return "neutral";
}

export function restrictionSeverityClass(restriction?: string | null) {
  if (restriction === "normal") return "low";
  if (restriction === "caution" || restriction === "wharf") return "medium";
  if (restriction === "restricted") return "high";
  return "neutral";
}

export function trendSeverityClass(trend?: string | null) {
  if (trend === "decreasing") return "low";
  if (trend === "stable") return "medium";
  if (trend === "increasing") return "high";
  return "neutral";
}

export function confidenceSeverityClass(confidence?: string | null) {
  if (confidence === "high") return "low";
  if (confidence === "medium" || confidence === "live") return "medium";
  if (confidence === "low") return "critical";
  return "neutral";
}

function liveStateFromEvent(event: VehicleEvent): LivePrimeMoverSnapshot["state"] {
  if (event.event_type === "speeding") return "speeding";
  if (event.event_type === "harsh_brake") return "harsh brake";
  if (event.event_type === "sharp_turn") return "sharp turn";
  if (event.event_type === "stale_gps") return "stale GPS";
  if (event.event_type === "speed_normalized") return "recovering";
  return event.speed > event.speed_limit * 0.9 ? "watching" : "normal";
}

function eventCounts(events: VehicleEvent[], zoneId: string, currentTime: number) {
  const fiveMinutes = 5 * 60 * 1000;
  const recent = events.filter((event) => {
    const eventTime = new Date(event.timestamp).getTime();
    return event.zone_id === zoneId && eventTime <= currentTime && currentTime - eventTime <= fiveMinutes;
  });
  return {
    harshBrake: recent.filter((event) => event.event_type === "harsh_brake").length,
    sharpTurn: recent.filter((event) => event.event_type === "sharp_turn").length
  };
}

export function buildScenarioLiveSample(
  baseSample: LiveTelemetrySample | null,
  selectedScenario: ReplayState["selectedScenario"] | null,
  currentEventIndex: number,
  scenarioTimestamp?: string | null,
  scenarioTelemetrySample?: ScenarioTelemetrySample | null,
  scenarioZoneTelemetrySample?: ScenarioZoneTelemetrySample | null
): LiveTelemetrySample | null {
  if (!baseSample || !selectedScenario?.events.length) return baseSample;

  const displayTimestamp = scenarioTimestamp ?? baseSample.timestamp;
  const eventCursor = Math.max(0, Math.min(currentEventIndex - 1, selectedScenario.events.length - 1));
  const activeEvent = selectedScenario.events[eventCursor] ?? selectedScenario.events[0];
  const displayEvent = scenarioTelemetrySample ?? activeEvent;
  const displayZone = scenarioZoneTelemetrySample;
  const scenarioEventsToDate = selectedScenario.events.slice(0, eventCursor + 1);
  const activeTime = new Date(displayEvent.timestamp).getTime();
  const baseZones = baseSample.zones.map((zone) => ({
    ...zone,
    prime_movers: zone.prime_movers.filter((mover) => mover.vehicle_id !== selectedScenario.primary_vehicle_id)
  }));

  const zoneSnapshots = baseZones.map((zone) => {
    if (zone.zone_id !== displayEvent.zone_id) return zone;

    const scenarioMover: LivePrimeMoverSnapshot = {
      vehicle_id: displayEvent.vehicle_id,
      speed: displayEvent.speed,
      speed_limit: displayEvent.speed_limit,
      gps_freshness: displayEvent.gps_freshness,
      state: "state" in displayEvent ? displayEvent.state : liveStateFromEvent(activeEvent),
      position: displayEvent.position,
      heading_degrees: displayEvent.heading_degrees,
      accuracy_m: displayEvent.accuracy_m
    };
    const primeMovers = [scenarioMover, ...zone.prime_movers].slice(0, 4);
    const complianceCount = primeMovers.filter((mover) => mover.speed <= mover.speed_limit).length;
    const counts = eventCounts(scenarioEventsToDate, activeEvent.zone_id, activeTime);

    return {
      ...zone,
      updated_at: displayTimestamp,
      active_prime_movers: displayZone?.active_prime_movers ?? primeMovers.length,
      avg_speed:
        displayZone?.avg_speed ?? Number((primeMovers.reduce((total, mover) => total + mover.speed, 0) / primeMovers.length).toFixed(1)),
      speed_compliance: displayZone?.speed_compliance ?? Number((complianceCount / primeMovers.length).toFixed(2)),
      stale_gps_count: displayZone?.stale_gps_count ?? primeMovers.filter((mover) => mover.gps_freshness === "stale").length,
      delayed_gps_count: displayZone?.delayed_gps_count ?? primeMovers.filter((mover) => mover.gps_freshness === "delayed").length,
      harsh_brake_count_5m: Math.max(displayZone?.harsh_brake_count_5m ?? zone.harsh_brake_count_5m, counts.harshBrake),
      sharp_turn_count_5m: Math.max(displayZone?.sharp_turn_count_5m ?? zone.sharp_turn_count_5m, counts.sharpTurn),
      traffic_pressure: displayZone?.traffic_pressure ?? zone.traffic_pressure,
      weather: displayZone?.weather ?? zone.weather,
      restriction_level: displayZone?.restriction_level ?? zone.restriction_level,
      pedestrian_exposure: displayZone?.pedestrian_exposure ?? zone.pedestrian_exposure,
      slow_down_zone_active: displayZone?.slow_down_zone_active ?? zone.slow_down_zone_active,
      prime_movers: primeMovers
    };
  });

  return {
    sample_id: `${baseSample.sample_id}-${selectedScenario.scenario_id}-${"sample_id" in displayEvent ? displayEvent.sample_id : activeEvent.event_id}`,
    timestamp: displayTimestamp,
    zones: zoneSnapshots
  };
}

export function zoneRiskClass(level: ZoneRiskCard["level"]): ZoneRiskCard["className"] {
  if (level === "Low") return "low";
  if (level === "Medium") return "medium";
  return "high";
}

export function zoneFlags(live: LiveZoneSnapshot | null) {
  const flags: string[] = [];
  if (!live) return flags;
  if (live.slow_down_zone_active) flags.push("Slow-down zone active");
  return flags;
}

export function livePredictionKey(sampleId: string, vehicleId: string) {
  return `${sampleId}:${vehicleId}`;
}

export function liveModelAssessment(prediction: LivePrediction): LiveModelAssessment {
  return {
    features: prediction.features,
    assessment: {
      assessment_id: `live-${prediction.sample_id}-${prediction.vehicle_id}`,
      case_id: `live-${prediction.vehicle_id}`,
      safety_incident_risk_score: prediction.assessment.safety_incident_risk_score,
      prediction_horizon: prediction.assessment.prediction_horizon,
      evidence_authority: prediction.assessment.evidence_authority,
      risk_band: prediction.assessment.risk_band,
      confidence: prediction.assessment.confidence,
      uncertainty_reason: prediction.assessment.uncertainty_reason,
      top_risk_reasons: prediction.assessment.top_risk_reasons,
      created_at: prediction.timestamp
    }
  };
}

export function operationsRiskReason(reason: string) {
  if (reason.startsWith("Near-limit speed is persisting")) {
    return "Near-limit speed signal sustained with rain/heavy traffic context.";
  }
  if (reason.startsWith("Manoeuvre instability is adding risk")) {
    return "Sharp-turn/harsh-brake signal detected in the 10-minute driving pattern.";
  }
  if (reason === "Speed is staying close to the limit while rain and heavy traffic reduce stopping margin.") {
    return "Near-limit speed signal sustained with rain/heavy traffic context.";
  }
  if (reason === "Recent sharp turn or harsh braking suggests the driver may need more space.") {
    return "Sharp-turn/harsh-brake signal detected in the 10-minute driving pattern.";
  }
  const harshBrakeMatch = reason.match(/^(\d+) harsh-braking event\(s\) occurred within 10 minutes\.$/);
  if (harshBrakeMatch) {
    return `10-minute harsh-brake count is ${harshBrakeMatch[1]}.`;
  }
  const sharpTurnMatch = reason.match(/^(\d+) sharp-turn event\(s\) occurred within 10 minutes\.$/);
  if (sharpTurnMatch) {
    return `10-minute sharp-turn count is ${sharpTurnMatch[1]}.`;
  }
  const nearestPmMatch = reason.match(/^Nearest PM is (\d+)m away\.$/);
  if (nearestPmMatch) {
    return `Nearest-PM distance feature is ${nearestPmMatch[1]} m.`;
  }
  const closingRateMatch = reason.match(/^Nearby PM is closing at ([\d.]+) m\/s\.$/);
  if (closingRateMatch) {
    return `Closing-rate feature is ${closingRateMatch[1]} m/s.`;
  }
  const pmCountMatch = reason.match(/^(\d+) PMs detected within 50m\.$/);
  if (pmCountMatch) {
    return `Within-50 m PM count feature is ${pmCountMatch[1]}.`;
  }
  const speedExposureMatch = reason.match(/^Speed exposure appeared in (\d+)% of the recent 10-minute window\.$/);
  if (speedExposureMatch) {
    return `Over-limit 10-minute exposure feature is ${speedExposureMatch[1]}%.`;
  }
  const speedOverMatch = reason.match(/^Current speed is (\d+) km\/h above the zone limit\.$/);
  if (speedOverMatch) {
    return `Speed-over-limit feature is ${speedOverMatch[1]} km/h.`;
  }
  if (reason.startsWith("Traffic and weather compound") || reason.startsWith("Traffic and weather combine")) {
    return "Traffic-weather compound risk signal elevated.";
  }
  if (reason === "Rain and traffic are increasing zone operating pressure.") {
    return "Traffic-weather compound risk signal elevated.";
  }
  if (reason === "Zone context increases exposure risk.") {
    return "Zone-rule/pedestrian-exposure feature is elevated.";
  }
  if (reason === "This zone has added exposure from restrictions or pedestrian movement.") {
    return "Zone-rule/pedestrian-exposure feature is elevated.";
  }
  if (reason === "Pedestrian exposure is high in this operating area.") {
    return "Pedestrian-exposure feature is high for this operating area.";
  }
  if (reason === "Alert density is rising across the recent rolling telemetry window.") {
    return "Alert-density signal elevated across the 30-minute telemetry window.";
  }
  if (reason === "Rolling window contains manoeuvre instability signals.") {
    return "Recent driving pattern contains sharp-turn/harsh-brake signals.";
  }
  if (reason === "Recent movement includes sharp turns or harsh braking.") {
    return "Recent driving pattern contains sharp-turn/harsh-brake signals.";
  }
  if (reason === "Telemetry quality reduces location confidence.") {
    return "GPS freshness feature is degraded.";
  }
  if (reason === "Rolling risk trend is increasing.") {
    return "Risk-trend feature is increasing.";
  }
  if (reason === "Rolling telemetry remains within expected operating range." || reason === "Current rolling telemetry remains within the monitoring envelope.") {
    return "Current driving-pattern signals remain within expected range.";
  }
  return reason;
}

export function explainAction(
  selectedCase: VehicleCase | null,
  assessment: RiskAssessment | null,
  pendingApproval: ApprovalRequest | null
) {
  if (!selectedCase || !assessment) {
    return {
      title: "Awaiting telemetry",
      rationale: ["Vehicle risk has not crossed a policy threshold."],
      statusClass: "neutral"
    };
  }

  if (assessment.risk_band === "Low") {
    const recoveryReasons = assessment.top_risk_reasons
      .filter((reason) => reason.startsWith("Speed normalized") || reason.startsWith("Risk trend is decreasing"))
      .map(operationsRiskReason);

    return {
      title: selectedCase.recommended_action,
      rationale: [
        `Risk remains Low; score ${assessment.safety_incident_risk_score.toFixed(2)}; confidence ${assessment.confidence}.`,
        ...(recoveryReasons.length ? recoveryReasons : ["Signals are being logged, but remain below the intervention threshold."])
      ].slice(0, 3),
      statusClass: bandClass(assessment.risk_band)
    };
  }

  return {
    title: pendingApproval ? "Zone action approval requested." : selectedCase.recommended_action,
    rationale: [
      `Risk band ${assessment.risk_band}; score ${assessment.safety_incident_risk_score.toFixed(2)}; confidence ${assessment.confidence}.`,
      ...assessment.top_risk_reasons.slice(0, 3).map(operationsRiskReason)
    ],
    statusClass: bandClass(assessment.risk_band)
  };
}

export function toolRationale(tool: ToolCall, assessment: RiskAssessment | null) {
  const riskLabel = assessment ? `${assessment.risk_band} risk (${assessment.safety_incident_risk_score.toFixed(2)})` : "current risk state";
  if (tool.tool_name === "notify_driver") return `Driver advisory delivered for ${riskLabel}.`;
  if (tool.tool_name === "notify_supervisor") return `Supervisor notification delivered for ${riskLabel}.`;
  if (tool.tool_name === "fallback_notify_supervisor") return "Fallback notification was sent because the primary supervisor notification timed out.";
  if (tool.tool_name === "request_human_approval") return "Zone action approval was requested because policy requires an operator decision.";
  if (tool.tool_name === "recommend_zone_advisory") return "Zone advisory was recorded after approval.";
  return `Tool was called as part of the ${assessment?.risk_band ?? "current"} policy response.`;
}

export function toolLabel(toolName: string) {
  if (toolName === "notify_driver") return "Driver Advisory";
  if (toolName === "notify_supervisor") return "Supervisor Notification";
  if (toolName === "fallback_notify_supervisor") return "Fallback Supervisor Notification";
  if (toolName === "request_human_approval") return "Zone Action Approval";
  if (toolName === "recommend_zone_advisory") return "Zone Advisory";
  return toolName
    .replaceAll("_", " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

export function traceLabel(eventType: TraceEvent["event_type"]) {
  switch (eventType) {
    case "event_received":
      return "Telemetry Signal";
    case "validation_error":
      return "Validation Error";
    case "context_enriched":
      return "Zone Context";
    case "context_missing":
      return "Context Warning";
    case "features_derived":
      return "Derived Risk Signals";
    case "risk_assessed":
      return "AI Assessment";
    case "policy_decision":
      return "Policy Decision";
    case "tool_call":
      return "Tool Call";
    case "tool_failure":
      return "Tool Failure";
    case "review_requested":
      return "Signal Review";
    case "review_decision":
      return "Signal Review Decision";
    case "approval_requested":
      return "Zone Action Approval";
    case "approval_decision":
      return "Zone Approval Decision";
    case "safety_case_created":
      return "Safety Case Record";
    case "case_stabilized":
      return "Case Stabilized";
    default:
      return (eventType as string).replaceAll("_", " ");
  }
}

export function traceCategoryClass(eventType: TraceEvent["event_type"]) {
  switch (eventType) {
    case "event_received":
    case "features_derived":
      return "neutral";
    case "context_enriched":
    case "case_stabilized":
      return "low";
    case "risk_assessed":
      return "medium";
    case "policy_decision":
    case "review_requested":
    case "review_decision":
    case "approval_requested":
    case "approval_decision":
      return "high";
    case "tool_call":
      return "low";
    case "context_missing":
    case "validation_error":
    case "tool_failure":
    case "safety_case_created":
      return "critical";
    default:
      return "neutral";
  }
}

export function summarizeReviewRequest(review: ReviewRequest) {
  const reasonLabels = new Map<ReviewRequest["reason_codes"][number], string>([
    ["LOW_MODEL_CONFIDENCE", "Model confidence is low."],
    ["STALE_GPS", "Location signal is degraded."],
    ["MISSING_ZONE_CONTEXT", "Zone context needs confirmation."],
    ["ELEVATED_RISK", "Risk is elevated."]
  ]);
  const reasons = review.reason_codes.map((code) => reasonLabels.get(code)).filter((item): item is string => Boolean(item));

  return {
    title: "Review case signal?",
    reasons: reasons.length ? [...new Set(reasons)].slice(0, 2) : ["Risk is elevated, but the signal needs confirmation."]
  };
}

export function summarizeApprovalRequest(approval: ApprovalRequest) {
  const reasonLabels = new Map<ApprovalRequest["reason_codes"][number], string>([
    ["PERSISTENT_HIGH_RISK", "Vehicle risk stayed high after earlier response."],
    ["ZONE_RISK_CORROBORATED", "Zone risk confirms the vehicle alert."],
    ["MULTIPLE_ELEVATED_VEHICLES", "Multiple Prime Movers are elevated in this area."]
  ]);
  const reasons = approval.reason_codes.map((code) => reasonLabels.get(code)).filter((item): item is string => Boolean(item));

  return {
    title: "Approve zone advisory?",
    reasons: reasons.length ? [...new Set(reasons)].slice(0, 2) : ["This action affects nearby Prime Movers, so it needs approval."]
  };
}

export function actionLogStatus(tool: ToolCall, state: ReplayState | null) {
  if (tool.status === "failed") return { label: "Failed", className: "critical", failed: true };
  if (tool.tool_name === "request_human_approval") {
    const approval = state?.pendingApprovals.find((item) => item.case_id === tool.case_id);
    if (approval?.status === "approved") return { label: "Approved", className: "low", failed: false };
    if (approval?.status === "rejected") return { label: "Rejected", className: "critical", failed: true };
    return { label: "Awaiting Approval", className: "medium", failed: false };
  }
  if (tool.tool_name === "recommend_zone_advisory") return { label: "Recorded", className: "low", failed: false };
  if (tool.tool_name === "notify_driver") return { label: "Sent", className: "low", failed: false };
  if (tool.tool_name === "notify_supervisor" || tool.tool_name === "fallback_notify_supervisor") return { label: "Notified", className: "low", failed: false };
  return { label: tool.status, className: "low", failed: false };
}

export function buildDecisionTimeline(
  traceEvents: TraceEvent[],
  assessment: RiskAssessment | null,
  currentEvent: VehicleEvent | null
) {
  if (!assessment || !currentEvent) return [];
  const relevantTypes = new Set([
    "event_received",
    "validation_error",
    "context_enriched",
    "context_missing",
    "features_derived",
    "risk_assessed",
    "policy_decision",
    "tool_call",
    "tool_failure",
    "review_requested",
    "review_decision",
    "approval_requested",
    "approval_decision",
    "safety_case_created",
    "case_stabilized"
  ]);
  return traceEvents.filter((trace) => relevantTypes.has(trace.event_type));
}
