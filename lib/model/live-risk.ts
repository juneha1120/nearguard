import type { DerivedFeatures, LivePrimeMoverSnapshot, LiveZoneSnapshot } from "@/lib/types/domain";

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
