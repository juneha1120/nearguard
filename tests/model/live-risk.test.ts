import { describe, expect, it } from "vitest";
import * as liveRisk from "@/lib/model/live-risk";
import { calculateVehicleInteractionFeatures, calculateZoneOperationalRisk } from "@/lib/model/live-risk";
import type { LivePrimeMoverSnapshot, LiveZoneSnapshot } from "@/lib/types/domain";

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

    const features = calculateVehicleInteractionFeatures(target, { ...zone, prime_movers: [target] });

    expect(features.interaction_features_available).toBe(true);
    expect(features.nearby_vehicle_count_50m).toBe(0);
    expect(features.nearest_vehicle_distance_m).toBe(999);
    expect(features.closing_rate_mps).toBe(0);
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

  it("calculates closing interaction features when a nearby Prime Mover is closing on the target", () => {
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

    const features = calculateVehicleInteractionFeatures(target, { ...zone, prime_movers: [target, closingMover] });

    expect(features.interaction_features_available).toBe(true);
    expect(features.nearest_vehicle_distance_m).toBe(16);
    expect(features.closing_rate_mps).toBeGreaterThan(0);
  });

  it("does not export a TypeScript live vehicle risk scorer", () => {
    expect(liveRisk).not.toHaveProperty("assessLiveVehicleNearMissRisk");
    expect(liveRisk).not.toHaveProperty("predictLiveVehicleNearMissRisk");
  });
});
