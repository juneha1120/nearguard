import { riskBandFor } from "@/lib/model/risk";
import { speedOverLimitBand } from "@/lib/model/features";
import type {
  Confidence,
  DerivedFeatures,
  EventType,
  LivePrimeMoverSnapshot,
  LiveTelemetrySample,
  LiveZoneSnapshot,
  RiskAssessment,
  ZoneRegistryEntry
} from "@/lib/types/domain";

export const MAP_METERS_PER_UNIT = 10;

function clampRisk(value: number) {
  return Number(Math.max(0, Math.min(0.96, value)).toFixed(3));
}

function weatherRisk(weather: LiveZoneSnapshot["weather"]) {
  if (weather === "heavy_rain") return 0.16;
  if (weather === "rain") return 0.09;
  return 0;
}

function restrictionRisk(restriction: LiveZoneSnapshot["restriction_level"]) {
  if (restriction === "wharf") return 0.14;
  if (restriction === "restricted") return 0.12;
  if (restriction === "caution") return 0.06;
  return 0;
}

function pedestrianRisk(exposure: LiveZoneSnapshot["pedestrian_exposure"]) {
  if (exposure === "high") return 0.12;
  if (exposure === "medium") return 0.06;
  return 0;
}

function gpsRisk(gps: LivePrimeMoverSnapshot["gps_freshness"]) {
  if (gps === "stale") return 0.16;
  if (gps === "delayed") return 0.08;
  return 0;
}

function stateRisk(state: LivePrimeMoverSnapshot["state"]) {
  if (state === "harsh brake") return 0.2;
  if (state === "sharp turn") return 0.18;
  if (state === "speeding") return 0.16;
  if (state === "stale GPS") return 0.12;
  if (state === "watching") return 0.06;
  return 0;
}

function trafficLevelFromPressure(pressure: number): DerivedFeatures["traffic_level"] {
  if (pressure >= 0.75) return "high";
  if (pressure >= 0.45) return "medium";
  return "low";
}

function eventTypeFromLiveState(state: LivePrimeMoverSnapshot["state"]): EventType {
  if (state === "speeding") return "speeding";
  if (state === "harsh brake") return "harsh_brake";
  if (state === "sharp turn") return "sharp_turn";
  if (state === "stale GPS") return "stale_gps";
  if (state === "recovering") return "speed_normalized";
  return "normal_update";
}

function average(values: number[]) {
  if (!values.length) return 0;
  return values.reduce((total, value) => total + value, 0) / values.length;
}

function standardDeviation(values: number[]) {
  const mean = average(values);
  if (!values.length) return 0;
  return Math.sqrt(values.reduce((total, value) => total + (value - mean) ** 2, 0) / values.length);
}

function defaultInteractionFeatures() {
  return {
    nearby_vehicle_count_50m: 0,
    nearest_vehicle_distance_m: 999,
    nearest_vehicle_relative_speed_kmh: 0,
    closing_rate_mps: 0,
    interaction_features_available: false
  };
}

function noNearbyVehicleFeatures() {
  return {
    ...defaultInteractionFeatures(),
    interaction_features_available: true
  };
}

function distanceMeters(a: LivePrimeMoverSnapshot["position"], b: LivePrimeMoverSnapshot["position"]) {
  if (!a || !b) return null;
  return Math.hypot(a.x - b.x, a.y - b.y) * MAP_METERS_PER_UNIT;
}

function hasUsablePosition(mover: LivePrimeMoverSnapshot) {
  return Boolean(mover.position && mover.gps_freshness !== "stale" && (mover.accuracy_m ?? 0) <= 25);
}

function velocityFromHeading(mover: LivePrimeMoverSnapshot) {
  if (mover.heading_degrees === undefined) return null;
  const radians = (mover.heading_degrees * Math.PI) / 180;
  const speedMps = mover.speed / 3.6;
  return {
    x: Math.sin(radians) * speedMps,
    y: -Math.cos(radians) * speedMps
  };
}

function velocityFromPrevious(current: LivePrimeMoverSnapshot, previous: LivePrimeMoverSnapshot | undefined, seconds: number) {
  if (!current.position || !previous?.position || seconds <= 0) return velocityFromHeading(current);
  return {
    x: ((current.position.x - previous.position.x) * MAP_METERS_PER_UNIT) / seconds,
    y: ((current.position.y - previous.position.y) * MAP_METERS_PER_UNIT) / seconds
  };
}

export function calculateVehicleInteractionFeatures(
  target: LivePrimeMoverSnapshot,
  zone: LiveZoneSnapshot,
  previousZone?: LiveZoneSnapshot | null,
  elapsedSeconds = 1
): Pick<
  DerivedFeatures,
  | "nearby_vehicle_count_50m"
  | "nearest_vehicle_distance_m"
  | "nearest_vehicle_relative_speed_kmh"
  | "closing_rate_mps"
  | "interaction_features_available"
