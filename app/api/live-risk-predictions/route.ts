import { listLivePredictions } from "@/lib/data/repository";

const DEFAULT_INFERENCE_URL = "http://127.0.0.1:8001";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const sampleId = searchParams.get("sample_id");

  if (!sampleId) {
    return Response.json({ error: "sample_id is required" }, { status: 400 });
  }

  const inferenceUrl = process.env.NEARGUARD_INFERENCE_URL ?? DEFAULT_INFERENCE_URL;

  try {
    const response = await fetch(`${inferenceUrl}/predict/live-sample/${encodeURIComponent(sampleId)}`, {
      cache: "no-store",
      signal: AbortSignal.timeout(1500)
    });

    if (response.ok) {
      return Response.json(await response.json());
    }
  } catch {
    // Demo fallback: keep the dashboard live if the optional Python service is not running.
  }

  return Response.json({
    source: "exported_prediction_fallback",
    predictions: listLivePredictions().filter((prediction) => prediction.sample_id === sampleId)
  });
}
