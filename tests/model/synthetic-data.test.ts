import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { listLivePredictions, listLiveTelemetrySamples } from "@/lib/data/repository";

function csvRows() {
  const [headerLine, ...lines] = readFileSync("data/synthetic_training_data.csv", "utf8").trim().split(/\r?\n/);
  const headers = headerLine.split(",");
  return lines.map((line) => {
    const values = line.split(",");
    return Object.fromEntries(headers.map((header, index) => [header, values[index]]));
  });
}

function average(values: number[]) {
  return values.reduce((total, value) => total + value, 0) / Math.max(values.length, 1);
}

describe("synthetic horizon dataset", () => {
  it("uses future near-miss labels with both positive and negative examples", () => {
    const rows = csvRows();
    const labels = new Set(rows.map((row) => row.near_miss_within_next_15m));

    expect(rows.length).toBeGreaterThan(1000);
    expect(labels.has("0")).toBe(true);
    expect(labels.has("1")).toBe(true);
    expect(rows[0].prediction_horizon).toBe("15m");
  });

  it("records synthetic label provenance and review metadata", () => {
    const rows = csvRows();

    expect(rows[0].label_source).toBe("SYNTHETIC_LATENT_PROCESS");
    expect(rows[0].review_status).toBe("synthetic_reviewed");
    expect(rows[0].matched_normal_window).toBe("False");
    expect(rows[0]).toHaveProperty("intervention_contaminated_window");
    expect(rows.some((row) => row.intervention_contaminated_window === "True")).toBe(true);
    expect(rows.some((row) => row.reaction_window_active === "True")).toBe(true);
  });

  it("exports V2V interaction feature columns for MVP+ training", () => {
    const rows = csvRows();

    expect(rows[0]).toHaveProperty("nearby_vehicle_count_50m");
    expect(rows[0]).toHaveProperty("nearest_vehicle_distance_m");
    expect(rows[0]).toHaveProperty("nearest_vehicle_relative_speed_kmh");
    expect(rows[0]).toHaveProperty("closing_rate_mps");
    expect(rows[0]).toHaveProperty("interaction_features_available");
    expect(rows.some((row) => row.interaction_features_available === "True")).toBe(true);
  });

  it("exports horizon and evidence authority for scenario predictions", () => {
    const payload = JSON.parse(readFileSync("models/scenario_predictions.json", "utf8"));
    const prediction = payload.predictions[0];

    expect(payload.target).toBe("near_miss_within_next_15m");
    expect(payload.prediction_horizon).toBe("15m");
    expect(prediction.assessment.prediction_horizon).toBe("15m");
    expect(prediction.assessment.evidence_authority).toBe("SYNTHETIC_DATA");
  });

  it("exports trained-model predictions for routine live monitoring", () => {
    const payload = JSON.parse(readFileSync("models/routine_live_predictions.json", "utf8"));
    const prediction = payload.predictions[0];

    expect(payload.target).toBe("near_miss_within_next_15m");
    expect(payload.prediction_horizon).toBe("15m");
    expect(payload.predictions.length).toBeGreaterThan(1000);
    expect(listLivePredictions()).toHaveLength(payload.predictions.length);
    expect(prediction).toHaveProperty("sample_id");
    expect(prediction).toHaveProperty("vehicle_id");
    expect(prediction).toHaveProperty("zone_id");
    expect(prediction.features).toHaveProperty("nearby_vehicle_count_50m");
    expect(prediction.assessment.prediction_horizon).toBe("15m");
    expect(prediction.assessment.evidence_authority).toBe("SYNTHETIC_DATA");
  });

  it("exports contaminated-row exclusion counts in model metrics", () => {
    const payload = JSON.parse(readFileSync("models/scenario_predictions.json", "utf8"));

    expect(payload.metrics.intervention_contaminated_excluded_rows).toBeGreaterThan(0);
    expect(payload.metrics.total_rows).toBeGreaterThan(payload.metrics.training_rows);
    expect(payload.metrics.total_rows - payload.metrics.training_rows).toBe(payload.metrics.intervention_contaminated_excluded_rows);
  });

  it("keeps high-risk scenarios above stabilized replay outcomes", () => {
    const payload = JSON.parse(readFileSync("models/scenario_predictions.json", "utf8"));
    const byEvent = new Map<string, number>(
      payload.predictions.map((item: any) => [item.event_id, item.assessment.safety_incident_risk_score])
    );
    const persistentRisk = byEvent.get("pm27-005");
    const stabilizedRisk = byEvent.get("ppt-003");
    const wharfExposureRisk = byEvent.get("wharf-002");
    const wharfStabilizedRisk = byEvent.get("wharf-003");

    expect(persistentRisk).toBeDefined();
    expect(stabilizedRisk).toBeDefined();
    expect(wharfExposureRisk).toBeDefined();
    expect(wharfStabilizedRisk).toBeDefined();
    expect(persistentRisk!).toBeGreaterThan(stabilizedRisk!);
    expect(wharfExposureRisk!).toBeGreaterThan(wharfStabilizedRisk!);
  });

  it("frames the primary demo as compound telemetry risk instead of a speeding-only alert", () => {
    const payload = JSON.parse(readFileSync("models/scenario_predictions.json", "utf8"));
    const pm27 = payload.predictions.find((item: any) => item.event_id === "pm27-003");

    expect(pm27.features.speeding_ratio_10m).toBeLessThan(0.35);
    expect(pm27.assessment.top_risk_reasons[0]).toBe(
      "Speed is staying close to the limit while rain and heavy traffic reduce stopping margin."
    );
    expect(pm27.assessment.top_risk_reasons[1]).toBe(
      "Recent sharp turn or harsh braking suggests the driver may need more space."
    );
    expect(pm27.assessment.top_risk_reasons.join(" ")).not.toMatch(/Speeding occurred/);
  });

  it("keeps the zone registry static", () => {
    const zones = JSON.parse(readFileSync("data/zone_registry.json", "utf8"));

    expect(zones[0]).toHaveProperty("zone_id");
    expect(zones[0]).toHaveProperty("zone_name");
    expect(zones[0]).toHaveProperty("zone_historical_risk");
    expect(zones[0]).not.toHaveProperty("traffic_level");
    expect(zones[0]).not.toHaveProperty("weather");
    expect(zones[0]).not.toHaveProperty("restriction_level");
    expect(zones[0]).not.toHaveProperty("pedestrian_exposure");
    expect(zones[0]).not.toHaveProperty("slow_down_zone_active");
  });

  it("keeps scenario decision points separate from dense telemetry", () => {
    const scenario = JSON.parse(readFileSync("data/scenario_decision_points/pm27-persistent-high-risk.json", "utf8"));
    const pmTelemetry = JSON.parse(readFileSync("data/scenario_prime_mover_telemetry/pm27-persistent-high-risk.json", "utf8"));
    const zoneTelemetry = JSON.parse(readFileSync("data/scenario_live_zone_telemetry/pm27-persistent-high-risk.json", "utf8"));

    expect(scenario.scenario_id).toBe("pm27-persistent-high-risk");
    expect(scenario.events.length).toBeLessThan(pmTelemetry.samples.length);
    expect(scenario.events.length).toBeLessThan(zoneTelemetry.samples.length);
    expect(scenario.events.map((event: any) => event.event_id)).toEqual(["pm27-001", "pm27-002", "pm27-003", "pm27-004", "pm27-005"]);
  });

  it("provides a loopable live zone telemetry stream", () => {
    const payload = JSON.parse(readFileSync("data/routine_live_zone_telemetry.json", "utf8"));
    const first = payload.samples[0];
    const last = payload.samples.at(-1);

    expect(payload.samples.length).toBeGreaterThanOrEqual(1200);
    expect(first.zones).toHaveLength(4);
    expect(first.zones[0].prime_movers.length).toBeGreaterThan(0);
    expect(first.zones[0]).not.toHaveProperty("live_risk");
    expect(last.zones[0]).not.toHaveProperty("live_risk");
    expect(new Date(payload.samples[1].timestamp).getTime() - new Date(first.timestamp).getTime()).toBe(1000);
    expect(new Set(first.zones.map((zone: any) => zone.zone_id))).toEqual(
      new Set(["YARD-C4", "PPT-LINK-25", "YARD-U2", "WHARF-C4"])
    );
  });

  it("provides a separate loopable routine Prime Mover telemetry stream", () => {
    const payload = JSON.parse(readFileSync("data/routine_prime_mover_telemetry.json", "utf8"));
    const first = payload.samples[0];

    expect(payload.samples.length).toBeGreaterThanOrEqual(1200);
    expect(first.sample_id).toBe("routine-pm-0001");
    expect(first.prime_movers.length).toBeGreaterThan(0);
    expect(first.prime_movers[0]).toHaveProperty("zone_id");
    expect(first.prime_movers[0]).toHaveProperty("vehicle_id");
    expect(first.prime_movers[0]).not.toHaveProperty("rolling_risk_contribution");
    expect(new Date(payload.samples[1].timestamp).getTime() - new Date(first.timestamp).getTime()).toBe(1000);
  });

  it("keeps routine Prime Mover telemetry aligned with routine live zone telemetry", () => {
    const livePayload = JSON.parse(readFileSync("data/routine_live_zone_telemetry.json", "utf8"));
    const primeMoverPayload = JSON.parse(readFileSync("data/routine_prime_mover_telemetry.json", "utf8"));
    const runtimeSamples = listLiveTelemetrySamples();

    expect(primeMoverPayload.samples).toHaveLength(livePayload.samples.length);
    expect(runtimeSamples).toHaveLength(primeMoverPayload.samples.length);

    for (const [sampleIndex, primeMoverSample] of primeMoverPayload.samples.entries()) {
      const liveSample = livePayload.samples[sampleIndex];
      const runtimeSample = runtimeSamples[sampleIndex];

      expect(primeMoverSample.timestamp).toBe(liveSample.timestamp);
      expect(runtimeSample.timestamp).toBe(primeMoverSample.timestamp);

      const liveMovers = liveSample.zones
        .flatMap((zone: any) => zone.prime_movers.map((mover: any) => ({ zone_id: zone.zone_id, ...mover })))
        .sort((a: any, b: any) => `${a.zone_id}-${a.vehicle_id}`.localeCompare(`${b.zone_id}-${b.vehicle_id}`));
      const primeMovers = [...primeMoverSample.prime_movers].sort((a: any, b: any) =>
        `${a.zone_id}-${a.vehicle_id}`.localeCompare(`${b.zone_id}-${b.vehicle_id}`)
      );
      const runtimeMovers = runtimeSample.zones
        .flatMap((zone: any) =>
          zone.prime_movers.map((mover: any) => ({
            zone_id: zone.zone_id,
            vehicle_id: mover.vehicle_id,
            speed: mover.speed,
            speed_limit: mover.speed_limit,
            gps_freshness: mover.gps_freshness,
            state: mover.state
          }))
        )
        .sort((a: any, b: any) => `${a.zone_id}-${a.vehicle_id}`.localeCompare(`${b.zone_id}-${b.vehicle_id}`));

      expect(liveMovers).toEqual(primeMovers);
      expect(runtimeMovers).toEqual(primeMovers);
    }
  });

  it("provides dense one-second telemetry for scenario primary vehicles", () => {
    const payload = JSON.parse(readFileSync("data/scenario_prime_mover_telemetry/pm27-persistent-high-risk.json", "utf8"));
    const pm27 = payload.samples;
    const betweenAnchors = pm27.filter(
      (sample: any) =>
        new Date(sample.timestamp).getTime() > new Date("2026-08-19T09:14:42+08:00").getTime() &&
        new Date(sample.timestamp).getTime() < new Date("2026-08-19T09:15:26+08:00").getTime()
    );

    expect(pm27.length).toBeGreaterThan(200);
    expect(pm27[0]).not.toHaveProperty("rolling_risk_contribution");
    expect(new Date(pm27[1].timestamp).getTime() - new Date(pm27[0].timestamp).getTime()).toBe(1000);
    expect(betweenAnchors.length).toBeGreaterThan(30);
    expect(new Set(betweenAnchors.map((sample: any) => sample.vehicle_id))).toEqual(new Set(["PM-27"]));
    expect(betweenAnchors.some((sample: any) => sample.event_anchor_id === null)).toBe(true);
  });

  it("keeps scenario PM map motion consistent with telemetry speed", () => {
    const payload = JSON.parse(readFileSync("data/scenario_prime_mover_telemetry/pm27-persistent-high-risk.json", "utf8"));
    const mapMetersPerUnit = 10;
    const derivedSpeeds: number[] = [];
    const telemetrySpeeds: number[] = [];

    for (let index = 1; index < payload.samples.length; index += 1) {
      const previous = payload.samples[index - 1];
      const current = payload.samples[index];
      const elapsedSeconds = (new Date(current.timestamp).getTime() - new Date(previous.timestamp).getTime()) / 1000;
      const distanceMeters =
        Math.hypot(current.position.x - previous.position.x, current.position.y - previous.position.y) * mapMetersPerUnit;
      derivedSpeeds.push((distanceMeters / elapsedSeconds) * 3.6);
      telemetrySpeeds.push(current.speed);
    }

    const ratio = average(derivedSpeeds) / average(telemetrySpeeds);

    expect(ratio).toBeGreaterThan(0.95);
    expect(ratio).toBeLessThan(1.05);
  });

  it("provides matching dense dynamic zone telemetry for scenarios", () => {
    const vehiclePayload = JSON.parse(readFileSync("data/scenario_prime_mover_telemetry/pm27-persistent-high-risk.json", "utf8"));
    const zonePayload = JSON.parse(readFileSync("data/scenario_live_zone_telemetry/pm27-persistent-high-risk.json", "utf8"));

    expect(zonePayload.samples).toHaveLength(vehiclePayload.samples.length);
    expect(zonePayload.samples[0].timestamp).toBe(vehiclePayload.samples[0].timestamp);
    expect(zonePayload.samples[1].timestamp).toBe(vehiclePayload.samples[1].timestamp);
    expect(zonePayload.samples.some((sample: any) => sample.harsh_brake_count_5m > 0)).toBe(true);
    expect(zonePayload.samples.every((sample: any) => sample.zone_id === "YARD-C4")).toBe(true);
  });
});