> {
  if (!hasUsablePosition(target)) return defaultInteractionFeatures();

  const candidates = zone.prime_movers
    .filter((mover) => mover.vehicle_id !== target.vehicle_id && hasUsablePosition(mover))
    .map((mover) => ({
      mover,
      distance: distanceMeters(target.position, mover.position) ?? Number.POSITIVE_INFINITY
    }))
    .filter((item) => Number.isFinite(item.distance))
    .sort((a, b) => a.distance - b.distance);

  if (!candidates.length) return noNearbyVehicleFeatures();

  const nearest = candidates[0];
  const previousTarget = previousZone?.prime_movers.find((mover) => mover.vehicle_id === target.vehicle_id);
  const previousNearest = previousZone?.prime_movers.find((mover) => mover.vehicle_id === nearest.mover.vehicle_id);
  const targetVelocity = velocityFromPrevious(target, previousTarget, elapsedSeconds);
  const nearestVelocity = velocityFromPrevious(nearest.mover, previousNearest, elapsedSeconds);
  let closingRate = 0;

  if (target.position && nearest.mover.position && targetVelocity && nearestVelocity && nearest.distance > 0) {
    const relativePosition = {
      x: (nearest.mover.position.x - target.position.x) * MAP_METERS_PER_UNIT,
      y: (nearest.mover.position.y - target.position.y) * MAP_METERS_PER_UNIT
    };
    const relativeVelocity = {
      x: nearestVelocity.x - targetVelocity.x,
      y: nearestVelocity.y - targetVelocity.y
    };
    const distanceDerivative =
      (relativePosition.x * relativeVelocity.x + relativePosition.y * relativeVelocity.y) / Math.max(nearest.distance, 1);
    closingRate = Math.max(0, -distanceDerivative);
  }

  return {
    nearby_vehicle_count_50m: candidates.filter((item) => item.distance <= 50).length,
    nearest_vehicle_distance_m: Number(nearest.distance.toFixed(1)),
    nearest_vehicle_relative_speed_kmh: Number(Math.abs(target.speed - nearest.mover.speed).toFixed(1)),
    closing_rate_mps: Number(closingRate.toFixed(2)),
    interaction_features_available: true
  };
}

function liveAssessmentReasons(features: DerivedFeatures) {
  const reasons: string[] = [];

  if (features.interaction_features_available && features.nearest_vehicle_distance_m <= 50) {
    reasons.push(`Nearest PM is ${Math.round(features.nearest_vehicle_distance_m)}m away.`);
  }
  if (features.interaction_features_available && features.closing_rate_mps >= 0.5) {
    reasons.push(`Nearby PM is closing at ${features.closing_rate_mps.toFixed(1)} m/s.`);
  }
  if (features.interaction_features_available && features.nearby_vehicle_count_50m >= 2) {
    reasons.push(`${features.nearby_vehicle_count_50m} PMs detected within 50m.`);
  }
  if (features.speed_over_limit > 0) reasons.push(`${features.speed_over_limit} km/h over the zone speed limit.`);
  if (features.speed / Math.max(features.speed_limit, 1) >= 0.9 && features.speed_over_limit <= 0) {
    reasons.push("Speed is staying close to the limit while rain and heavy traffic reduce stopping margin.");
  }
  if (features.recent_harsh_brake_count_10m > 0 || features.recent_sharp_turn_count_10m > 0) {
    reasons.push("Recent movement includes sharp turns or harsh braking.");
  }
  if (features.traffic_weather_compound_index >= 0.65) reasons.push("Rain and traffic are increasing zone operating pressure.");
  if (features.zone_transition_risk >= 0.7 || features.pedestrian_exposure !== "low") {
    reasons.push("This zone has added exposure from restrictions or pedestrian movement.");
  }
  if (features.gps_freshness !== "fresh") reasons.push("Telemetry quality reduces location confidence.");
  if (features.risk_trend === "increasing") reasons.push("Rolling risk trend is increasing.");

  return reasons.length ? reasons.slice(0, 4) : ["Current rolling telemetry remains within the monitoring envelope."];
}

