import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function csvRows() {
  const [headerLine, ...lines] = readFileSync("data/synthetic_training_data.csv", "utf8").trim().split(/\r?\n/);
  const headers = headerLine.split(",");
  return lines.map((line) => {
    const values = line.split(",");
    return Object.fromEntries(headers.map((header, index) => [header, values[index]]));
  });
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
  });

  it("exports horizon and evidence authority for scenario predictions", () => {
    const payload = JSON.parse(readFileSync("models/scenario_predictions.json", "utf8"));
    const prediction = payload.predictions[0];

    expect(payload.target).toBe("near_miss_within_next_15m");
    expect(payload.prediction_horizon).toBe("15m");
    expect(prediction.assessment.prediction_horizon).toBe("15m");
    expect(prediction.assessment.evidence_authority).toBe("SYNTHETIC_DATA");
  });

  it("keeps high-risk scenarios above stabilized replay outcomes", () => {
    const payload = JSON.parse(readFileSync("models/scenario_predictions.json", "utf8"));
    const byEvent = new Map(payload.predictions.map((item: any) => [item.event_id, item.assessment.safety_incident_risk_score]));

    expect(byEvent.get("pm27-005")).toBeGreaterThan(byEvent.get("ppt-003"));
  });

  it("frames the primary demo as compound telemetry risk instead of a speeding-only alert", () => {
    const payload = JSON.parse(readFileSync("models/scenario_predictions.json", "utf8"));
    const pm27 = payload.predictions.find((item: any) => item.event_id === "pm27-003");

    expect(pm27.features.speeding_ratio_10m).toBeLessThan(0.35);
    expect(pm27.assessment.top_risk_reasons[0]).toMatch(/Rolling telemetry instability/);
    expect(pm27.assessment.top_risk_reasons.join(" ")).not.toMatch(/Speeding occurred/);
  });

  it("provides a loopable live zone telemetry stream", () => {
    const payload = JSON.parse(readFileSync("data/live_zone_telemetry.json", "utf8"));
    const first = payload.samples[0];
    const last = payload.samples.at(-1);

    expect(payload.samples.length).toBeGreaterThanOrEqual(1200);
    expect(first.zones).toHaveLength(4);
    expect(first.zones[0].prime_movers.length).toBeGreaterThan(0);
    expect(Math.abs(first.zones[0].live_risk - last.zones[0].live_risk)).toBeLessThan(0.02);
    expect(new Date(payload.samples[1].timestamp).getTime() - new Date(first.timestamp).getTime()).toBe(1000);
    expect(new Set(first.zones.map((zone: any) => zone.zone_id))).toEqual(
      new Set(["YARD-C4", "PPT-LINK-25", "YARD-U2", "WHARF-C4"])
    );
  });

  it("provides dense one-second telemetry for scenario primary vehicles", () => {
    const payload = JSON.parse(readFileSync("data/scenario_telemetry/pm27-persistent-high-risk.json", "utf8"));
    const pm27 = payload.samples;
    const betweenAnchors = pm27.filter(
      (sample: any) =>
        new Date(sample.timestamp).getTime() > new Date("2026-08-19T09:14:42+08:00").getTime() &&
        new Date(sample.timestamp).getTime() < new Date("2026-08-19T09:15:26+08:00").getTime()
    );

    expect(pm27.length).toBeGreaterThan(200);
    expect(new Date(pm27[1].timestamp).getTime() - new Date(pm27[0].timestamp).getTime()).toBe(1000);
    expect(betweenAnchors.length).toBeGreaterThan(30);
    expect(new Set(betweenAnchors.map((sample: any) => sample.vehicle_id))).toEqual(new Set(["PM-27"]));
    expect(betweenAnchors.some((sample: any) => sample.event_anchor_id === null)).toBe(true);
  });
});
