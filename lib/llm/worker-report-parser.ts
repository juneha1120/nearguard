import type { WorkerReportExtractedContext, WorkerRiskReport, ZoneRegistryEntry } from "@/lib/types/domain";

const GEMINI_API_URL = "https://generativelanguage.googleapis.com/v1beta/models";
const DEFAULT_GEMINI_REPORT_MODEL = "gemini-3.1-flash-lite";
const DEFAULT_REPORT_TIMEOUT_MS = 30000;

interface ReportExtraction {
  extracted_context: WorkerReportExtractedContext;
  extraction_confidence: WorkerRiskReport["extraction_confidence"];
}

type FlatReportExtraction = Omit<WorkerReportExtractedContext, "zone_id" | "vehicle_id"> & {
  zone_id: string | null;
  vehicle_id: string | null;
  extraction_confidence: WorkerRiskReport["extraction_confidence"];
};

function nullIfUnknown(value: unknown) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed && trimmed.toLowerCase() !== "unknown" ? trimmed : null;
}

function plainText(value: string) {
  return value
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isVagueSafetyReport(description: string, context: WorkerReportExtractedContext) {
  const text = plainText(description).toLowerCase();
  const words = text.split(/\s+/).filter(Boolean);
  const vagueUnsafePhrase = /\b(something|thing|things|stuff|issue)\b.*\bunsafe\b|\bunsafe\b.*\b(something|thing|things|stuff|issue)\b/.test(text);

  return words.length < 8 || (context.hazard_type === "other" && context.model_feature_impacts.length === 0 && vagueUnsafePhrase);
}

function nestedExtraction(value: unknown): ReportExtraction {
  if (typeof value !== "object" || value === null) {
    throw new Error("Report extraction is not an object.");
  }
  if ("extracted_context" in value) return value as ReportExtraction;

  const flat = value as Partial<FlatReportExtraction>;
  return {
    extracted_context: {
      hazard_type: flat.hazard_type ?? "other",
      zone_id: flat.zone_id ?? null,
      vehicle_id: flat.vehicle_id ?? null,
      pedestrian_exposure: flat.pedestrian_exposure ?? null,
      traffic_level: flat.traffic_level ?? null,
      weather: flat.weather ?? null,
      restriction_level: flat.restriction_level ?? null,
      reported_severity: flat.reported_severity ?? "medium",
      operational_note: flat.operational_note ?? "",
      model_feature_impacts: flat.model_feature_impacts ?? []
    },
    extraction_confidence: flat.extraction_confidence ?? "medium"
  };
}

function normalizeExtraction(extraction: ReportExtraction, description: string): ReportExtraction {
  const context = extraction.extracted_context;
  const normalizedContext = {
    ...context,
    zone_id: nullIfUnknown(context.zone_id),
    vehicle_id: nullIfUnknown(context.vehicle_id),
    pedestrian_exposure: nullIfUnknown(context.pedestrian_exposure) as WorkerReportExtractedContext["pedestrian_exposure"],
    traffic_level: nullIfUnknown(context.traffic_level) as WorkerReportExtractedContext["traffic_level"],
    weather: nullIfUnknown(context.weather) as WorkerReportExtractedContext["weather"],
    restriction_level: nullIfUnknown(context.restriction_level) as WorkerReportExtractedContext["restriction_level"],
    operational_note: String(context.operational_note ?? "").slice(0, 180),
    model_feature_impacts: Array.isArray(context.model_feature_impacts) ? context.model_feature_impacts.slice(0, 4).map(String) : []
  };

  return {
    extracted_context: normalizedContext,
    extraction_confidence: isVagueSafetyReport(description, normalizedContext) ? "low" : extraction.extraction_confidence
  };
}

function reportTimeoutMs() {
  const parsed = Number(process.env.LLM_REQUEST_TIMEOUT_MS);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_REPORT_TIMEOUT_MS;
  return parsed;
}

function parseDelimitedExtraction(text: string): ReportExtraction {
  const cleaned = plainText(text);
  const line = cleaned
    .split(/\r?\n/)
    .map((item) => item.trim())
    .find((item) => item.includes("hazard_type=") && item.includes("extraction_confidence="));

  if (!line) {
    throw new Error("Gemini did not return the expected report context field line.");
  }

  const fields = new Map<string, string>();
  for (const segment of line.split("|")) {
    const separatorIndex = segment.indexOf("=");
    if (separatorIndex <= 0) continue;
    fields.set(segment.slice(0, separatorIndex).trim(), segment.slice(separatorIndex + 1).trim());
  }

  const impacts = (fields.get("model_feature_impacts") ?? "")
    .split(";")
    .map((item) => item.trim())
    .filter(Boolean);

  return nestedExtraction({
    hazard_type: fields.get("hazard_type") ?? "other",
    zone_id: fields.get("zone_id") ?? "unknown",
    vehicle_id: fields.get("vehicle_id") ?? "unknown",
    pedestrian_exposure: fields.get("pedestrian_exposure") ?? "unknown",
    traffic_level: fields.get("traffic_level") ?? "unknown",
    weather: fields.get("weather") ?? "unknown",
    restriction_level: fields.get("restriction_level") ?? "unknown",
    reported_severity: fields.get("reported_severity") ?? "medium",
    operational_note: fields.get("operational_note") ?? "",
    model_feature_impacts: impacts,
    extraction_confidence: fields.get("extraction_confidence") ?? "medium"
  });
}

function buildReportPrompt(description: string, reporterRole: string, zones: ZoneRegistryEntry[]) {
  return JSON.stringify({
    task:
      "Extract structured safety context from a worker daily safety report for NearGuard. Do not decide safety policy, approve actions, or directly set a risk score.",
    output_format:
      "Return exactly one line using this format and no extra text: hazard_type=<value>|zone_id=<value>|vehicle_id=<value>|pedestrian_exposure=<value>|traffic_level=<value>|weather=<value>|restriction_level=<value>|reported_severity=<value>|operational_note=<value>|model_feature_impacts=<field;field>|extraction_confidence=<value>",
    zone_selection:
      "Choose zone_id from known_zones only. If the report says wharf, choose the known zone whose name or id contains wharf. If it says yard or terminal link, match the closest known zone name/id. Use unknown only when no known zone is supported by the report.",
    unknown_values:
      "For unavailable fields use the literal string unknown, except reported_severity and extraction_confidence which must be low, medium, or high.",
    confidence_policy:
      "Use low extraction_confidence for vague reports with no specific hazard, vehicle, condition, or actionable model feature. Do not infer high confidence from generic phrases such as something looks unsafe.",
    allowed_values:
      "hazard_type: visibility_issue, pedestrian_exposure, speeding_pattern, weather_condition, traffic_congestion, gps_quality, route_obstruction, unsafe_manoeuvre, other. exposure/traffic/severity/confidence: low, medium, high. weather: clear, rain, heavy_rain, unknown. restriction_level: normal, caution, restricted, wharf, unknown.",
    report: plainText(description),
    reporter_role: reporterRole,
    known_zones: zones.map(({ zone_id, zone_name }) => ({ zone_id, zone_name }))
  });
}

function buildWorkerRiskReport({
  description,
  reporterRole,
  extraction,
  model
}: {
  description: string;
  reporterRole: string;
  extraction: ReportExtraction;
  model: string;
}): WorkerRiskReport {
  return {
    report_id: `report-${Date.now()}`,
    timestamp: new Date().toISOString(),
    reporter_role: reporterRole,
    zone_id: extraction.extracted_context.zone_id,
    vehicle_id: extraction.extracted_context.vehicle_id,
    description,
    extracted_context: extraction.extracted_context,
    extraction_confidence: extraction.extraction_confidence,
    extraction_source: "gemini_generate_content",
    model
  };
}

function geminiText(payload: unknown) {
  if (typeof payload !== "object" || payload === null) return "";
  const candidates = (payload as { candidates?: unknown }).candidates;
  if (!Array.isArray(candidates)) return "";

  return candidates
    .flatMap((candidate) => {
      if (typeof candidate !== "object" || candidate === null) return [];
      const content = (candidate as { content?: unknown }).content;
      if (typeof content !== "object" || content === null) return [];
      const parts = (content as { parts?: unknown }).parts;
      return Array.isArray(parts) ? parts : [];
    })
    .map((part) => {
      if (typeof part !== "object" || part === null) return "";
      const text = (part as { text?: unknown }).text;
      return typeof text === "string" ? text : "";
    })
    .join("");
}

export async function extractWorkerRiskReportWithGemini({
  description,
  reporterRole,
  zones,
  fetchImpl = fetch
}: {
  description: string;
  reporterRole: string;
  zones: ZoneRegistryEntry[];
  fetchImpl?: typeof fetch;
}): Promise<WorkerRiskReport> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY is not configured.");
  }

  const model = process.env.GEMINI_REPORT_MODEL ?? DEFAULT_GEMINI_REPORT_MODEL;
  const timeoutMs = reportTimeoutMs();
  const response = await fetchImpl(`${GEMINI_API_URL}/${encodeURIComponent(model)}:generateContent`, {
    method: "POST",
    headers: {
      "x-goog-api-key": apiKey,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      contents: [
        {
          role: "user",
          parts: [{ text: buildReportPrompt(description, reporterRole, zones) }]
        }
      ],
      generationConfig: {
        responseMimeType: "text/plain",
        stopSequences: ["\n"],
        candidateCount: 1,
        maxOutputTokens: 220,
        temperature: 0.1
      }
    }),
    cache: "no-store",
    signal: AbortSignal.timeout(timeoutMs)
  }).catch((error) => {
    if (error instanceof Error && error.name === "TimeoutError") {
      throw new Error(`Gemini report extraction timed out after ${Math.round(timeoutMs / 1000)}s. Try a Flash model or increase LLM_REQUEST_TIMEOUT_MS.`);
    }
    throw error;
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Gemini report extraction failed (${response.status}): ${errorText.slice(0, 240)}`);
  }

  const payload = await response.json();
  const text = geminiText(payload);
  if (!text) {
    const candidates = typeof payload === "object" && payload !== null ? (payload as { candidates?: unknown }).candidates : null;
    const finishReason =
      Array.isArray(candidates) && typeof candidates[0] === "object" && candidates[0] !== null
        ? (candidates[0] as { finishReason?: unknown }).finishReason
        : null;
    throw new Error(
      `Gemini report extraction returned no text output${typeof finishReason === "string" ? ` (finishReason: ${finishReason})` : ""}.`
    );
  }

  const extraction = normalizeExtraction(parseDelimitedExtraction(text), description);

  return buildWorkerRiskReport({
    description,
    reporterRole,
    extraction,
    model
  });
}

export async function extractWorkerRiskReport({
  description,
  reporterRole,
  zones,
  fetchImpl = fetch
}: {
  description: string;
  reporterRole: string;
  zones: ZoneRegistryEntry[];
  fetchImpl?: typeof fetch;
}): Promise<WorkerRiskReport> {
  return extractWorkerRiskReportWithGemini({ description, reporterRole, zones, fetchImpl });
}
