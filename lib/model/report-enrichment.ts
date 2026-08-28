import type { LiveTelemetrySample, LiveZoneSnapshot, WorkerRiskReport } from "@/lib/types/domain";

export interface WorkerReportInfluencedFeature {
  field: "traffic_pressure" | "weather" | "restriction_level" | "pedestrian_exposure";
  label: string;
  before: string;
  after: string;
}

const trafficPressureByLevel = {
  low: 0.25,
  medium: 0.55,
  high: 0.85
} as const;

const severityPressureFloor = {
  low: 0,
  medium: 0.55,
  high: 0.75
} as const;

const weatherRank = {
  clear: 0,
  rain: 1,
  heavy_rain: 2
} as const;

const restrictionRank = {
  normal: 0,
  caution: 1,
  restricted: 2,
  wharf: 3
} as const;

const pedestrianExposureRank = {
  low: 0,
  medium: 1,
  high: 2
} as const;

function higherRiskValue<T extends string>(current: T, reported: T | null, rank: Record<T, number>) {
  if (!reported) return current;
  return rank[reported] > rank[current] ? reported : current;
}

function enrichZoneWithReport(zone: LiveZoneSnapshot, report: WorkerRiskReport): LiveZoneSnapshot {
  const context = report.extracted_context;
  const trafficPressureFromReport = context.traffic_level ? trafficPressureByLevel[context.traffic_level] : 0;
  const severityPressure = severityPressureFloor[context.reported_severity];

  return {
    ...zone,
    traffic_pressure: Math.max(zone.traffic_pressure, trafficPressureFromReport, severityPressure),
    weather: higherRiskValue(zone.weather, context.weather, weatherRank),
    restriction_level: higherRiskValue(zone.restriction_level, context.restriction_level, restrictionRank),
    pedestrian_exposure: higherRiskValue(zone.pedestrian_exposure, context.pedestrian_exposure, pedestrianExposureRank)
  };
}

export function workerReportApplicationState(sample: LiveTelemetrySample | null, report: WorkerRiskReport | null) {
  if (!report) return "empty" as const;
  if (report.extraction_confidence === "low") return "held_for_review" as const;
  if (!report.zone_id) return "missing_zone" as const;
  const baselineZone = sample?.zones.find((zone) => zone.zone_id === report.zone_id);
  if (!baselineZone) return "zone_not_in_view" as const;
  if (!describeWorkerReportInfluenceForZone(baselineZone, report).length) return "no_model_change" as const;
  return "applied" as const;
}

export function applyWorkerReportToLiveSample(sample: LiveTelemetrySample | null, report: WorkerRiskReport | null): LiveTelemetrySample | null {
  if (workerReportApplicationState(sample, report) !== "applied") return sample;
  if (!sample || !report) return sample;

  let didApply = false;
  const zones = sample.zones.map((zone) => {
    if (zone.zone_id !== report.zone_id) return zone;
    didApply = true;
    return enrichZoneWithReport(zone, report);
  });

  return didApply ? { ...sample, zones } : sample;
}

export function describeWorkerReportInfluence(
  sample: LiveTelemetrySample | null,
  report: WorkerRiskReport | null
): WorkerReportInfluencedFeature[] {
  if (workerReportApplicationState(sample, report) !== "applied") return [];
  if (!sample || !report?.zone_id) return [];

  const baselineZone = sample.zones.find((zone) => zone.zone_id === report.zone_id);
  if (!baselineZone) return [];

  return describeWorkerReportInfluenceForZone(baselineZone, report);
}

function describeWorkerReportInfluenceForZone(baselineZone: LiveZoneSnapshot, report: WorkerRiskReport): WorkerReportInfluencedFeature[] {
  const enrichedZone = enrichZoneWithReport(baselineZone, report);
  const fields: WorkerReportInfluencedFeature[] = [];

  if (baselineZone.traffic_pressure !== enrichedZone.traffic_pressure) {
    fields.push({
      field: "traffic_pressure",
      label: "Traffic pressure",
      before: baselineZone.traffic_pressure.toFixed(2),
      after: enrichedZone.traffic_pressure.toFixed(2)
    });
  }

  if (baselineZone.pedestrian_exposure !== enrichedZone.pedestrian_exposure) {
    fields.push({
      field: "pedestrian_exposure",
      label: "Pedestrian exposure",
      before: baselineZone.pedestrian_exposure,
      after: enrichedZone.pedestrian_exposure
    });
  }

  if (baselineZone.weather !== enrichedZone.weather) {
    fields.push({
      field: "weather",
      label: "Weather",
      before: baselineZone.weather.replace("_", " "),
      after: enrichedZone.weather.replace("_", " ")
    });
  }

  if (baselineZone.restriction_level !== enrichedZone.restriction_level) {
    fields.push({
      field: "restriction_level",
      label: "Restriction",
      before: baselineZone.restriction_level,
      after: enrichedZone.restriction_level
    });
  }

  return fields;
}
