import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const DATA_DIR = new URL("../data/", import.meta.url);
const MAP_METERS_PER_UNIT = 10;

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function writeJson(path, payload) {
  writeFileSync(path, `${JSON.stringify(payload, null, 2)}\n`);
}

const zones = new Map(readJson(new URL("zone_registry.json", DATA_DIR)).map((zone) => [zone.zone_id, zone]));

function routeFor(zoneId) {
  const zone = zones.get(zoneId);
  if (!zone?.bounds) throw new Error(`Missing bounds for ${zoneId}`);
  const b = zone.bounds;

  return [
    { x: b.x + 3, y: b.y + b.height * 0.72 },
    { x: b.x + b.width - 3, y: b.y + b.height * 0.72 },
    { x: b.x + b.width - 3, y: b.y + b.height * 0.32 },
    { x: b.x + 3, y: b.y + b.height * 0.32 }
  ];
}

function segmentLength(a, b) {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

function routeLength(route) {
  return route.reduce((total, point, index) => total + segmentLength(point, route[(index + 1) % route.length]), 0);
}

function pointAt(route, distance) {
  const perimeter = routeLength(route);
  let remaining = ((distance % perimeter) + perimeter) % perimeter;

  for (let index = 0; index < route.length; index += 1) {
    const start = route[index];
    const end = route[(index + 1) % route.length];
    const length = segmentLength(start, end);
    if (remaining <= length) {
      const ratio = length === 0 ? 0 : remaining / length;
      const x = start.x + (end.x - start.x) * ratio;
      const y = start.y + (end.y - start.y) * ratio;
      const heading = Math.atan2(end.x - start.x, -(end.y - start.y)) * (180 / Math.PI);
      return {
        position: { x: Number(x.toFixed(2)), y: Number(y.toFixed(2)) },
        heading_degrees: Math.round((heading + 360) % 360)
      };
    }
    remaining -= length;
  }

  return { position: route[0], heading_degrees: 90 };
}

function motionOffsetFor(scenarioId) {
  const offsets = {
    "pm27-persistent-high-risk": 1.5,
    "ppt-link-slow-down-zone": 4,
    "telemetry-uncertainty": 2,
    "wharf-pedestrian-exposure": 6
  };
  return offsets[scenarioId] ?? 0;
}

function updateScenario(scenarioFile) {
  const telemetryPath = new URL(`scenario_prime_mover_telemetry/${scenarioFile}`, DATA_DIR);
  const scenarioPath = new URL(`scenario_decision_points/${scenarioFile}`, DATA_DIR);
  const telemetry = readJson(telemetryPath);
  const scenario = readJson(scenarioPath);
  if (!telemetry.samples.length) return;

  const route = routeFor(telemetry.samples[0].zone_id);
  let routeDistance = motionOffsetFor(telemetry.samples[0].scenario_id);
  let previousTime = new Date(telemetry.samples[0].timestamp).getTime();
  const byAnchor = new Map();

  telemetry.samples = telemetry.samples.map((sample, index) => {
    const sampleTime = new Date(sample.timestamp).getTime();
    const elapsedSeconds = index === 0 ? 0 : Math.max(0, (sampleTime - previousTime) / 1000);
    previousTime = sampleTime;
    routeDistance += ((Math.max(sample.speed, 1) / 3.6) / MAP_METERS_PER_UNIT) * elapsedSeconds;
    const motion = pointAt(route, routeDistance);
    const nextSample = {
      ...sample,
      position: motion.position,
      heading_degrees: motion.heading_degrees
    };
    if (nextSample.event_anchor_id) byAnchor.set(nextSample.event_anchor_id, nextSample);
    return nextSample;
  });

  scenario.events = scenario.events.map((event) => {
    const anchor = byAnchor.get(event.event_id);
    if (!anchor) return event;
    return {
      ...event,
      position: anchor.position,
      heading_degrees: anchor.heading_degrees,
      accuracy_m: anchor.accuracy_m
    };
  });

  writeJson(telemetryPath, telemetry);
  writeJson(scenarioPath, scenario);
}

for (const file of readdirSync(new URL("scenario_prime_mover_telemetry/", DATA_DIR))) {
  if (file.endsWith(".json")) updateScenario(file);
}

console.log("Regenerated scenario PM motion fixtures.");
