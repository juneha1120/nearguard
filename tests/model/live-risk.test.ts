import { describe, expect, it } from "vitest";
import { assessLiveVehicleNearMissRisk, calculateVehicleInteractionFeatures, calculateZoneOperationalRisk } from "@/lib/model/live-risk";
import type { LivePrimeMoverSnapshot, LiveTelemetrySample, LiveZoneSnapshot } from "@/lib/types/domain";

const zone: LiveZoneSnapshot = {
  zone_id: "YARD-C4",
  updated_at: "2026-08-19T09:14:02+08:00",
  active_prime_movers: 3,
  avg_speed: 24,
  speed_compliance: 0.95,
  stale_gps_count: 0,
  delayed_gps_count: 0,
  harsh_brake_count_5m: 0,
  sharp_turn_count_5m: 0,
  traffic_pressure: 0.4,
  weather: "clear",
  restriction_level: "normal",
  pedestrian_exposure: "low",
  slow_down_zone_active: false,
  prime_movers: []
};

const mover: LivePrimeMoverSnapshot = {
  vehicle_id: "PM-27",
  speed: 22,
  speed_limit: 25,
  gps_freshness: "fresh",
  state: "normal"
};

describe("live telemetry risk scoring", () => {
  it("calculates nearby Prime Mover interaction features from same-zone positions", () => {
    const target: LivePrimeMoverSnapshot = {
      ...mover,
      vehicle_id: "PM-27",
      speed: 20,
      position: { x: 0, y: 0 },
      heading_degrees: 90,
      accuracy_m: 5
    };
    const nearest: LivePrimeMoverSnapshot = {
      ...mover,
      vehicle_id: "PM-42",
      speed: 28,
      position: { x: 1.8, y: 0 },
      heading_degrees: 270,
      accuracy_m: 5
    };
    const otherNearby: LivePrimeMoverSnapshot = {
      ...mover,
      vehicle_id: "PM-58",
      speed: 18,
      position: { x: 0, y: 4 },
      heading_degrees: 0,
      accuracy_m: 5
    };

    const features = calculateVehicleInteractionFeatures(target, { ...zone, prime_movers: [target, nearest, otherNearby] });

    expect(features.interaction_features_available).toBe(true);
    expect(features.nearby_vehicle_count_50m).toBe(2);
    expect(features.nearest_vehicle_distance_m).toBe(18);
    expect(features.nearest_vehicle_relative_speed_kmh).toBe(8);
    expect(features.closing_rate_mps).toBeCloseTo(13.33);
  });

  it("marks interaction features unavailable when position or GPS quality is unusable", () => {
    const features = calculateVehicleInteractionFeatures(
      { ...mover, gps_freshness: "stale", position: { x: 0, y: 0 }, accuracy_m: 30 },
      { ...zone, prime_movers: [{ ...mover, vehicle_id: "PM-42", position: { x: 12, y: 0 }, accuracy_m: 5 }] }
    );

    expect(features.interaction_features_available).toBe(false);
    expect(features.nearest_vehicle_distance_m).toBe(999);
  });

  it("keeps interaction features available when there are simply no nearby movers", () => {
    const target: LivePrimeMoverSnapshot = {
      ...mover,
      position: { x: 0, y: 0 },
      heading_degrees: 90,
      accuracy_m: 5
    };
    const sample: LiveTelemetrySample = {
      sample_id: "solo",
      timestamp: zone.updated_at,
      zones: [{ ...zone, prime_movers: [target] }]
    };

    const result = assessLiveVehicleNearMissRisk([sample], sample, sample.zones[0], target);

    expect(result.features.interaction_features_available).toBe(true);
    expect(result.features.nearby_vehicle_count_50m).toBe(0);
    expect(result.assessment.confidence).toBe("high");
    expect(result.assessment.uncertainty_reason).toBeNull();
  });

  it("calculates zone operational risk from live telemetry fields", () => {
    const calmRisk = calculateZoneOperationalRisk(zone);
    const busyRisk = calculateZoneOperationalRisk({
      ...zone,
      speed_compliance: 0.62,
      stale_gps_count: 2,
      harsh_brake_count_5m: 2,
      traffic_pressure: 0.9,
      weather: "rain",
      restriction_level: "restricted",
      pedestrian_exposure: "medium"
    });

    expect(calmRisk).toBeGreaterThan(0);
    expect(busyRisk).toBeGreaterThan(calmRisk);
  });

  it("continuously assesses vehicle near-miss risk through the live model path", () => {
    const calmSample: LiveTelemetrySample = {
      sample_id: "sample-1",
      timestamp: zone.updated_at,
      zones: [{ ...zone, prime_movers: [mover] }]
    };
    const elevatedZone: LiveZoneSnapshot = {
      ...zone,
      updated_at: "2026-08-19T09:14:05+08:00",
      traffic_pressure: 0.88,
      weather: "rain",
      restriction_level: "caution",
      pedestrian_exposure: "medium",
      prime_movers: [
        {
          ...mover,
          speed: 34,
          gps_freshness: "delayed" as const,
          state: "speeding" as const
        }
      ]
    };
    const elevatedSample: LiveTelemetrySample = {
      sample_id: "sample-2",
      timestamp: elevatedZone.updated_at,
      zones: [elevatedZone]
    };

    const normalRisk = assessLiveVehicleNearMissRisk([calmSample], calmSample, zone, mover).assessment.safety_incident_risk_score;
    const elevatedAssessment = assessLiveVehicleNearMissRisk(
      [calmSample, elevatedSample],
      elevatedSample,
      elevatedZone,
      elevatedZone.prime_movers[0]
    );

    expect(normalRisk).toBeGreaterThan(0);
    expect(elevatedAssessment.assessment.safety_incident_risk_score).toBeGreaterThan(normalRisk);
    expect(elevatedAssessment.features.speeding_ratio_10m).toBeGreaterThan(0);
    expect(elevatedAssessment.assessment.prediction_horizon).toBe("15m");
  });

  it("raises live risk when a nearby Prime Mover is closing on the target", () => {
    const target: LivePrimeMoverSnapshot = {
      ...mover,
      speed: 18,
      position: { x: 0, y: 0 },
      heading_degrees: 90,
      accuracy_m: 5
    };
    const closingMover: LivePrimeMoverSnapshot = {
      ...mover,
      vehicle_id: "PM-42",
      speed: 32,
      position: { x: 1.6, y: 0 },
      heading_degrees: 270,
      accuracy_m: 5
    };
    const baseSample: LiveTelemetrySample = {
      sample_id: "base",
      timestamp: "2026-08-19T09:14:01+08:00",
      zones: [{ ...zone, prime_movers: [target] }]
    };
    const interactionSample: LiveTelemetrySample = {
      sample_id: "interaction",
      timestamp: "2026-08-19T09:14:02+08:00",
      zones: [{ ...zone, prime_movers: [target, closingMover] }]
    };

    const normalRisk = assessLiveVehicleNearMissRisk([baseSample], baseSample, baseSample.zones[0], target).assessment.safety_incident_risk_score;
    const interactionAssessment = assessLiveVehicleNearMissRisk(
      [baseSample, interactionSample],
      interactionSample,
      interactionSample.zones[0],
      target
    );

    expect(interactionAssessment.features.interaction_features_available).toBe(true);
    expect(interactionAssessment.assessment.safety_incident_risk_score).toBeGreaterThan(normalRisk);
    expect(interactionAssessment.assessment.top_risk_reasons.join(" ")).toMatch(/Nearest PM|closing/);
  });
});