export function calculateZoneOperationalRisk(zone: LiveZoneSnapshot) {
  const nonCompliance = 1 - zone.speed_compliance;
  const gpsQualityRisk = Math.min(0.16, zone.stale_gps_count * 0.06 + zone.delayed_gps_count * 0.03);
  const maneuverRisk = Math.min(0.18, zone.harsh_brake_count_5m * 0.07 + zone.sharp_turn_count_5m * 0.06);
  const contextRisk = weatherRisk(zone.weather) + restrictionRisk(zone.restriction_level) + pedestrianRisk(zone.pedestrian_exposure);
  const slowDownRisk = zone.slow_down_zone_active ? 0.04 : 0;

  return clampRisk(
    0.18 +
      zone.traffic_pressure * 0.24 +
      nonCompliance * 0.22 +
      gpsQualityRisk +
      maneuverRisk +
      contextRisk +
      slowDownRisk
  );
}

export function deriveLiveVehicleFeatures(
  samples: LiveTelemetrySample[],
  currentSample: LiveTelemetrySample,
  zone: LiveZoneSnapshot,
  mover: LivePrimeMoverSnapshot,
  zoneRegistryEntry?: ZoneRegistryEntry | null,
  previousRisk = 0.12
): DerivedFeatures {
  const currentTime = new Date(currentSample.timestamp).getTime();
  const tenMinutes = 10 * 60 * 1000;
  const windowMovers = samples
    .filter((sample) => {
      const sampleTime = new Date(sample.timestamp).getTime();
      return !Number.isNaN(sampleTime) && sampleTime <= currentTime && currentTime - sampleTime <= tenMinutes;
    })
    .map((sample) => sample.zones.flatMap((item) => item.prime_movers).find((item) => item.vehicle_id === mover.vehicle_id))
    .filter((item): item is LivePrimeMoverSnapshot => Boolean(item));
  const rollingWindow = windowMovers.length ? windowMovers : [mover];
  const speeds = rollingWindow.map((item) => item.speed);
  const speedingEvents = rollingWindow.filter((item) => item.speed > item.speed_limit).length;
  const harshBrakeCount = rollingWindow.filter((item) => item.state === "harsh brake").length;
  const sharpTurnCount = rollingWindow.filter((item) => item.state === "sharp turn").length;
  const alertEvents = rollingWindow.filter((item) => item.state !== "normal" && item.state !== "recovering").length;
  const speedOverLimit = Math.max(0, mover.speed - mover.speed_limit);
  const weatherIndex = { clear: 0, rain: 0.5, heavy_rain: 1 }[zone.weather];
  const trafficLevel = trafficLevelFromPressure(zone.traffic_pressure);
  const trafficIndex = { low: 0, medium: 0.5, high: 1 }[trafficLevel];
  const restrictionIndex = { normal: 0, caution: 0.35, restricted: 0.7, wharf: 1 }[zone.restriction_level];
  const currentSignal = speedOverLimit / 25 + harshBrakeCount * 0.1 + sharpTurnCount * 0.1 + stateRisk(mover.state);
  const previousWindowMover = rollingWindow.at(-2);
  const previousSample = samples
    .filter((sample) => sample.sample_id !== currentSample.sample_id)
    .filter((sample) => new Date(sample.timestamp).getTime() < currentTime)
    .at(-1);
  const previousZone = previousSample?.zones.find((item) => item.zone_id === zone.zone_id) ?? null;
  const previousZoneTime = previousSample ? new Date(previousSample.timestamp).getTime() : Number.NaN;
  const elapsedSeconds =
    previousSample && !Number.isNaN(previousZoneTime) ? Math.max(0.001, (currentTime - previousZoneTime) / 1000) : 1;
  const interactionFeatures = calculateVehicleInteractionFeatures(mover, zone, previousZone, elapsedSeconds);

  let riskTrend: DerivedFeatures["risk_trend"] = "stable";
  if (mover.state === "recovering" || (previousWindowMover && mover.speed < previousWindowMover.speed - 3)) {
    riskTrend = "decreasing";
  } else if (currentSignal > previousRisk + 0.04 || mover.speed > (previousWindowMover?.speed ?? mover.speed) + 3) {
    riskTrend = "increasing";
  }

  return {
    speed: mover.speed,
    speed_limit: mover.speed_limit,
    event_type: eventTypeFromLiveState(mover.state),
    gps_freshness: mover.gps_freshness,
    traffic_level: trafficLevel,
    weather: zone.weather,
    zone_historical_risk: zoneRegistryEntry?.zone_historical_risk ?? calculateZoneOperationalRisk(zone),
    restriction_level: zone.restriction_level,
    slow_down_zone_active: zone.slow_down_zone_active,
    pedestrian_exposure: zone.pedestrian_exposure,
    speed_over_limit: speedOverLimit,
    speed_over_limit_band: speedOverLimitBand(speedOverLimit),
    speeding_ratio_5m: Number((speedingEvents / Math.max(rollingWindow.length, 1)).toFixed(3)),
    speeding_ratio_10m: Number((speedingEvents / Math.max(rollingWindow.length, 1)).toFixed(3)),
    mean_speed_5m: Number(average(speeds).toFixed(2)),
    mean_speed_30m: Number(average(speeds).toFixed(2)),
    max_speed_5m: Math.max(...speeds),
    speed_std_10m: Number(standardDeviation(speeds).toFixed(2)),
    speed_delta_last_3_events: rollingWindow.length >= 2 ? mover.speed - rollingWindow.slice(-3)[0].speed : 0,
    harsh_brake_count_10m: harshBrakeCount,
    sharp_turn_count_10m: sharpTurnCount,
    recent_harsh_brake_count_10m: harshBrakeCount,
    recent_sharp_turn_count_10m: sharpTurnCount,
    alert_density_30m: Number((alertEvents / 0.5).toFixed(2)),
    risk_escalation_rate: Number(Math.max(0, currentSignal - previousRisk).toFixed(3)),
    shift_hours: 4.2,
    night_flag: false,
    time_since_last_intervention: 999,
    reaction_window_active: false,
    post_intervention_noncompliance: false,
    traffic_weather_compound_index: Number(((trafficIndex + weatherIndex) / 2).toFixed(2)),
    zone_transition_risk: Number(restrictionIndex.toFixed(2)),
    ...interactionFeatures,
    previous_risk: previousRisk,
    risk_trend: riskTrend
  };
}

