import { listLivePredictions, listLiveTelemetrySamples } from "@/lib/data/repository";

export async function GET() {
  return Response.json({ samples: listLiveTelemetrySamples(), predictions: listLivePredictions() });
}
