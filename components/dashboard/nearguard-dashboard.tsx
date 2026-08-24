"use client";

import {
  Activity,
  AlertTriangle,
  Bell,
  CheckCircle2,
  ClipboardCheck,
  Clock3,
  FastForward,
  Gauge,
  Layers,
  Pause,
  Play,
  Radio,
  RefreshCw,
  ShieldAlert,
  StepForward,
  Users
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type {
  ApprovalRequest,
  EventType,
  LivePrimeMoverSnapshot,
  LiveTelemetrySample,
  LiveZoneSnapshot,
  ReplayState,
  RiskAssessment,
  RiskBand,
  ToolCall,
  TraceEvent,
  VehicleCase,
  VehicleEvent,
  ZoneContext
} from "@/lib/types/domain";

type ScenarioMetadata = {
  scenario_id: string;
  name: string;
  description: string;
  primary_vehicle_id: string;
  highlights: string[];
};

type ZoneRiskCard = {
  zone: ZoneContext;
  level: "Low" | "Medium" | "High";
  className: "low" | "medium" | "high";
  flags: string[];
  live: LiveZoneSnapshot | null;
};

const ABNORMAL_EVENTS: EventType[] = ["speeding", "harsh_brake", "sharp_turn", "stale_gps", "risk_persistent"];
const PLAY_WARMUP_TICKS = 3;

function bandClass(band?: RiskBand) {
  if (!band) return "neutral";
  if (band === "Low") return "low";
  if (band === "Medium") return "medium";
  if (band === "Persistent High") return "persistent";
  if (band === "Critical / Low Confidence") return "critical";
  return "high";
}

function timeLabel(timestamp?: string | null) {
  if (!timestamp) return "--:--";
  return new Intl.DateTimeFormat("en-SG", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    timeZone: "Asia/Singapore",
    hour12: false
  }).format(new Date(timestamp));
}

function eventSeverityClass(event: VehicleEvent) {
  if (event.event_type === "risk_persistent") return "persistent";
  if (event.event_type === "stale_gps") return "uncertain";
  if (event.event_type === "speed_normalized") return "resolved";
  if (ABNORMAL_EVENTS.includes(event.event_type)) return "abnormal";
  return "normal";
}

function formatEventLabel(eventType?: EventType) {
  if (!eventType) return "monitoring";
  return eventType.replaceAll("_", " ");
}

function baselineZoneRiskLevel(score: number): ZoneRiskCard["level"] {
  if (score < 0.45) return "Low";
  if (score < 0.7) return "Medium";
  return "High";
}

function liveRiskLevel(score: number): ZoneRiskCard["level"] {
  if (score < 0.45) return "Low";
  if (score < 0.68) return "Medium";
  return "High";
}

function riskPercent(score?: number | null) {
  return `${Math.round((score ?? 0) * 100)}%`;
}

function riskScoreFromEvent(event: VehicleEvent) {
  const overLimit = Math.max(0, event.speed - event.speed_limit);
  const eventBoost: Record<EventType, number> = {
    normal_update: 0.2,
    speed_normalized: 0.18,
    speeding: 0.58,
    harsh_brake: 0.68,
    sharp_turn: 0.6,
    stale_gps: 0.62,
    risk_persistent: 0.78
  };
  const gpsBoost = event.gps_freshness === "stale" ? 0.16 : event.gps_freshness === "delayed" ? 0.08 : 0;
  return Math.min(0.96, eventBoost[event.event_type] + overLimit * 0.035 + gpsBoost);
}

function liveStateFromEvent(event: VehicleEvent): LivePrimeMoverSnapshot["state"] {
  if (event.event_type === "speeding") return "speeding";
  if (event.event_type === "harsh_brake") return "harsh brake";
  if (event.event_type === "sharp_turn") return "sharp turn";
  if (event.event_type === "stale_gps") return "stale GPS";
  if (event.event_type === "speed_normalized") return "recovering";
  return event.speed > event.speed_limit * 0.9 ? "watching" : "normal";
}

function eventCounts(events: VehicleEvent[], zoneId: string, currentTime: number) {
  const fiveMinutes = 5 * 60 * 1000;
  const recent = events.filter((event) => {
    const eventTime = new Date(event.timestamp).getTime();
    return event.zone_id === zoneId && eventTime <= currentTime && currentTime - eventTime <= fiveMinutes;
  });
  return {
    harshBrake: recent.filter((event) => event.event_type === "harsh_brake").length,
    sharpTurn: recent.filter((event) => event.event_type === "sharp_turn").length
  };
}

