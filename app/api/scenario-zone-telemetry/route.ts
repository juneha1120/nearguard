import { listScenarioZoneTelemetrySamples } from "@/lib/data/repository";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const scenarioId = searchParams.get("scenario_id") ?? "";
  return Response.json({ samples: listScenarioZoneTelemetrySamples(scenarioId) });
}