export function predictLiveVehicleNearMissRisk(features: DerivedFeatures) {
  const nearestVehicleRisk = features.interaction_features_available
    ? features.nearest_vehicle_distance_m <= 15
      ? 0.16
      : features.nearest_vehicle_distance_m <= 25
        ? 0.1
        : features.nearest_vehicle_distance_m <= 50
          ? 0.05
          : 0
    : 0;
  const score = clampRisk(
    0.08 +
      Math.min(0.28, features.speed_over_limit * 0.035) +
      features.speeding_ratio_10m * 0.16 +
      Math.min(0.16, features.speed_std_10m * 0.018) +
      Math.min(0.18, features.recent_harsh_brake_count_10m * 0.07 + features.recent_sharp_turn_count_10m * 0.06) +
      features.traffic_weather_compound_index * 0.12 +
      features.zone_transition_risk * 0.1 +
      features.zone_historical_risk * 0.12 +
      pedestrianRisk(features.pedestrian_exposure) +
      gpsRisk(features.gps_freshness) +
      nearestVehicleRisk +
      Math.min(0.12, features.nearby_vehicle_count_50m * 0.035) +
      Math.min(0.08, features.nearest_vehicle_relative_speed_kmh * 0.006) +
      Math.min(0.14, features.closing_rate_mps * 0.05) +
      (features.slow_down_zone_active ? 0.04 : 0) +
      (features.risk_trend === "increasing" ? 0.08 : features.risk_trend === "decreasing" ? -0.06 : 0)
  );
  const confidence: Confidence =
    features.gps_freshness === "stale" ? "low" : features.gps_freshness === "delayed" || !features.interaction_features_available ? "medium" : "high";
  const uncertaintyReasons: string[] = [];
  if (features.gps_freshness === "stale") uncertaintyReasons.push("stale GPS telemetry");
  if (!features.interaction_features_available) uncertaintyReasons.push("nearby vehicle position unavailable");

  return {
    score,
    confidence,
    riskBand: riskBandFor(score, confidence),
    reasons: liveAssessmentReasons(features),
    uncertaintyReason: uncertaintyReasons.length ? `Live vehicle assessment is limited by ${uncertaintyReasons.join(" and ")}.` : null
  };
}

export function assessLiveVehicleNearMissRisk(
  samples: LiveTelemetrySample[],
  currentSample: LiveTelemetrySample,
  zone: LiveZoneSnapshot,
  mover: LivePrimeMoverSnapshot,
  zoneRegistryEntry?: ZoneRegistryEntry | null,
  previousRisk?: number
): { features: DerivedFeatures; assessment: RiskAssessment } {
  const features = deriveLiveVehicleFeatures(samples, currentSample, zone, mover, zoneRegistryEntry, previousRisk);
  const prediction = predictLiveVehicleNearMissRisk(features);

  return {
    features,
    assessment: {
      assessment_id: `live-${currentSample.sample_id}-${mover.vehicle_id}`,
      case_id: `live-${mover.vehicle_id}`,
      safety_incident_risk_score: prediction.score,
      prediction_horizon: "15m",
      evidence_authority: "SYNTHETIC_DATA",
      risk_band: prediction.riskBand,
      confidence: prediction.confidence,
      uncertainty_reason: prediction.uncertaintyReason,
      top_risk_reasons: prediction.reasons,
      created_at: currentSample.timestamp
    }
  };
}
