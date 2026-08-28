import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();

const requiredArtifacts = [
  "data/synthetic_training_data.csv",
  "models/nearguard-risk-model.joblib",
  "models/scenario_predictions.json",
  "models/routine_live_predictions.json"
];

const missingOrEmpty = requiredArtifacts.filter((artifact) => {
  const path = join(root, artifact);
  return !existsSync(path) || statSync(path).size === 0;
});

if (missingOrEmpty.length) {
  console.error("NearGuard model artifacts are missing or empty:");
  for (const artifact of missingOrEmpty) {
    console.error(`- ${artifact}`);
  }
  console.error("\nRun `npm.cmd run model:train` before starting the app or model service.");
  process.exit(1);
}

const scenarioPredictions = JSON.parse(readFileSync(join(root, "models/scenario_predictions.json"), "utf8"));
const routinePredictions = JSON.parse(readFileSync(join(root, "models/routine_live_predictions.json"), "utf8"));
const trainingHeader = readFileSync(join(root, "data/synthetic_training_data.csv"), "utf8").split(/\r?\n/, 1)[0] ?? "";

const invalidMessages = [];
for (const [name, payload] of [
  ["models/scenario_predictions.json", scenarioPredictions],
  ["models/routine_live_predictions.json", routinePredictions]
]) {
  if (payload.target !== "near_miss_within_next_15m") {
    invalidMessages.push(`${name} target must be near_miss_within_next_15m.`);
  }
  if (payload.prediction_horizon !== "15m") {
    invalidMessages.push(`${name} prediction_horizon must be 15m.`);
  }
  if (!Array.isArray(payload.predictions) || payload.predictions.length === 0) {
    invalidMessages.push(`${name} must contain predictions.`);
  }
}

if (!trainingHeader.includes("near_miss_within_next_15m")) {
  invalidMessages.push("data/synthetic_training_data.csv must include near_miss_within_next_15m.");
}

if (invalidMessages.length) {
  console.error("NearGuard model artifacts are invalid:");
  for (const message of invalidMessages) {
    console.error(`- ${message}`);
  }
  console.error("\nRun `npm.cmd run model:train` to regenerate them.");
  process.exit(1);
}

console.log("NearGuard model artifacts are present.");