function buildScenarioLiveSample(
  baseSample: LiveTelemetrySample | null,
  selectedScenario: ReplayState["selectedScenario"] | null,
  currentEventIndex: number,
  zones: ZoneContext[]
): LiveTelemetrySample | null {
  if (!baseSample || !selectedScenario?.events.length) return baseSample;

  const eventCursor = Math.max(0, Math.min(currentEventIndex - 1, selectedScenario.events.length - 1));
  const activeEvent = selectedScenario.events[eventCursor] ?? selectedScenario.events[0];
  const scenarioEventsToDate = selectedScenario.events.slice(0, eventCursor + 1);
  const activeTime = new Date(activeEvent.timestamp).getTime();
  const eventRisk = riskScoreFromEvent(activeEvent);
  const baseZones = baseSample.zones.map((zone) => ({
    ...zone,
    prime_movers: zone.prime_movers.filter((mover) => mover.vehicle_id !== selectedScenario.primary_vehicle_id)
  }));

  const zoneSnapshots = baseZones.map((zone) => {
    if (zone.zone_id !== activeEvent.zone_id) return zone;

    const zoneContext = zones.find((item) => item.zone_id === activeEvent.zone_id);
    const scenarioMover: LivePrimeMoverSnapshot = {
      vehicle_id: activeEvent.vehicle_id,
      speed: activeEvent.speed,
      speed_limit: activeEvent.speed_limit,
      gps_freshness: activeEvent.gps_freshness,
      state: liveStateFromEvent(activeEvent),
      rolling_risk_contribution: Number(eventRisk.toFixed(2))
    };
    const primeMovers = [scenarioMover, ...zone.prime_movers].slice(0, 4);
    const complianceCount = primeMovers.filter((mover) => mover.speed <= mover.speed_limit).length;
    const counts = eventCounts(scenarioEventsToDate, activeEvent.zone_id, activeTime);

    return {
      ...zone,
      updated_at: baseSample.timestamp,
      live_risk: Number(Math.max(zone.live_risk, eventRisk, zoneContext?.zone_historical_risk ?? 0).toFixed(3)),
      active_prime_movers: primeMovers.length,
      avg_speed: Number((primeMovers.reduce((total, mover) => total + mover.speed, 0) / primeMovers.length).toFixed(1)),
      speed_compliance: Number((complianceCount / primeMovers.length).toFixed(2)),
      stale_gps_count: primeMovers.filter((mover) => mover.gps_freshness === "stale").length,
      delayed_gps_count: primeMovers.filter((mover) => mover.gps_freshness === "delayed").length,
      harsh_brake_count_5m: Math.max(zone.harsh_brake_count_5m, counts.harshBrake),
      sharp_turn_count_5m: Math.max(zone.sharp_turn_count_5m, counts.sharpTurn),
      traffic_pressure: Number(Math.max(zone.traffic_pressure, eventRisk - 0.08).toFixed(2)),
      weather: zoneContext?.weather ?? zone.weather,
      restriction_level: zoneContext?.restriction_level ?? zone.restriction_level,
      pedestrian_exposure: zoneContext?.pedestrian_exposure ?? zone.pedestrian_exposure,
      slow_down_zone_active: zoneContext?.slow_down_zone_active ?? zone.slow_down_zone_active,
      prime_movers: primeMovers
    };
  });

  return {
    sample_id: `${baseSample.sample_id}-${selectedScenario.scenario_id}-${activeEvent.event_id}`,
    timestamp: baseSample.timestamp,
    zones: zoneSnapshots
  };
}

function zoneRiskClass(level: ZoneRiskCard["level"]): ZoneRiskCard["className"] {
  if (level === "Low") return "low";
  if (level === "Medium") return "medium";
  return "high";
}

function zoneFlags(zone: ZoneContext) {
  const flags: string[] = [];
  if (zone.slow_down_zone_active) flags.push("25km/h slow-down");
  if (zone.restriction_level === "restricted") flags.push("restricted");
  if (zone.restriction_level === "wharf") flags.push("wharf access");
  if (zone.pedestrian_exposure === "high") flags.push("pedestrian high");
  if (zone.traffic_level === "high") flags.push("traffic high");
  if (zone.weather !== "clear") flags.push(zone.weather.replace("_", " "));
  return flags;
}

