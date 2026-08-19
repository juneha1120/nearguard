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
export type RiskBand = "Low" | "Medium" | "High" | "Persistent High" | "Critical / Low Confidence";
export type CaseStatus = "open" | "monitoring" | "pending_approval" | "escalated" | "stabilized" | "closed";
export type ToolStatus = "pending" | "delivered" | "failed" | "approved" | "rejected" | "created" | "recommended";
export type ApprovalStatus = "pending" | "approved" | "rejected";
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
}

export interface ZoneContext {
  zone_id: string;
  zone_name: string;
  traffic_level: TrafficLevel;
  weather: Weather;
  zone_historical_risk: number;
  restriction_level: RestrictionLevel;
  slow_down_zone_active: boolean;
  pedestrian_exposure: PedestrianExposure;
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
  recent_harsh_brake_count_10m: number;
  recent_sharp_turn_count_10m: number;
  previous_risk: number;
  risk_trend: "decreasing" | "stable" | "increasing";
}

export interface RiskAssessment {
  assessment_id: string;
  case_id: string;
  safety_incident_risk_score: number;
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

export interface Scenario {
  scenario_id: string;
  name: string;
  description: string;
  primary_vehicle_id: string;
  highlights: string[];
  events: VehicleEvent[];
}

export interface ScenarioPrediction {
  scenario_id: string;
  event_id: string;
  features: DerivedFeatures;
  assessment: Omit<RiskAssessment, "assessment_id" | "case_id" | "created_at">;
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
