import scenarioPredictionData from "@/models/scenario_predictions.json";
import scenarioData from "@/data/scenarios.json";
import zoneData from "@/data/zones.json";
import liveTelemetryData from "@/data/live_zone_telemetry.json";
import pm27ScenarioTelemetryData from "@/data/scenario_telemetry/pm27-persistent-high-risk.json";
import pptScenarioTelemetryData from "@/data/scenario_telemetry/ppt-link-slow-down-zone.json";
import uncertaintyScenarioTelemetryData from "@/data/scenario_telemetry/telemetry-uncertainty.json";
import wharfScenarioTelemetryData from "@/data/scenario_telemetry/wharf-pedestrian-exposure.json";
import pm27ScenarioZoneTelemetryData from "@/data/scenario_zone_telemetry/pm27-persistent-high-risk.json";
import pptScenarioZoneTelemetryData from "@/data/scenario_zone_telemetry/ppt-link-slow-down-zone.json";
import uncertaintyScenarioZoneTelemetryData from "@/data/scenario_zone_telemetry/telemetry-uncertainty.json";
import wharfScenarioZoneTelemetryData from "@/data/scenario_zone_telemetry/wharf-pedestrian-exposure.json";
import type {
  LiveTelemetrySample,
  Scenario,
  ScenarioPrediction,
  ScenarioTelemetrySample,
  ScenarioZoneTelemetrySample,
  ZoneContext
} from "@/lib/types/domain";

export const scenarios = scenarioData as Scenario[];
export const zones = zoneData as ZoneContext[];
export const scenarioPredictions = scenarioPredictionData.predictions as ScenarioPrediction[];
export const liveTelemetrySamples = liveTelemetryData.samples as LiveTelemetrySample[];
export const scenarioTelemetrySamplesByScenario: Record<string, ScenarioTelemetrySample[]> = {
  "pm27-persistent-high-risk": pm27ScenarioTelemetryData.samples as ScenarioTelemetrySample[],
  "ppt-link-slow-down-zone": pptScenarioTelemetryData.samples as ScenarioTelemetrySample[],
  "telemetry-uncertainty": uncertaintyScenarioTelemetryData.samples as ScenarioTelemetrySample[],
  "wharf-pedestrian-exposure": wharfScenarioTelemetryData.samples as ScenarioTelemetrySample[]
};
export const scenarioZoneTelemetrySamplesByScenario: Record<string, ScenarioZoneTelemetrySample[]> = {
  "pm27-persistent-high-risk": pm27ScenarioZoneTelemetryData.samples as ScenarioZoneTelemetrySample[],
  "ppt-link-slow-down-zone": pptScenarioZoneTelemetryData.samples as ScenarioZoneTelemetrySample[],
  "telemetry-uncertainty": uncertaintyScenarioZoneTelemetryData.samples as ScenarioZoneTelemetrySample[],
  "wharf-pedestrian-exposure": wharfScenarioZoneTelemetryData.samples as ScenarioZoneTelemetrySample[]
};

export function getScenario(scenarioId?: string): Scenario {
  if (!scenarioId) {
    return scenarios[0];
  }
  return scenarios.find((scenario) => scenario.scenario_id === scenarioId) ?? scenarios[0];
}

export function getZone(zoneId: string): ZoneContext | null {
  return zones.find((zone) => zone.zone_id === zoneId) ?? null;
}

export function listZones(): ZoneContext[] {
  return zones;
}

export function listLiveTelemetrySamples(): LiveTelemetrySample[] {
  return liveTelemetrySamples;
}

export function listScenarioTelemetrySamples(scenarioId: string): ScenarioTelemetrySample[] {
  return scenarioTelemetrySamplesByScenario[scenarioId] ?? [];
}

export function listScenarioZoneTelemetrySamples(scenarioId: string): ScenarioZoneTelemetrySample[] {
  return scenarioZoneTelemetrySamplesByScenario[scenarioId] ?? [];
}

export function getScenarioPrediction(scenarioId: string, eventId: string): ScenarioPrediction | null {
  return (
    scenarioPredictions.find(
      (prediction) => prediction.scenario_id === scenarioId && prediction.event_id === eventId
    ) ?? null
  );
}

export function listScenarioMetadata() {
  return scenarios.map(({ scenario_id, name, description, primary_vehicle_id, highlights }) => ({
    scenario_id,
    name,
    description,
    primary_vehicle_id,
    highlights
  }));
}
