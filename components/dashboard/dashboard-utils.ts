import type {
  ApprovalRequest,
  EventType,
  LivePrediction,
  LivePrimeMoverSnapshot,
  LiveTelemetrySample,
  LiveZoneSnapshot,
  ReplayState,
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
  if (band === "Persistent High") return "persistent";
  if (band === "Critical / Low Confidence") return "critical";
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
  if (live.slow_down_zone_active) flags.push("25km/h slow-down");
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

export function explainAction(
  selectedCase: VehicleCase | null,
  assessment: RiskAssessment | null,
  pendingApproval: ApprovalRequest | null
) {
  if (!selectedCase || !assessment) {
    return {
      title: "Awaiting telemetry",
      summary: "No risk action is active. Continuous scoring is below the intervention threshold.",
      rationale: ["Vehicle risk has not crossed a policy threshold."],
      statusClass: "neutral"
    };
  }

  const leadReason = assessment.top_risk_reasons[0] ?? "Vehicle risk crossed the policy threshold.";
  const actionPrefix = pendingApproval ? "Approval required" : selectedCase.authority_class;
  return {
    title: selectedCase.recommended_action,
    summary: `${actionPrefix}: ${leadReason}`,
    rationale: [
      `${assessment.risk_band} risk at ${assessment.safety_incident_risk_score.toFixed(2)} with ${assessment.confidence} confidence.`,
      ...assessment.top_risk_reasons.slice(0, 3)
    ],
    statusClass: bandClass(assessment.risk_band)
  };
}

export function toolRationale(tool: ToolCall, assessment: RiskAssessment | null) {
  const reason = assessment?.top_risk_reasons[0] ?? "Current policy response required operational follow-up.";
  if (tool.tool_name === "notify_driver") return `Driver advisory was triggered by ${assessment?.risk_band ?? "elevated"} risk: ${reason}`;
  if (tool.tool_name === "notify_supervisor") return `Supervisor notification was triggered because policy requires awareness for ${assessment?.risk_band ?? "high"} risk.`;
  if (tool.tool_name === "fallback_notify_supervisor") return "Fallback notification was sent because the primary supervisor notification timed out.";
  if (tool.tool_name === "request_human_approval") return "Human approval was requested because the policy does not allow stronger zone intervention automatically.";
  if (tool.tool_name === "recommend_zone_advisory") return "Zone advisory was recorded after human approval.";
  return `Tool was called as part of the ${assessment?.risk_band ?? "current"} policy response.`;
}

export function buildDecisionTimeline(
  traceEvents: TraceEvent[],
  assessment: RiskAssessment | null,
  currentEvent: VehicleEvent | null
) {
  if (!assessment || !currentEvent) return [];
  const relevantTypes = new Set([
    "event_received",
    "context_enriched",
    "context_missing",
    "features_derived",
    "risk_assessed",
    "policy_decision",
    "tool_call",
    "tool_failure",
    "approval_requested"
  ]);
  return traceEvents.filter((trace) => relevantTypes.has(trace.event_type)).slice(-8);
}
