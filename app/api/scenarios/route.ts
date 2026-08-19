import { listScenarioMetadata } from "@/lib/data/repository";

export async function GET() {
  return Response.json({ scenarios: listScenarioMetadata() });
}
