export type EventType =
  | "normal_update"
  | "speeding"
  | "harsh_brake"
  | "sharp_turn"
  | "stale_gps"
  | "speed_normalized"
  | "risk_persistent";

export type GpsFreshness = "fresh" | "delayed" | "stale";
export type TrafficLevel = "low" | "medium" | "high";
export type Weather = "clear" | "rain" | "heavy_rain";
export type RestrictionLevel = "normal" | "caution" | "restricted" | "wharf";
export type PedestrianExposure = "low" | "medium" | "high";
export type Confidence = "high" | "medium" | "low";
export type ReportHazardType =
  | "visibility_issue"
  | "pedestrian_exposure"
  | "speeding_pattern"
  | "weather_condition"
  | "traffic_congestion"
  | "gps_quality"
  | "route_obstruction"
  | "unsafe_manoeuvre"
  | "other";
export type RiskBand = "Low" | "Medium" | "High" | "Critical";
export type CaseStatus = "open" | "monitoring" | "pending_approval" | "escalated" | "stabilized" | "closed";
export type ToolStatus = "pending" | "delivered" | "failed" | "approved" | "rejected" | "created" | "recommended";
export type ApprovalStatus = "pending" | "approved" | "rejected";
export type LivePrimeMoverState = "normal" | "watching" | "speeding" | "stale GPS" | "harsh brake" | "sharp turn" | "recovering";
export type TraceEventType =
  | "event_received"
  | "validation_error"
  | "context_enriched"
  | "context_missing"
  | "features_derived"
  | "risk_assessed"
  | "policy_decision"
  | "tool_call"
  | "tool_failure"
  | "approval_requested"
  | "approval_decision"
  | "safety_case_created"
  | "case_stabilized";

export interface VehicleEvent {
  event_id: string;
  timestamp: string;
  vehicle_id: string;
  zone_id: string;
  event_type: EventType;
  speed: number;
  speed_limit: 15 | 25 | 40;
  gps_freshness: GpsFreshness;
  position?: MapPosition;
  heading_degrees?: number;
  accuracy_m?: number;
  lat?: number;
  lng?: number;
}

export interface ZoneRegistryEntry {
  zone_id: string;
  zone_name: string;
  zone_historical_risk: number;
  map_region?: string;
  center?: MapPosition;
  bounds?: MapBounds;
}

export interface ZoneContext extends ZoneRegistryEntry {
  traffic_level: TrafficLevel;
  weather: Weather;
  restriction_level: RestrictionLevel;
  slow_down_zone_active: boolean;
  pedestrian_exposure: PedestrianExposure;
}

export interface LivePrimeMoverSnapshot {
  vehicle_id: string;
  speed: number;
  speed_limit: number;
  gps_freshness: GpsFreshness;
  state: LivePrimeMoverState;
  position?: MapPosition;
  heading_degrees?: number;
  accuracy_m?: number;
}

export interface LiveZoneSnapshot {
  zone_id: string;
  updated_at: string;
  active_prime_movers: number;
  avg_speed: number;
  speed_compliance: number;
  stale_gps_count: number;
  delayed_gps_count: number;
  harsh_brake_count_5m: number;
  sharp_turn_count_5m: number;
  traffic_pressure: number;
  weather: Weather;
  restriction_level: RestrictionLevel;
  pedestrian_exposure: PedestrianExposure;
  slow_down_zone_active: boolean;
  prime_movers: LivePrimeMoverSnapshot[];
}

export interface LiveTelemetrySample {
  sample_id: string;
  timestamp: string;
  zones: LiveZoneSnapshot[];
}

export interface ScenarioTelemetrySample {
  sample_id: string;
  timestamp: string;
  scenario_id: string;
  vehicle_id: string;
  zone_id: string;
  speed: number;
  speed_limit: number;
  gps_freshness: GpsFreshness;
  state: LivePrimeMoverState;
  event_anchor_id: string | null;
  position?: MapPosition;
  accuracy_m?: number;
  heading_degrees?: number;
}

export interface ScenarioZoneTelemetrySample {
  sample_id: string;
  timestamp: string;
  scenario_id: string;
  zone_id: string;
  active_prime_movers: number;
  avg_speed: number;
  speed_compliance: number;
  stale_gps_count: number;
  delayed_gps_count: number;
  harsh_brake_count_5m: number;
  sharp_turn_count_5m: number;
  traffic_pressure: number;
  weather: Weather;
  restriction_level: RestrictionLevel;
  pedestrian_exposure: PedestrianExposure;
  slow_down_zone_active: boolean;
}

export interface MapPosition {
  x: number;
  y: number;
}

