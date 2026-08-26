import { describe, expect, it } from "vitest";
import { calculateZoneOperationalRisk } from "@/lib/model/live-risk";
import { applyWorkerReportToLiveSample, describeWorkerReportInfluence } from "@/lib/model/report-enrichment";
import type { LiveTelemetrySample, LiveZoneSnapshot, WorkerRiskReport } from "@/lib/types/domain";

const zone: LiveZoneSnapshot = {
  zone_id: "WHARF-A1",
  updated_at: "2026-08-19T09:14:02+08:00",
  active_prime_movers: 2,
  avg_speed: 18,
  speed_compliance: 0.9,
  stale_gps_count: 0,
  delayed_gps_count: 0,
  harsh_brake_count_5m: 0,
  sharp_turn_count_5m: 0,
  traffic_pressure: 0.3,
  weather: "clear",
  restriction_level: "normal",
  pedestrian_exposure: "low",
  slow_down_zone_active: false,
  prime_movers: []
};

const sample: LiveTelemetrySample = {
  sample_id: "sample-1",
  timestamp: zone.updated_at,
  zones: [zone]
};

const report: WorkerRiskReport = {
  report_id: "report-1",
  timestamp: "2026-08-19T09:14:03+08:00",
  reporter_role: "daily_safety_report",
  zone_id: "WHARF-A1",
  vehicle_id: null,
  description: "Poor visibility and workers crossing near the wharf.",
  extraction_confidence: "high",
  extraction_source: "gemini_generate_content",
  model: "gemini-2.5-flash",
  extracted_context: {
    hazard_type: "visibility_issue",
    zone_id: "WHARF-A1",
    vehicle_id: null,
    pedestrian_exposure: "high",
    traffic_level: "high",
    weather: "rain",
    restriction_level: "wharf",
    reported_severity: "high",
    operational_note: "Poor visibility with frequent worker crossing.",
    model_feature_impacts: ["pedestrian_exposure", "traffic_level", "weather", "restriction_level"]
  }
};

describe("worker report enrichment", () => {
  it("applies high-confidence LLM extracted context to live zone variables", () => {
    const enriched = applyWorkerReportToLiveSample(sample, report);

    expect(enriched?.zones[0]).toMatchObject({
      pedestrian_exposure: "high",
      traffic_pressure: 0.85,
      weather: "rain",
      restriction_level: "wharf"
    });
    expect(calculateZoneOperationalRisk(enriched!.zones[0])).toBeGreaterThan(calculateZoneOperationalRisk(zone));
  });

  it("does not apply low-confidence extraction to operational context", () => {
    const enriched = applyWorkerReportToLiveSample(sample, { ...report, extraction_confidence: "low" });

    expect(enriched).toBe(sample);
  });

  it("describes the zone variables changed by the extracted report", () => {
    expect(describeWorkerReportInfluence(sample, report)).toEqual([
      { field: "traffic_pressure", label: "Traffic pressure", before: "0.30", after: "0.85" },
      { field: "pedestrian_exposure", label: "Pedestrian exposure", before: "low", after: "high" },
      { field: "weather", label: "Weather", before: "clear", after: "rain" },
      { field: "restriction_level", label: "Restriction", before: "normal", after: "wharf" }
    ]);
  });
});
