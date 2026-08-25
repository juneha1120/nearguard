import scenarioPredictionData from "@/models/scenario_predictions.json";
import pm27ScenarioDecisionPoints from "@/data/scenario_decision_points/pm27-persistent-high-risk.json";
import pptScenarioDecisionPoints from "@/data/scenario_decision_points/ppt-link-slow-down-zone.json";
import uncertaintyScenarioDecisionPoints from "@/data/scenario_decision_points/telemetry-uncertainty.json";
import wharfScenarioDecisionPoints from "@/data/scenario_decision_points/wharf-pedestrian-exposure.json";
import zoneData from "@/data/zone_registry.json";
import liveTelemetryData from "@/data/routine_live_zone_telemetry.json";
import routinePrimeMoverTelemetryData from "@/data/routine_prime_mover_telemetry.json";
import pm27ScenarioTelemetryData from "@/data/scenario_prime_mover_telemetry/pm27-persistent-high-risk.json";
import pptScenarioTelemetryData from "@/data/scenario_prime_mover_telemetry/ppt-link-slow-down-zone.json";
import uncertaintyScenarioTelemetryData from "@/data/scenario_prime_mover_telemetry/telemetry-uncertainty.json";
import wharfScenarioTelemetryData from "@/data/scenario_prime_mover_telemetry/wharf-pedestrian-exposure.json";
import pm27ScenarioZoneTelemetryData from "@/data/scenario_live_zone_telemetry/pm27-persistent-high-risk.json";
import pptScenarioZoneTelemetryData from "@/data/scenario_live_zone_telemetry/ppt-link-slow-down-zone.json";
import uncertaintyScenarioZoneTelemetryData from "@/data/scenario_live_zone_telemetry/telemetry-uncertainty.json";
import wharfScenarioZoneTelemetryData from "@/data/scenario_live_zone_telemetry/wharf-pedestrian-exposure.json";
import { MAP_METERS_PER_UNIT } from "@/lib/model/live-risk";
import type {
  LiveTelemetrySample,
  LivePrimeMoverSnapshot,
  LiveZoneSnapshot,
  Scenario,
  ScenarioPrediction,
  ScenarioTelemetrySample,
  ScenarioZoneTelemetrySample,
  ZoneRegistryEntry
} from "@/lib/types/domain";

export const scenarios = [
  pm27ScenarioDecisionPoints,
  pptScenarioDecisionPoints,
  wharfScenarioDecisionPoints,
  uncertaintyScenarioDecisionPoints
] as Scenario[];
export const zones = zoneData as ZoneRegistryEntry[];
export const scenarioPredictions = scenarioPredictionData.predictions as ScenarioPrediction[];

type RoutinePrimeMoverSnapshot = LivePrimeMoverSnapshot & { zone_id: string };

interface RoutinePrimeMoverSample {
  sample_id: string;
  timestamp: string;
  prime_movers: RoutinePrimeMoverSnapshot[];
}

function stripRoutineMoverZone({ zone_id: _zoneId, ...mover }: RoutinePrimeMoverSnapshot): LivePrimeMoverSnapshot {
  return mover;
}

function countState(movers: LivePrimeMoverSnapshot[], state: LivePrimeMoverSnapshot["state"]) {
  return movers.filter((mover) => mover.state === state).length;
}