export interface MapBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface DerivedFeatures {
  speed: number;
  speed_limit: number;
  event_type: EventType;
  gps_freshness: GpsFreshness;
  traffic_level: TrafficLevel;
  weather: Weather;
  zone_historical_risk: number;
  restriction_level: RestrictionLevel;
  slow_down_zone_active: boolean;
  pedestrian_exposure: PedestrianExposure;
  speed_over_limit: number;
  speed_over_limit_band: "none" | "minor" | "moderate" | "severe";
  speeding_ratio_5m: number;
  speeding_ratio_10m: number;
  mean_speed_5m: number;
  mean_speed_30m: number;
  max_speed_5m: number;
  speed_std_10m: number;
  speed_delta_last_3_events: number;
  harsh_brake_count_10m: number;
  sharp_turn_count_10m: number;
  recent_harsh_brake_count_10m: number;
  recent_sharp_turn_count_10m: number;
  alert_density_30m: number;
  risk_escalation_rate: number;
  shift_hours: number;
  night_flag: boolean;
  time_since_last_intervention: number;
  reaction_window_active: boolean;
  post_intervention_noncompliance: boolean;
  traffic_weather_compound_index: number;
  zone_transition_risk: number;
  nearby_vehicle_count_50m: number;
  nearest_vehicle_distance_m: number;
  nearest_vehicle_relative_speed_kmh: number;
  closing_rate_mps: number;
  interaction_features_available: boolean;
  previous_risk: number;
  risk_trend: "decreasing" | "stable" | "increasing";
}

export interface RiskAssessment {
  assessment_id: string;
  case_id: string;
  safety_incident_risk_score: number;
  prediction_horizon: "15m";
  evidence_authority: "SYNTHETIC_DATA";
  risk_band: RiskBand;
  confidence: Confidence;
  uncertainty_reason: string | null;
  top_risk_reasons: string[];
  created_at: string;
}

export interface VehicleCase {
  case_id: string;
  vehicle_id: string;
  status: CaseStatus;
  current_risk: number;
  previous_risk: number;
  confidence: Confidence;
  risk_reasons: string[];
  recommended_action: string;
  authority_class: string;
  pending_approval: boolean;
  created_at: string;
  updated_at: string;
}

export interface ToolCall {
  tool_call_id: string;
  case_id: string;
  tool_name: string;
  arguments: Record<string, unknown>;
  status: ToolStatus;
  result: string | null;
  error: string | null;
  timestamp: string;
}

export interface ScenarioToolOutcome {
  event_id: string;
  tool_name: string;
  status: ToolStatus;
  result: string | null;
  error: string | null;
  offset_seconds?: number;
  fallback?: {
    tool_name: string;
    status: ToolStatus;
    result: string | null;
    error: string | null;
    offset_seconds?: number;
  };
}

export interface ApprovalRequest {
  approval_id: string;
  case_id: string;
  requested_action: string;
  rationale: string;
  status: ApprovalStatus;
  approver: string | null;
  decision_time: string | null;
}

export interface SafetyCase {
  safety_case_id: string;
  case_id: string;
  summary: string;
  evidence: string[];
  created_at: string;
  status: "open" | "created";
}

export interface TraceEvent {
  trace_id: string;
  case_id: string;
  timestamp: string;
  event_type: TraceEventType;
  message: string;
  metadata: Record<string, unknown>;
}

export interface WorkerReportExtractedContext {
  hazard_type: ReportHazardType;
  zone_id: string | null;
  vehicle_id: string | null;
  pedestrian_exposure: PedestrianExposure | null;
  traffic_level: TrafficLevel | null;
  weather: Weather | null;
  restriction_level: RestrictionLevel | null;
  reported_severity: Confidence;
  operational_note: string;
  model_feature_impacts: string[];
}

export interface WorkerRiskReport {
  report_id: string;
  timestamp: string;
  reporter_role: string;
  zone_id: string | null;
  vehicle_id: string | null;
  description: string;
  extracted_context: WorkerReportExtractedContext;
  extraction_confidence: Confidence;
  extraction_source: "gemini_generate_content";
  model: string;
}

export interface Scenario {
  scenario_id: string;
  name: string;
  description: string;
  primary_vehicle_id: string;
  highlights: string[];
  events: VehicleEvent[];
  tool_outcomes?: ScenarioToolOutcome[];
}

export interface ScenarioPrediction {
  scenario_id: string;
  event_id: string;
  features: DerivedFeatures;
  assessment: Omit<RiskAssessment, "assessment_id" | "case_id" | "created_at"> & {
    synthetic_near_miss_risk_score?: number;
  };
}

export interface LivePrediction {
  sample_id: string;
  timestamp: string;
  vehicle_id: string;
  zone_id: string;
  features: DerivedFeatures;
  assessment: Omit<RiskAssessment, "assessment_id" | "case_id" | "created_at"> & {
    synthetic_near_miss_risk_score?: number;
  };
}

export interface ReplayState {
  selectedScenario: Scenario;
  currentEventIndex: number;
  activeCases: VehicleCase[];
  selectedCase: VehicleCase | null;
  currentEvent: VehicleEvent | null;
  currentZone: ZoneContext | null;
  latestFeatures: DerivedFeatures | null;
  latestRiskAssessment: RiskAssessment | null;
  toolCalls: ToolCall[];
  pendingApprovals: ApprovalRequest[];
  safetyCases: SafetyCase[];
  traceEvents: TraceEvent[];
  isComplete: boolean;
}