function explainAction(
  selectedCase: VehicleCase | null,
  assessment: RiskAssessment | null,
  pendingApproval: ApprovalRequest | null
) {
  if (!selectedCase || !assessment) {
    return {
      title: "Awaiting telemetry",
      summary: "No risk action is active. The dashboard is showing baseline zone context until replay evidence arrives.",
      rationale: ["Replay has not produced a risk assessment yet."],
      statusClass: "neutral"
    };
  }

  const leadReason = assessment.top_risk_reasons[0] ?? "Risk evidence crossed the policy threshold.";
  const actionPrefix = pendingApproval ? "Approval required" : selectedCase.authority_class;
  return {
    title: selectedCase.recommended_action,
    summary: `${actionPrefix}: ${leadReason}`,
    rationale: [
      `${assessment.risk_band} risk at ${assessment.safety_incident_risk_score.toFixed(2)} with ${assessment.confidence} confidence.`,
      ...assessment.top_risk_reasons.slice(0, 3)
    ],
    statusClass: bandClass(assessment.risk_band)
  };
}

function toolRationale(tool: ToolCall, assessment: RiskAssessment | null) {
  const reason = assessment?.top_risk_reasons[0] ?? "Current policy response required operational follow-up.";
  if (tool.tool_name === "notify_driver") return `Driver advisory was triggered by ${assessment?.risk_band ?? "elevated"} risk: ${reason}`;
  if (tool.tool_name === "notify_supervisor") return `Supervisor notification was triggered because policy requires awareness for ${assessment?.risk_band ?? "high"} risk.`;
  if (tool.tool_name === "fallback_notify_supervisor") return "Fallback notification was sent because the primary supervisor notification timed out.";
  if (tool.tool_name === "request_human_approval") return "Human approval was requested because the policy does not allow stronger zone intervention automatically.";
  if (tool.tool_name === "recommend_zone_advisory") return "Zone advisory was recorded after human approval.";
  return `Tool was called as part of the ${assessment?.risk_band ?? "current"} policy response.`;
}

function buildInterventionEvidenceTimeline(
  traceEvents: TraceEvent[],
  assessment: RiskAssessment | null,
  currentEvent: VehicleEvent | null
) {
  if (!assessment || !currentEvent) return [];
  const relevantTypes = new Set([
    "event_received",
    "context_enriched",
    "context_missing",
    "features_derived",
    "risk_assessed",
    "policy_decision",
    "tool_call",
    "tool_failure",
    "approval_requested"
  ]);
  return traceEvents.filter((trace) => relevantTypes.has(trace.event_type)).slice(-8);
}

