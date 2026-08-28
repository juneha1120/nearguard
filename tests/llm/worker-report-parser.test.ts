import { afterEach, describe, expect, it } from "vitest";
import { extractWorkerRiskReport, extractWorkerRiskReportWithGemini } from "@/lib/llm/worker-report-parser";
import type { ZoneRegistryEntry } from "@/lib/types/domain";

const zones: ZoneRegistryEntry[] = [
  {
    zone_id: "WHARF-C4",
    zone_name: "Wharf C4 Access",
    zone_historical_risk: 0.78
  }
];

const originalGeminiApiKey = process.env.GEMINI_API_KEY;
const originalGeminiModel = process.env.GEMINI_REPORT_MODEL;

afterEach(() => {
  process.env.GEMINI_API_KEY = originalGeminiApiKey;
  process.env.GEMINI_REPORT_MODEL = originalGeminiModel;
});

function geminiResponse(text: string) {
  return new Response(
    JSON.stringify({
      candidates: [
        {
          content: {
            parts: [{ text }]
          }
        }
      ]
    }),
    { status: 200 }
  );
}

describe("worker report extraction", () => {
  it("calls Gemini and parses the one-line field response", async () => {
    process.env.GEMINI_API_KEY = "gemini-key";
    process.env.GEMINI_REPORT_MODEL = "gemini-test-model";
    const urls: string[] = [];
    const fetchCalls: RequestInit[] = [];
    const fetchImpl = async (url: string | URL | Request, init?: RequestInit) => {
      urls.push(String(url));
      fetchCalls.push(init ?? {});
      return geminiResponse(
        "hazard_type=pedestrian_exposure|zone_id=WHARF-C4|vehicle_id=PM-27|pedestrian_exposure=high|traffic_level=high|weather=rain|restriction_level=wharf|reported_severity=high|operational_note=Frequent crossing near active Prime Mover route|model_feature_impacts=pedestrian_exposure;traffic_level;weather|extraction_confidence=medium"
      );
    };

    const report = await extractWorkerRiskReportWithGemini({
      description: "Workers keep crossing near PM-27 at WHARF-C4 during rain.",
      reporterRole: "daily_safety_report",
      zones,
      fetchImpl: fetchImpl as typeof fetch
    });

    expect(report.extraction_source).toBe("gemini_generate_content");
    expect(report.model).toBe("gemini-test-model");
    expect(report.vehicle_id).toBe("PM-27");
    expect(report.extracted_context.pedestrian_exposure).toBe("high");
    expect(report.extracted_context.model_feature_impacts).toEqual(["pedestrian_exposure", "traffic_level", "weather"]);
    expect(urls[0]).toContain("gemini-test-model:generateContent");
    expect(urls[0]).not.toContain("key=");
    expect(fetchCalls[0].headers).toMatchObject({
      "x-goog-api-key": "gemini-key",
      "Content-Type": "application/json"
    });
    expect(JSON.parse(String(fetchCalls[0].body))).toMatchObject({
      generationConfig: {
        responseMimeType: "text/plain",
        stopSequences: ["\n"],
        candidateCount: 1,
        maxOutputTokens: 220,
        temperature: 0.1
      }
    });
  });

  it("sends known zones and zone-selection instructions to Gemini", async () => {
    process.env.GEMINI_API_KEY = "gemini-key";
    const fetchCalls: RequestInit[] = [];
    const fetchImpl = async (_url: string | URL | Request, init?: RequestInit) => {
      fetchCalls.push(init ?? {});
      return geminiResponse(
        "hazard_type=visibility_issue|zone_id=WHARF-C4|vehicle_id=unknown|pedestrian_exposure=high|traffic_level=unknown|weather=unknown|restriction_level=wharf|reported_severity=medium|operational_note=Visibility around the container stack is poor with workers crossing|model_feature_impacts=pedestrian_exposure;restriction_level|extraction_confidence=high"
      );
    };

    const report = await extractWorkerRiskReportWithGemini({
      description:
        '<div><br class="Apple-interchange-newline">Near the wharf, visibility around the container stack is poor and workers are crossing often. yes</div>',
      reporterRole: "daily_safety_report",
      zones,
      fetchImpl: fetchImpl as typeof fetch
    });
    const requestBody = JSON.parse(String(fetchCalls[0].body));
    const prompt = JSON.parse(requestBody.contents[0].parts[0].text);

    expect(prompt.output_format).toContain("hazard_type=<value>|zone_id=<value>");
    expect(prompt.zone_selection).toContain("Choose zone_id from known_zones only");
    expect(prompt.known_zones).toContainEqual({ zone_id: "WHARF-C4", zone_name: "Wharf C4 Access" });
    expect(prompt.report).not.toContain("<div>");
    expect(report.zone_id).toBe("WHARF-C4");
    expect(report.extracted_context.restriction_level).toBe("wharf");
  });

  it("normalizes Gemini unknown strings to null", async () => {
    process.env.GEMINI_API_KEY = "gemini-key";
    const fetchImpl = async () =>
      geminiResponse(
        "hazard_type=weather_condition|zone_id=WHARF-C4|vehicle_id=unknown|pedestrian_exposure=unknown|traffic_level=unknown|weather=heavy_rain|restriction_level=unknown|reported_severity=medium|operational_note=Heavy rain reported by worker|model_feature_impacts=weather|extraction_confidence=high"
      );

    const report = await extractWorkerRiskReportWithGemini({
      description: "Heavy rain is reducing visibility at WHARF-C4.",
      reporterRole: "worker",
      zones,
      fetchImpl: fetchImpl as typeof fetch
    });

    expect(report.vehicle_id).toBeNull();
    expect(report.extracted_context.pedestrian_exposure).toBeNull();
    expect(report.extracted_context.weather).toBe("heavy_rain");
  });

  it("auto-selects Gemini", async () => {
    process.env.GEMINI_API_KEY = "gemini-key";
    const fetchImpl = async () =>
      geminiResponse(
        "hazard_type=weather_condition|zone_id=WHARF-C4|vehicle_id=unknown|pedestrian_exposure=unknown|traffic_level=unknown|weather=heavy_rain|restriction_level=unknown|reported_severity=medium|operational_note=Heavy rain reported by worker|model_feature_impacts=weather|extraction_confidence=high"
      );

    const report = await extractWorkerRiskReport({
      description: "Heavy rain is reducing visibility at WHARF-C4.",
      reporterRole: "worker",
      zones,
      fetchImpl: fetchImpl as typeof fetch
    });

    expect(report.extraction_source).toBe("gemini_generate_content");
  });

  it("fails before calling the network when GEMINI_API_KEY is missing", async () => {
    delete process.env.GEMINI_API_KEY;
    let called = false;

    await expect(
      extractWorkerRiskReportWithGemini({
        description: "Rain and congestion around Yard C4.",
        reporterRole: "worker",
        zones,
        fetchImpl: (async () => {
          called = true;
          return new Response(null);
        }) as typeof fetch
      })
    ).rejects.toThrow("GEMINI_API_KEY");

    expect(called).toBe(false);
  });
});
