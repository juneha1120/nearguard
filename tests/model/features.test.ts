import { describe, expect, it } from "vitest";
import { deriveFeatures, speedOverLimitBand } from "@/lib/model/features";
import type { VehicleCase, VehicleEvent, ZoneContext } from "@/lib/types/domain";

const zone: ZoneContext = {
  zone_id: "YARD-C4",
  zone_name: "Yard C4",
  traffic_level: "high",
  weather: "rain",
  zone_historical_risk: 0.72,
  restriction_level: "caution",
  slow_down_zone_active: false,
  pedestrian_exposure: "medium"
};

const vehicleCase: VehicleCase = {
  case_id: "case-PM-27",
  vehicle_id: "PM-27",
  status: "monitoring",
  current_risk: 0.61,
  previous_risk: 0.38,
  confidence: "medium",
  risk_reasons: [],
  recommended_action: "",
  authority_class: "",
  pending_approval: false,
  created_at: "2026-08-19T09:14:02+08:00",
  updated_at: "2026-08-19T09:14:42+08:00"
};

describe("derived features", () => {
  it("maps speed-over-limit bands at documented thresholds", () => {
    expect(speedOverLimitBand(0)).toBe("none");
    expect(speedOverLimitBand(10)).toBe("minor");
    expect(speedOverLimitBand(20)).toBe("moderate");
    expect(speedOverLimitBand(21)).toBe("severe");
  });

  it("counts recent harsh brakes and sharp turns for the same vehicle", () => {
    const event: VehicleEvent = {
      event_id: "pm27-003",
      timestamp: "2026-08-19T09:15:26+08:00",
      vehicle_id: "PM-27",
      zone_id: "YARD-C4",
      event_type: "harsh_brake",
      speed: 29,
      speed_limit: 25,
      gps_freshness: "fresh"
    };
    const recent: VehicleEvent[] = [
      { ...event, event_id: "old-1", event_type: "harsh_brake", timestamp: "2026-08-19T09:14:10+08:00" },
      { ...event, event_id: "old-2", event_type: "sharp_turn", timestamp: "2026-08-19T09:14:40+08:00" }
    ];

    const features = deriveFeatures(event, zone, recent, vehicleCase);

    expect(features.speed_over_limit).toBe(4);
    expect(features.speed_over_limit_band).toBe("minor");
    expect(features.recent_harsh_brake_count_10m).toBe(1);
    expect(features.recent_sharp_turn_count_10m).toBe(1);
  });
});
