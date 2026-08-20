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
  const allWindowEvents = [...recentEvents, event];
  const speedOverLimit = Math.max(0, event.speed - event.speed_limit);
  const previousRisk = vehicleCase?.current_risk ?? 0.12;
  const recentHarshBrakeCount = recentEvents.filter((item) => item.event_type === "harsh_brake").length;
  const recentSharpTurnCount = recentEvents.filter((item) => item.event_type === "sharp_turn").length;
  const speeds = allWindowEvents.map((item) => item.speed);
  const meanSpeed = speeds.reduce((total, value) => total + value, 0) / Math.max(speeds.length, 1);
  const speedStd = Math.sqrt(speeds.reduce((total, value) => total + (value - meanSpeed) ** 2, 0) / Math.max(speeds.length, 1));
  const lastThree = allWindowEvents.slice(-3);
  const speedDeltaLastThreeEvents = lastThree.length >= 2 ? lastThree.at(-1)!.speed - lastThree[0].speed : 0;
  const speedingEvents = allWindowEvents.filter((item) => item.speed > item.speed_limit).length;
  const alertEvents = allWindowEvents.filter((item) => ["speeding", "harsh_brake", "sharp_turn", "stale_gps", "risk_persistent"].includes(item.event_type)).length;
  const hasPriorIntervention = vehicleCase?.status === "monitoring" || vehicleCase?.status === "pending_approval" || vehicleCase?.status === "escalated";
  const weatherIndex = { clear: 0, rain: 0.5, heavy_rain: 1 }[zone.weather];
  const trafficIndex = { low: 0, medium: 0.5, high: 1 }[zone.traffic_level];
  const restrictionIndex = { normal: 0, caution: 0.35, restricted: 0.7, wharf: 1 }[zone.restriction_level];
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
    speeding_ratio_5m: Number((speedingEvents / Math.max(allWindowEvents.length, 1)).toFixed(3)),
    speeding_ratio_10m: Number((speedingEvents / Math.max(allWindowEvents.length, 1)).toFixed(3)),
    mean_speed_5m: Number(meanSpeed.toFixed(2)),
    mean_speed_30m: Number(meanSpeed.toFixed(2)),
    max_speed_5m: Math.max(...speeds),
    speed_std_10m: Number(speedStd.toFixed(2)),
    speed_delta_last_3_events: speedDeltaLastThreeEvents,
    recent_harsh_brake_count_10m: recentHarshBrakeCount,
    recent_sharp_turn_count_10m: recentSharpTurnCount,
    alert_density_30m: Number((alertEvents / 0.5).toFixed(2)),
    risk_escalation_rate: Number(Math.max(0, currentSignal - previousSignal).toFixed(3)),
    shift_hours: 4.2,
    night_flag: false,
    time_since_last_intervention: hasPriorIntervention ? 3 : 999,
    post_intervention_noncompliance: Boolean(hasPriorIntervention && speedOverLimit > 0),
    traffic_weather_compound_index: Number(((trafficIndex + weatherIndex) / 2).toFixed(2)),
    zone_transition_risk: Number(restrictionIndex.toFixed(2)),
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