export function NearGuardDashboard() {
  const [scenarios, setScenarios] = useState<ScenarioMetadata[]>([]);
  const [zones, setZones] = useState<ZoneContext[]>([]);
  const [liveSamples, setLiveSamples] = useState<LiveTelemetrySample[]>([]);
  const [liveSampleIndex, setLiveSampleIndex] = useState(0);
  const [warmupRemaining, setWarmupRemaining] = useState(0);
  const [scenarioId, setScenarioId] = useState("pm27-persistent-high-risk");
  const [state, setState] = useState<ReplayState | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const timerRef = useRef<number | null>(null);
  const liveTimerRef = useRef<number | null>(null);

  async function start(id = scenarioId) {
    const response = await fetch("/api/replay/start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ scenario_id: id })
    });
    setState(await response.json());
    setIsPlaying(false);
    setWarmupRemaining(0);
  }

  async function step() {
    const response = await fetch("/api/replay/step", { method: "POST" });
    const nextState = (await response.json()) as ReplayState;
    setState(nextState);
    if (nextState.isComplete) {
      setIsPlaying(false);
    }
  }

  async function approve(approvalId: string, approved: boolean) {
    const response = await fetch("/api/replay/approve", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ approval_id: approvalId, approved })
    });
    setState(await response.json());
  }

  useEffect(() => {
    fetch("/api/scenarios")
      .then((response) => response.json())
      .then((payload) => setScenarios(payload.scenarios));
    fetch("/api/zones")
      .then((response) => response.json())
      .then((payload) => setZones(payload.zones));
    fetch("/api/live-zone-telemetry")
      .then((response) => response.json())
      .then((payload) => setLiveSamples(payload.samples));
    start(scenarioId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    liveTimerRef.current = window.setInterval(() => {
      setLiveSampleIndex((index) => {
        if (!liveSamples.length) return 0;
        return (index + 1) % liveSamples.length;
      });
    }, 1000);
    return () => {
      if (liveTimerRef.current) window.clearInterval(liveTimerRef.current);
    };
  }, [liveSamples.length]);

  useEffect(() => {
    if (!isPlaying) {
      if (timerRef.current) window.clearInterval(timerRef.current);
      timerRef.current = null;
      return;
    }
    timerRef.current = window.setInterval(() => {
      if (warmupRemaining > 0) {
        setWarmupRemaining((value) => Math.max(value - 1, 0));
        return;
      }
      step();
    }, 1300);
    return () => {
      if (timerRef.current) window.clearInterval(timerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPlaying, warmupRemaining]);

  const selectedCase = state?.selectedCase ?? null;
  const latestAssessment = state?.latestRiskAssessment ?? null;
  const currentEvent = state?.currentEvent ?? null;
  const currentZone = state?.currentZone ?? null;
  const rawLiveSample = liveSamples[liveSampleIndex] ?? null;
  const liveSample = useMemo(
    () => buildScenarioLiveSample(rawLiveSample, state?.selectedScenario ?? null, state?.currentEventIndex ?? 0, zones),
    [rawLiveSample, state?.currentEventIndex, state?.selectedScenario, zones]
  );
  const evidenceEvents = useMemo(() => {
    if (!state?.currentEvent) return [];
    const currentTime = new Date(state.currentEvent.timestamp).getTime();
    const tenMinutes = 10 * 60 * 1000;
    return state.selectedScenario.events
      .slice(0, state.currentEventIndex)
      .filter((event) => {
        if (event.vehicle_id !== state.currentEvent?.vehicle_id) return false;
        const eventTime = new Date(event.timestamp).getTime();
        return eventTime <= currentTime && currentTime - eventTime <= tenMinutes;
      });
  }, [state]);
  const zoneRiskCards = useMemo<ZoneRiskCard[]>(
    () =>
      zones.map((zone) => {
        const live = liveSample?.zones.find((item) => item.zone_id === zone.zone_id) ?? null;
        const level = live ? liveRiskLevel(live.live_risk) : baselineZoneRiskLevel(zone.zone_historical_risk);
        return {
          zone,
          level,
          className: zoneRiskClass(level),
          flags: zoneFlags(zone),
          live
        };
      }),
    [liveSample?.zones, zones]
  );
  const pendingApproval = state?.pendingApprovals.find((approval) => approval.status === "pending") ?? null;
  const pendingApprovalCount = state?.pendingApprovals.filter((approval) => approval.status === "pending").length ?? 0;
  const activeZoneCount = liveSample?.zones.filter((zone) => zone.active_prime_movers > 0).length ?? 0;
  const activePrimeMoverCount =
    liveSample?.zones.reduce((total, zone) => total + zone.active_prime_movers, 0) ?? 0;
  const highestRiskZone = useMemo(() => {
    if (!zoneRiskCards.length) return null;
    return zoneRiskCards.reduce((highest, card) => {
      const currentRisk = card.live?.live_risk ?? card.zone.zone_historical_risk;
      const highestRisk = highest.live?.live_risk ?? highest.zone.zone_historical_risk;
      return currentRisk > highestRisk ? card : highest;
    }, zoneRiskCards[0]);
  }, [zoneRiskCards]);
  const hasIntervention = Boolean(
    pendingApproval ||
      state?.toolCalls.length ||
      (latestAssessment && latestAssessment.risk_band !== "Low") ||
      (currentEvent && ABNORMAL_EVENTS.includes(currentEvent.event_type))
  );
  const actionExplanation = useMemo(
    () => explainAction(selectedCase, latestAssessment, pendingApproval),
    [latestAssessment, pendingApproval, selectedCase]
  );
  const safetyCase = state?.safetyCases.at(-1) ?? null;
  const recentTraceEvents = state?.traceEvents.slice(-5) ?? [];
  const interventionEvidence = useMemo(
    () => buildInterventionEvidenceTimeline(state?.traceEvents ?? [], latestAssessment, currentEvent),
    [currentEvent, latestAssessment, state?.traceEvents]
  );
  const progress = useMemo(() => {
    if (!state) return "0 / 0";
    return `${Math.min(state.currentEventIndex, state.selectedScenario.events.length)} / ${state.selectedScenario.events.length}`;
  }, [state]);

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand">
          <div className="brand-mark">NG</div>
          <div>
            <h1>NearGuard</h1>
            <p>Prime Mover telemetry forecast safety agent</p>
          </div>
        </div>
        <div className="controls">
          <select
            aria-label="Scenario"
            className="select"
            value={scenarioId}
            onChange={(event) => {
              setScenarioId(event.target.value);
              start(event.target.value);
            }}
          >
            {scenarios.map((scenario) => (
              <option key={scenario.scenario_id} value={scenario.scenario_id}>
                {scenario.name}
              </option>
            ))}
          </select>
          <button className="icon-button" onClick={() => start()} title="Reset replay">
            <RefreshCw size={16} /> Reset
          </button>
          <button className="icon-button" onClick={step} disabled={!state || state.isComplete} title="Step replay">
            <StepForward size={16} /> Step
          </button>
          <button
            className="primary-button"
            onClick={() => {
              setIsPlaying((value) => {
                const next = !value;
                if (next && !currentEvent) setWarmupRemaining(PLAY_WARMUP_TICKS);
                return next;
              });
            }}
            disabled={!state || state.isComplete}
            title={isPlaying ? "Pause replay" : "Auto-play replay"}
          >
            {isPlaying ? <Pause size={16} /> : <Play size={16} />} {isPlaying ? "Pause" : "Play"}
          </button>
        </div>
      </header>

      <section className="ops-strip" aria-label="Operational status">
        <div className="ops-item">
          <Activity size={15} />
          <span>Mode</span>
          <strong>{hasIntervention ? "Intervention Review" : isPlaying ? "Scenario Warm-up" : "Live Monitoring"}</strong>
        </div>
        <div className="ops-item">
          <Users size={15} />
          <span>Prime Movers</span>
          <strong>
            {activePrimeMoverCount || "--"} across {activeZoneCount || "--"} zones
          </strong>
        </div>
        <div className="ops-item">
          <Gauge size={15} />
          <span>Highest Zone Risk</span>
          <strong>
            {highestRiskZone
              ? `${highestRiskZone.zone.zone_id} ${(highestRiskZone.live?.live_risk ?? highestRiskZone.zone.zone_historical_risk).toFixed(2)}`
              : "--"}
          </strong>
        </div>
        <div className="ops-item">
          <Bell size={15} />
          <span>Approvals</span>
          <strong>{pendingApprovalCount ? `${pendingApprovalCount} pending` : "none pending"}</strong>
        </div>
        <div className="ops-item">
          <Radio size={15} />
          <span>Telemetry</span>
          <strong>{liveSample ? `updated ${timeLabel(liveSample.timestamp)}` : "loading stream"}</strong>
        </div>
      </section>

      <section className="dashboard">
        <aside className="panel">
          <div className="panel-header">
            <h2>Active Cases</h2>
            <span className="badge neutral">{progress}</span>
          </div>
          <div className="panel-body">
            {!state?.activeCases.length ? (
              <div className="empty">Start replay to create a vehicle case.</div>
            ) : (
              state.activeCases.map((item) => (
                <button
                  key={item.case_id}
                  className={`case-card ${item.case_id === selectedCase?.case_id ? "active" : ""}`}
                  type="button"
                >
                  <div className="case-title">
                    <span>{item.vehicle_id}</span>
                    <span className={`badge ${bandClass(latestAssessment?.risk_band)}`}>
                      {latestAssessment?.risk_band ?? "Monitoring"}
                    </span>
                  </div>
                  <p className="small muted">{item.status.replace("_", " ")}</p>
                  <p className="small">{item.recommended_action}</p>
                </button>
              ))
            )}
            <p className="small muted">
              Synthetic local demo. No real PSA telemetry, driver identity, production credentials or live integration.
            </p>
          </div>
        </aside>

        <section className="panel">
          <div className="panel-header">
            <h2>{state?.selectedScenario.name ?? "Scenario"}</h2>
            <span className={`badge ${bandClass(latestAssessment?.risk_band)}`}>
              <ShieldAlert size={14} />
              {hasIntervention ? (latestAssessment?.risk_band ?? "Review") : "Monitoring"}
            </span>
          </div>
          <div className="panel-body">
            <p className="muted">{state?.selectedScenario.description}</p>
            <div className="evidence-heading">
              <div>
                <h3>{hasIntervention ? "Intervention Evidence" : "Live Zone Monitoring"}</h3>
                <p className="small muted">
                  {hasIntervention
                    ? "Chronological evidence used by policy and tools for the current intervention."
                    : "Continuous synthetic telemetry stream with zone context joined for live risk estimates."}
                </p>
              </div>
              <span className="badge neutral">
                <Layers size={13} />
                {hasIntervention ? `${interventionEvidence.length} evidence steps` : "live stream"}
              </span>
            </div>
            <div className="replay-status-strip">
              <span>{hasIntervention ? "Intervention Review" : "Live Monitoring"}</span>
              <span>{progress}</span>
              <span>{warmupRemaining > 0 ? "Warm-up telemetry" : formatEventLabel(currentEvent?.event_type)}</span>
              <span>{liveSample ? `Live ${timeLabel(liveSample.timestamp)}` : "Loading live stream"}</span>
            </div>
            <div className="live-monitor" aria-label="Live zone telemetry monitor">
              <div className="live-monitor-header">
                <div>
                  <strong>{hasIntervention ? "Scenario evidence crossed intervention policy" : "No active intervention"}</strong>
                  <p className="small muted">
                    {hasIntervention
                      ? "Live zone conditions remain visible while the scenario evidence is assessed."
                      : "Zone risk is recalculated from the looping live telemetry stream."}
                  </p>
                </div>
                <span className={`live-dot ${isPlaying ? "active" : ""}`} />
              </div>
              <div className="risk-legend" aria-label="Zone risk legend">
                <span>
                  <i className="legend-dot low" /> Low &lt; 0.45
                </span>
                <span>
                  <i className="legend-dot medium" /> Medium 0.45-0.67
                </span>
                <span>
                  <i className="legend-dot high" /> High &gt;= 0.68
                </span>
                <em>Zone risk is operating context; intervention requires event evidence.</em>
              </div>
              <div className="zone-risk-board">
                {zoneRiskCards.map((card) => (
                  <article
                    className={`zone-live-card ${card.className} ${card.zone.zone_id === currentEvent?.zone_id ? "current" : ""}`}
                    key={card.zone.zone_id}
                  >
                    <div className="zone-live-top">
                      <div>
                        <strong>{card.zone.zone_name}</strong>
                        <p className="small muted">{card.zone.zone_id}</p>
                      </div>
                      <span className={`badge ${card.className}`}>{card.level}</span>
                    </div>
                    <div className="risk-meter" aria-hidden="true">
                      <span style={{ width: riskPercent(card.live?.live_risk ?? card.zone.zone_historical_risk) }} />
                    </div>
                    <div className="zone-live-grid">
                      <span>
                        Risk <strong>{(card.live?.live_risk ?? card.zone.zone_historical_risk).toFixed(2)}</strong>
                      </span>
                      <span>
                        PMs <strong>{card.live?.active_prime_movers ?? "--"}</strong>
                      </span>
                      <span>
                        Avg <strong>{card.live ? `${card.live.avg_speed} km/h` : "--"}</strong>
                      </span>
                      <span>
                        Compliance <strong>{card.live ? riskPercent(card.live.speed_compliance) : "--"}</strong>
                      </span>
                      <span>
                        GPS delayed/stale{" "}
                        <strong>{card.live ? `${card.live.delayed_gps_count}/${card.live.stale_gps_count}` : "--"}</strong>
                      </span>
                      <span>
                        Pressure <strong>{card.live ? riskPercent(card.live.traffic_pressure) : "--"}</strong>
                      </span>
                    </div>
                    <div className="zone-flag-row">
                      {card.flags.slice(0, 4).map((flag) => (
                        <em key={flag}>{flag}</em>
                      ))}
                    </div>
                    <ul className="prime-mover-list">
                      {(card.live?.prime_movers ?? []).slice(0, 3).map((mover) => (
                        <li className={mover.state.replaceAll(" ", "-")} key={mover.vehicle_id}>
                          <span>{mover.vehicle_id}</span>
                          <strong>{mover.speed} km/h</strong>
                          <small>limit {mover.speed_limit} km/h | {mover.state}</small>
                        </li>
                      ))}
                    </ul>
                  </article>
                ))}
              </div>
              <div className="evidence-timeline-panel">
                <div className="tool-row">
                  <strong>{hasIntervention ? "Intervention Evidence Timeline" : "Monitoring Feed"}</strong>
                  <span className="badge neutral">
                    {hasIntervention ? (latestAssessment?.risk_band ?? "Review") : `${liveSamples.length || 0} loop samples`}
                  </span>
                </div>
                {!hasIntervention ? (
                  <ul className="monitor-feed">
                    {zoneRiskCards.slice(0, 4).map((card) => (
                      <li key={card.zone.zone_id}>
                        <span className="trace-time">{timeLabel(card.live?.updated_at ?? liveSample?.timestamp)}</span>
                        <div>
                          <span className={`event-code ${card.className}`}>{card.zone.zone_id}</span>
                          <p>
                            {card.live?.active_prime_movers ?? 0} Prime Movers, live risk{" "}
                            {(card.live?.live_risk ?? card.zone.zone_historical_risk).toFixed(2)}, compliance{" "}
                            {card.live ? riskPercent(card.live.speed_compliance) : "--"}.
                          </p>
                        </div>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <ul className="intervention-timeline">
                    {evidenceEvents.map((event) => (
                      <li className={eventSeverityClass(event)} key={event.event_id}>
                        <span className="trace-time">{timeLabel(event.timestamp)}</span>
                        <div>
                          <span className={`event-code ${eventSeverityClass(event)}`}>{formatEventLabel(event.event_type)}</span>
                          <p>
                            {event.vehicle_id} in {event.zone_id}: {event.speed}/{event.speed_limit} km/h, GPS{" "}
                            {event.gps_freshness}.
                          </p>
                        </div>
                      </li>
                    ))}
                    {interventionEvidence.map((trace) => (
                      <li key={trace.trace_id}>
                        <span className="trace-time">{timeLabel(trace.timestamp)}</span>
                        <div>
                          <span className="event-code neutral">{trace.event_type.replaceAll("_", " ")}</span>
                          <p>{trace.message}</p>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
            <div className="grid-two">
              <div className="metric">
                <p className="metric-label">Near-Miss Risk</p>
                <p className="metric-value">{latestAssessment ? latestAssessment.safety_incident_risk_score.toFixed(2) : "--"}</p>
              </div>
              <div className="metric">
                <p className="metric-label">Prediction Horizon</p>
                <p className="metric-value">{latestAssessment?.prediction_horizon ?? "--"}</p>
              </div>
              <div className="metric">
                <p className="metric-label">Confidence</p>
                <p className="metric-value">{latestAssessment?.confidence ?? "--"}</p>
              </div>
            </div>

            <h3 className="section-title">Current Event</h3>
            <div className="kv-grid">
              <div className="kv">
                <span>Vehicle</span>
                <strong>{state?.currentEvent?.vehicle_id ?? "--"}</strong>
              </div>
              <div className="kv">
                <span>Event</span>
                <strong>{state?.currentEvent?.event_type ?? "--"}</strong>
              </div>
              <div className="kv">
                <span>Speed</span>
                <strong>{state?.currentEvent ? `${state.currentEvent.speed} / ${state.currentEvent.speed_limit} km/h` : "--"}</strong>
              </div>
              <div className="kv">
                <span>Zone</span>
                <strong>{state?.currentZone?.zone_name ?? "Unavailable / pending"}</strong>
              </div>
              <div className="kv">
                <span>Traffic</span>
                <strong>{state?.currentZone?.traffic_level ?? state?.latestFeatures?.traffic_level ?? "--"}</strong>
              </div>
              <div className="kv">
                <span>GPS</span>
                <strong>{state?.currentEvent?.gps_freshness ?? "--"}</strong>
              </div>
              <div className="kv">
                <span>Weather</span>
                <strong>{state?.currentZone?.weather ?? state?.latestFeatures?.weather ?? "--"}</strong>
              </div>
              <div className="kv">
                <span>GPS Accuracy</span>
                <strong>{state?.currentEvent?.accuracy_m ? `${state.currentEvent.accuracy_m} m` : "--"}</strong>
              </div>
              <div className="kv">
                <span>Restriction</span>
                <strong>{state?.currentZone?.restriction_level ?? state?.latestFeatures?.restriction_level ?? "--"}</strong>
              </div>
              <div className="kv">
                <span>Pedestrian Exposure</span>
                <strong>{state?.currentZone?.pedestrian_exposure ?? state?.latestFeatures?.pedestrian_exposure ?? "--"}</strong>
              </div>
              <div className="kv">
                <span>Zone Baseline</span>
                <strong>{state?.currentZone ? state.currentZone.zone_historical_risk.toFixed(2) : "--"}</strong>
              </div>
            </div>

            <h3 className="section-title">Rolling Telemetry Features</h3>
            <div className="kv-grid">
              <div className="kv">
                <span>Over Limit</span>
                <strong>{state?.latestFeatures ? `${state.latestFeatures.speed_over_limit} km/h` : "--"}</strong>
              </div>
              <div className="kv">
                <span>Limit Exposure 10m</span>
                <strong>{state?.latestFeatures ? `${Math.round(state.latestFeatures.speeding_ratio_10m * 100)}%` : "--"}</strong>
              </div>
              <div className="kv">
                <span>Speed Std 10m</span>
                <strong>{state?.latestFeatures ? `${state.latestFeatures.speed_std_10m} km/h` : "--"}</strong>
              </div>
              <div className="kv">
                <span>Harsh Brakes 10m</span>
                <strong>{state?.latestFeatures?.recent_harsh_brake_count_10m ?? "--"}</strong>
              </div>
              <div className="kv">
                <span>Sharp Turns 10m</span>
                <strong>{state?.latestFeatures?.recent_sharp_turn_count_10m ?? "--"}</strong>
              </div>
              <div className="kv">
                <span>Pedestrian Exposure</span>
                <strong>{state?.latestFeatures?.pedestrian_exposure ?? "--"}</strong>
              </div>
              <div className="kv">
                <span>Restriction</span>
                <strong>{state?.latestFeatures?.restriction_level ?? "--"}</strong>
              </div>
              <div className="kv">
                <span>Trend</span>
                <strong>{state?.latestFeatures?.risk_trend ?? "--"}</strong>
              </div>
            </div>
            <p className="small muted">
              ML evidence supports prioritization; deterministic safety policy and human approval control interventions.
            </p>

            <h3 className="section-title">Risk Reasons</h3>
            {!latestAssessment ? (
              <div className="empty">Risk reasons appear after the first event.</div>
            ) : (
              <ul className="reason-list">
                {latestAssessment.top_risk_reasons.map((reason) => (
                  <li key={reason}>{reason}</li>
                ))}
              </ul>
            )}

            {latestAssessment?.uncertainty_reason ? (
              <>
                <h3 className="section-title">Uncertainty</h3>
                <div className="approval">
                  <AlertTriangle size={16} /> {latestAssessment.uncertainty_reason}
                </div>
              </>
            ) : null}
          </div>
        </section>

        <aside className="right-column">
          <section className="panel priority-panel">
            <div className="panel-header">
              <h3>Priority Action</h3>
              <span className={`badge ${actionExplanation.statusClass}`}>
                <FastForward size={14} />
                {pendingApproval ? "Approval" : selectedCase?.authority_class ?? "Idle"}
              </span>
            </div>
            <div className="panel-body">
              <div className="priority-action">
                <strong>{actionExplanation.title}</strong>
                <p className="small muted">{actionExplanation.summary}</p>
              </div>

              {pendingApproval ? (
                <div className="approval priority-approval">
                  <strong>{pendingApproval.requested_action}</strong>
                  <p className="small muted">{pendingApproval.rationale}</p>
                  <div className="approval-actions">
                    <button className="primary-button" onClick={() => approve(pendingApproval.approval_id, true)}>
                      <ClipboardCheck size={16} /> Approve
                    </button>
                    <button className="icon-button" onClick={() => approve(pendingApproval.approval_id, false)}>
                      Reject
                    </button>
                  </div>
                </div>
              ) : (
                <div className="empty compact-empty">No pending approval.</div>
              )}

              <h3 className="section-title">Action Rationale</h3>
              <ul className="rationale-list">
                {actionExplanation.rationale.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>

              <h3 className="section-title">Tool Rationale</h3>
              {!state?.toolCalls.length ? (
                <div className="empty compact-empty">No tools called yet.</div>
              ) : (
                <ul className="tool-list rationale-tools">
                  {state.toolCalls.slice(-4).map((tool) => (
                    <li key={tool.tool_call_id}>
                      <div className="tool-row">
                        <strong>{tool.tool_name}</strong>
                        <span className={`badge ${tool.status === "failed" ? "critical" : "low"}`}>
                          {tool.status === "failed" ? <AlertTriangle size={13} /> : <CheckCircle2 size={13} />}
                          {tool.status}
                        </span>
                      </div>
                      <p className="small">{toolRationale(tool, latestAssessment)}</p>
                      <p className="small muted">{tool.error ? `Failure: ${tool.error}` : tool.result}</p>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </section>

          <section className="panel" style={{ marginTop: 14 }}>
            <div className="panel-header">
              <h3>Safety Case</h3>
              <ClipboardCheck size={16} />
            </div>
            <div className="panel-body">
              <h3 className="section-title">Safety Case</h3>
              {safetyCase ? (
                <div className="approval">
                  <strong>{safetyCase.safety_case_id}</strong>
                  <p className="small">{safetyCase.summary}</p>
                  <p className="small muted">{safetyCase.evidence[0]}</p>
                </div>
              ) : (
                <div className="empty">No safety case created.</div>
              )}
            </div>
          </section>

          <section className="panel" style={{ marginTop: 14 }}>
            <div className="panel-header">
              <h3>Recent Trace</h3>
              <Clock3 size={16} />
            </div>
            <div className="panel-body">
              {!state?.traceEvents.length ? (
                <div className="empty">Trace starts when replay begins.</div>
              ) : (
                <ul className="trace-list">
                  {recentTraceEvents.map((item) => (
                    <li className="trace-item" key={item.trace_id}>
                      <span className="trace-time">{timeLabel(item.timestamp)}</span>
                      <p className="trace-message">{item.message}</p>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </section>
        </aside>
      </section>
    </main>
  );
}