function mergeRoutinePrimeMoverTelemetry(
  zoneSamples: LiveTelemetrySample[],
  primeMoverSamples: RoutinePrimeMoverSample[]
): LiveTelemetrySample[] {
  const primeMoverSampleByTimestamp = new Map(primeMoverSamples.map((sample) => [sample.timestamp, sample]));

  return zoneSamples.map((sample, sampleIndex) => {
    const primeMoverSample = primeMoverSampleByTimestamp.get(sample.timestamp) ?? primeMoverSamples[sampleIndex] ?? null;
    if (!primeMoverSample) return sample;

    return {
      ...sample,
      zones: sample.zones.map((zone): LiveZoneSnapshot => {
        const primeMovers = primeMoverSample.prime_movers.filter((mover) => mover.zone_id === zone.zone_id).map(stripRoutineMoverZone);
        if (!primeMovers.length) {
          return {
            ...zone,
            active_prime_movers: 0,
            avg_speed: 0,
            speed_compliance: 1,
            stale_gps_count: 0,
            delayed_gps_count: 0,
            prime_movers: []
          };
        }

        return {
          ...zone,
          active_prime_movers: primeMovers.length,
          avg_speed: Number((primeMovers.reduce((total, mover) => total + mover.speed, 0) / primeMovers.length).toFixed(1)),
          speed_compliance: Number((primeMovers.filter((mover) => mover.speed <= mover.speed_limit).length / primeMovers.length).toFixed(3)),
          stale_gps_count: primeMovers.filter((mover) => mover.gps_freshness === "stale").length,
          delayed_gps_count: primeMovers.filter((mover) => mover.gps_freshness === "delayed").length,
          harsh_brake_count_5m: countState(primeMovers, "harsh brake"),
          sharp_turn_count_5m: countState(primeMovers, "sharp turn"),
          prime_movers: primeMovers
        };
      })
    };
  });
}

function enrichRoutineMoverPositions(samples: LiveTelemetrySample[]): LiveTelemetrySample[] {
  const zoneById = new Map(zones.map((zone) => [zone.zone_id, zone]));

  return samples.map((sample, sampleIndex) => ({
    ...sample,
    zones: sample.zones.map((zone): LiveZoneSnapshot => {
      const staticZone = zoneById.get(zone.zone_id);
      const bounds = staticZone?.bounds;
      if (!bounds) return zone;

      return {
        ...zone,
        prime_movers: zone.prime_movers.map((mover, moverIndex) => {
          if (mover.position) return mover;
          const direction = moverIndex % 2 === 0 ? 1 : -1;
          const laneOffset = 5 + moverIndex * 7;
          const speedMapUnitsPerSecond = (Math.max(mover.speed, 1) / 3.6) / MAP_METERS_PER_UNIT;
          const travel = (sampleIndex * speedMapUnitsPerSecond + moverIndex * 9) % bounds.width;
          const x = direction === 1 ? bounds.x + travel : bounds.x + bounds.width - travel;

          return {
            ...mover,
            position: {
              x: Number(x.toFixed(1)),
              y: Number((bounds.y + laneOffset).toFixed(1))
            },
            heading_degrees: direction === 1 ? 90 : 270,
            accuracy_m: mover.gps_freshness === "delayed" ? 14 : mover.gps_freshness === "stale" ? 30 : 6
          };
        })
      };
    })
  }));
}

export const liveTelemetrySamples = enrichRoutineMoverPositions(
  mergeRoutinePrimeMoverTelemetry(liveTelemetryData.samples as LiveTelemetrySample[], routinePrimeMoverTelemetryData.samples as RoutinePrimeMoverSample[])
);
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

export function getZone(zoneId: string): ZoneRegistryEntry | null {
  return zones.find((zone) => zone.zone_id === zoneId) ?? null;
}

export function listZones(): ZoneRegistryEntry[] {
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

export function getLatestScenarioZoneTelemetrySample(
  scenarioId: string,
  zoneId: string,
  timestamp: string
): ScenarioZoneTelemetrySample | null {
  const targetTime = new Date(timestamp).getTime();
  if (Number.isNaN(targetTime)) return null;

  const samples = listScenarioZoneTelemetrySamples(scenarioId).filter((sample) => sample.zone_id === zoneId);
  let latest: ScenarioZoneTelemetrySample | null = null;

  for (const sample of samples) {
    const sampleTime = new Date(sample.timestamp).getTime();
    if (Number.isNaN(sampleTime) || sampleTime > targetTime) continue;
    if (!latest || sampleTime > new Date(latest.timestamp).getTime()) {
      latest = sample;
    }
  }

  return latest;
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
