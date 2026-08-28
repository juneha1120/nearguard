import { afterEach, describe, expect, it, vi } from "vitest";
import { GET } from "@/app/api/live-risk-predictions/route";

const originalFetch = global.fetch;
const originalInferenceUrl = process.env.NEARGUARD_INFERENCE_URL;

afterEach(() => {
  global.fetch = originalFetch;
  process.env.NEARGUARD_INFERENCE_URL = originalInferenceUrl;
  vi.restoreAllMocks();
});

describe("live risk prediction API", () => {
  it("requires sample_id", async () => {
    const response = await GET(new Request("http://localhost/api/live-risk-predictions"));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: "sample_id is required" });
  });

  it("returns predictions from the runtime model service", async () => {
    process.env.NEARGUARD_INFERENCE_URL = "http://model-service";
    const fetchMock = vi.fn(async () =>
      Response.json({
        source: "runtime_model_service",
        prediction_horizon: "15m",
        predictions: [{ sample_id: "live-0001", vehicle_id: "PM-27" }]
      })
    );
    global.fetch = fetchMock as typeof fetch;

    const response = await GET(new Request("http://localhost/api/live-risk-predictions?sample_id=live-0001"));

    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledWith("http://model-service/predict/live-sample/live-0001", expect.any(Object));
    await expect(response.json()).resolves.toMatchObject({
      source: "runtime_model_service",
      predictions: [{ sample_id: "live-0001", vehicle_id: "PM-27" }]
    });
  });

  it("returns 502 instead of checked-in predictions when the service is unavailable", async () => {
    global.fetch = vi.fn(async () => {
      throw new Error("connection refused");
    }) as typeof fetch;

    const response = await GET(new Request("http://localhost/api/live-risk-predictions?sample_id=live-0001"));

    expect(response.status).toBe(502);
    const payload = await response.json();
    expect(payload.error).toContain("Live inference service is unavailable");
    expect(payload).not.toHaveProperty("predictions");
  });

  it("returns 502 instead of checked-in predictions when the service rejects the sample", async () => {
    global.fetch = vi.fn(async () => Response.json({ detail: "Unknown sample_id" }, { status: 404 })) as typeof fetch;

    const response = await GET(new Request("http://localhost/api/live-risk-predictions?sample_id=missing"));

    expect(response.status).toBe(502);
    const payload = await response.json();
    expect(payload.error).toContain("Live inference service failed (404)");
    expect(payload).not.toHaveProperty("predictions");
  });
});
