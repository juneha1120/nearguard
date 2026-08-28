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
    return Response.json(
      { error: `Live inference service failed (${response.status}). Start npm.cmd run model:serve and retry.` },
      { status: 502 }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to reach live inference service.";
    return Response.json(
      { error: `Live inference service is unavailable. Start npm.cmd run model:serve and retry. ${message}` },
      { status: 502 }
    );
  }
}
