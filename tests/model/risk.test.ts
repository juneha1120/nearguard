import { describe, expect, it } from "vitest";
import { riskBandFor } from "@/lib/model/risk";

describe("risk band mapping", () => {
  it("maps score thresholds to prototype risk bands", () => {
    expect(riskBandFor(0.39, "high")).toBe("Low");
    expect(riskBandFor(0.4, "high")).toBe("Medium");
    expect(riskBandFor(0.65, "high")).toBe("High");
    expect(riskBandFor(0.85, "high")).toBe("Critical");
  });

  it("keeps persistent-risk handling outside the risk band label", () => {
    expect(riskBandFor(0.79, "high", true)).toBe("High");
  });

  it("keeps low-confidence escalation outside the risk band label", () => {
    expect(riskBandFor(0.67, "low")).toBe("High");
  });
});
