import { listZones } from "@/lib/data/repository";

export async function GET() {
  return Response.json({ zones: listZones() });
}
