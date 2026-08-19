import type { DerivedFeatures, VehicleCase, VehicleEvent, ZoneContext } from "@/lib/types/domain";

export function speedOverLimitBand(value: number): DerivedFeatures["speed_over_limit_band"] {
  if (value <= 0) return "none";
  if (value <= 10) return "minor";
  if (value <= 20) return "moderate";
  return "severe";
}

export function deriveFeatures(
  event: VehicleEvent,
  zone: ZoneContext,
  recentEvents: VehicleEvent[],
  vehicleCase: VehicleCase | null
): DerivedFeatures {
  const speedOverLimit = Math.max(0, event.speed - event.speed_limit);
  const previousRisk = vehicleCase?.current_risk ?? 0.12;
  const recentHarshBrakeCount = recentEvents.filter((item) => item.event_type === "harsh_brake").length;
  const recentSharpTurnCount = recentEvents.filter((item) => item.event_type === "sharp_turn").length;
  const currentSignal = speedOverLimit / 25 + recentHarshBrakeCount * 0.1 + recentSharpTurnCount * 0.1;
  const previousSignal = previousRisk;

  let riskTrend: DerivedFeatures["risk_trend"] = "stable";
  if (event.event_type === "speed_normalized" || currentSignal < previousSignal - 0.08) {
    riskTrend = "decreasing";
  } else if (currentSignal > previousSignal + 0.04 || event.event_type !== "normal_update") {
    riskTrend = "increasing";
  }

  return {
    speed: event.speed,
    speed_limit: event.speed_limit,
    event_type: event.event_type,
    gps_freshness: event.gps_freshness,
    traffic_level: zone.traffic_level,
    weather: zone.weather,
    zone_historical_risk: zone.zone_historical_risk,
    restriction_level: zone.restriction_level,
    slow_down_zone_active: zone.slow_down_zone_active,
    pedestrian_exposure: zone.pedestrian_exposure,
    speed_over_limit: speedOverLimit,
    speed_over_limit_band: speedOverLimitBand(speedOverLimit),
    recent_harsh_brake_count_10m: recentHarshBrakeCount,
    recent_sharp_turn_count_10m: recentSharpTurnCount,
    previous_risk: previousRisk,
    risk_trend: riskTrend
  };
}

export function recentVehicleEvents(events: VehicleEvent[], currentEvent: VehicleEvent): VehicleEvent[] {
  const currentTime = new Date(currentEvent.timestamp).getTime();
  const tenMinutes = 10 * 60 * 1000;
  return events.filter((event) => {
    if (event.vehicle_id !== currentEvent.vehicle_id || event.event_id === currentEvent.event_id) return false;
    const time = new Date(event.timestamp).getTime();
    return time <= currentTime && currentTime - time <= tenMinutes;
  });
}
