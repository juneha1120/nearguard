import { listLiveTelemetrySamples } from "@/lib/data/repository";

export async function GET() {
  return Response.json({ samples: listLiveTelemetrySamples() });
}
