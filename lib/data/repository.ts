import scenarioPredictionData from "@/models/scenario_predictions.json";
import scenarioData from "@/data/scenarios.json";
import zoneData from "@/data/zones.json";
import type { Scenario, ScenarioPrediction, ZoneContext } from "@/lib/types/domain";

export const scenarios = scenarioData as Scenario[];
export const zones = zoneData as ZoneContext[];
export const scenarioPredictions = scenarioPredictionData.predictions as ScenarioPrediction[];

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
