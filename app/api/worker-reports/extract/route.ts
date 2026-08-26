import { listZones } from "@/lib/data/repository";
import { extractWorkerRiskReport } from "@/lib/llm/worker-report-parser";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as { description?: unknown; reporter_role?: unknown } | null;
  const description = typeof body?.description === "string" ? body.description.trim() : "";
  const reporterRole = typeof body?.reporter_role === "string" && body.reporter_role.trim() ? body.reporter_role.trim() : "worker";

  if (!description) {
    return Response.json({ error: "description is required" }, { status: 400 });
  }

  try {
    const report = await extractWorkerRiskReport({
      description,
      reporterRole,
      zones: listZones()
    });

    return Response.json({ report });
  } catch (error) {
    return Response.json(
      {
        error: error instanceof Error ? error.message : "Worker report extraction failed."
      },
      { status: 502 }
    );
  }
}
