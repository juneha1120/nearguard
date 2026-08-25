"use client";

import {
  AlertTriangle,
  CheckCircle2,
  ClipboardCheck,
  Clock3,
  FastForward,
  Layers,
  Pause,
  Play,
  RefreshCw,
  ShieldAlert,
  StepBack,
  StepForward
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  bandClass,
  baselineZoneRiskLevel,
  buildDecisionTimeline,
  buildScenarioLiveSample,
  closingSeverityClass,
  confidenceSeverityClass,
  countSeverityClass,
  distanceSeverityClass,
  eventSeverityClass,
  eventSignalClass,
  explainAction,
  formatEventLabel,
  gpsSeverityClass,
  isDecisionPointEvent,
  liveRiskLevel,
  restrictionSeverityClass,
  riskPercent,
  scoreSeverityClass,
  scoreSeverityLabel,
  speedSeverityClass,
  timeLabel,
  toolRationale,
  trafficLevelFromPressure,
  trafficSeverityClass,
  trendSeverityClass,
  zoneFlags,
  zoneRiskClass,
  type ScenarioMetadata,
  type ZoneRiskCard
} from "@/components/dashboard/dashboard-utils";
import { assessLiveVehicleNearMissRisk, calculateZoneOperationalRisk } from "@/lib/model/live-risk";
import type {
  LiveTelemetrySample,
  ReplayState,
  ScenarioTelemetrySample,
  ScenarioZoneTelemetrySample,
  ZoneRegistryEntry
} from "@/lib/types/domain";

const PLAY_WARMUP_TICKS = 3;

export function NearGuardDashboard() {
  const [scenarios, setScenarios] = useState<ScenarioMetadata[]>([]);
  const [zones, setZones] = useState<ZoneRegistryEntry[]>([]);
  const [liveSamples, setLiveSamples] = useState<LiveTelemetrySample[]>([]);
  const [scenarioTelemetrySamples, setScenarioTelemetrySamples] = useState<ScenarioTelemetrySample[]>([]);
  const [scenarioZoneTelemetrySamples, setScenarioZoneTelemetrySamples] = useState<ScenarioZoneTelemetrySample[]>([]);
  const [liveSampleIndex, setLiveSampleIndex] = useState(0);
  const [warmupRemaining, setWarmupRemaining] = useState(0);
  const [scenarioClockMs, setScenarioClockMs] = useState<number | null>(null);
  const [scenarioId, setScenarioId] = useState("pm27-persistent-high-risk");
  const [state, setState] = useState<ReplayState | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [rightTab, setRightTab] = useState<"action" | "timeline">("action");
  const [selectedLiveVehicleId, setSelectedLiveVehicleId] = useState<string | null>(null);
  const replayRequestRef = useRef(0);
  const timerRef = useRef<number | null>(null);
  const liveTimerRef = useRef<number | null>(null);

  async function start(id = scenarioId) {
    if (!id) return;

    const requestId = ++replayRequestRef.current;
    const response = await fetch("/api/replay/start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ scenario_id: id })
    });
    const nextState = (await response.json()) as ReplayState;
    if (requestId !== replayRequestRef.current) return;

    setState(nextState);
    setIsPlaying(false);
    setWarmupRemaining(0);
    setLiveSampleIndex(0);
    setScenarioClockMs(nextState.selectedScenario.events[0] ? new Date(nextState.selectedScenario.events[0].timestamp).getTime() : null);
    fetch(`/api/scenario-telemetry?scenario_id=${encodeURIComponent(id)}`)
      .then((telemetryResponse) => telemetryResponse.json())
      .then((payload) => {
        if (requestId === replayRequestRef.current) setScenarioTelemetrySamples(payload.samples);
      });
    fetch(`/api/scenario-zone-telemetry?scenario_id=${encodeURIComponent(id)}`)
      .then((telemetryResponse) => telemetryResponse.json())
      .then((payload) => {
        if (requestId === replayRequestRef.current) setScenarioZoneTelemetrySamples(payload.samples);
      });
  }

  function resetToLiveMonitoring() {
    replayRequestRef.current += 1;
    setScenarioId("");
    setState(null);
    setIsPlaying(false);
    setWarmupRemaining(0);
    setLiveSampleIndex(0);
    setScenarioClockMs(null);
    setScenarioTelemetrySamples([]);
    setScenarioZoneTelemetrySamples([]);
  }

  async function step() {
    const response = await fetch("/api/replay/step", { method: "POST" });
    const nextState = (await response.json()) as ReplayState;
    setState(nextState);
    if (nextState.currentEvent) {
      setScenarioClockMs(new Date(nextState.currentEvent.timestamp).getTime());
    }
    if (nextState.isComplete) {
      setIsPlaying(false);
    }
  }

  async function previous() {
    setIsPlaying(false);
    const response = await fetch("/api/replay/previous", { method: "POST" });
    const nextState = (await response.json()) as ReplayState;
    setState(nextState);
    if (nextState.currentEvent) {
      setScenarioClockMs(new Date(nextState.currentEvent.timestamp).getTime());
    } else {
      setScenarioClockMs(nextState.selectedScenario.events[0] ? new Date(nextState.selectedScenario.events[0].timestamp).getTime() : null);
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
      setScenarioClockMs((timestamp) => (timestamp === null ? timestamp : timestamp + 1000));
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
    }, 1000);
    return () => {
      if (timerRef.current) window.clearInterval(timerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPlaying, warmupRemaining]);

  const selectedCase = state?.selectedCase ?? null;
  const latestAssessment = state?.latestRiskAssessment ?? null;
  const currentEvent = state?.currentEvent ?? null;
  const rawLiveSample = liveSamples[liveSampleIndex] ?? null;
  const scenarioClockTimestamp = scenarioClockMs === null ? null : new Date(scenarioClockMs).toISOString();
  const scenarioTelemetrySample = useMemo(() => {
    if (scenarioClockMs === null || !scenarioTelemetrySamples.length) return null;
    return (
      scenarioTelemetrySamples.find((sample) => new Date(sample.timestamp).getTime() >= scenarioClockMs) ??
      scenarioTelemetrySamples.at(-1) ??
      null
    );
  }, [scenarioClockMs, scenarioTelemetrySamples]);
  const scenarioZoneTelemetrySample = useMemo(() => {
    if (scenarioClockMs === null || !scenarioZoneTelemetrySamples.length) return null;
    return (
      scenarioZoneTelemetrySamples.find((sample) => new Date(sample.timestamp).getTime() >= scenarioClockMs) ??
      scenarioZoneTelemetrySamples.at(-1) ??
      null
    );
  }, [scenarioClockMs, scenarioZoneTelemetrySamples]);
  const liveSample = useMemo(
    () =>
      buildScenarioLiveSample(
        rawLiveSample,
        state?.selectedScenario ?? null,
        state?.currentEventIndex ?? 0,
        scenarioClockTimestamp,
        scenarioTelemetrySample,
        scenarioZoneTelemetrySample
      ),
    [
      rawLiveSample,
      scenarioClockTimestamp,
      scenarioTelemetrySample,
      scenarioZoneTelemetrySample,
      state?.currentEventIndex,
      state?.selectedScenario
    ]
  );
  const decisionPointEvents = useMemo(() => {
    if (!state?.currentEvent) return [];
    const currentTime = new Date(state.currentEvent.timestamp).getTime();
    const tenMinutes = 10 * 60 * 1000;
    return state.selectedScenario.events
      .slice(0, state.currentEventIndex)
      .filter((event) => {
        if (event.vehicle_id !== state.currentEvent?.vehicle_id) return false;
        if (!isDecisionPointEvent(event)) return false;
        const eventTime = new Date(event.timestamp).getTime();
        return eventTime <= currentTime && currentTime - eventTime <= tenMinutes;
      });
  }, [state]);
  const normalTelemetryWindowCount = useMemo(() => {
    if (!state?.currentEvent) return 0;
    return state.selectedScenario.events
      .slice(0, state.currentEventIndex)
      .filter((event) => event.vehicle_id === state.currentEvent?.vehicle_id && !isDecisionPointEvent(event)).length;
  }, [state]);
  const zoneRiskCards = useMemo<ZoneRiskCard[]>(
    () =>
      zones.map((zone) => {
        const live = liveSample?.zones.find((item) => item.zone_id === zone.zone_id) ?? null;
        const operationalRisk = live ? calculateZoneOperationalRisk(live) : zone.zone_historical_risk;
        const level = live ? liveRiskLevel(operationalRisk) : baselineZoneRiskLevel(zone.zone_historical_risk);
        return {
          zone,
          level,
          className: zoneRiskClass(level),
          flags: zoneFlags(live),
          live,
          operationalRisk
        };
      }),
    [liveSample?.zones, zones]
  );
  const selectedLiveVehicle = useMemo(() => {
    const liveZones = liveSample?.zones ?? [];
    for (const liveZone of liveZones) {
      const mover = liveZone.prime_movers.find((item) => item.vehicle_id === selectedLiveVehicleId);
      if (mover) {
        return {
          mover,
          liveZone,
          zone: zones.find((item) => item.zone_id === liveZone.zone_id) ?? null
        };
      }
    }

    const firstLiveZone = liveZones.find((item) => item.prime_movers.length > 0);
    const firstMover = firstLiveZone?.prime_movers[0] ?? null;
    if (!firstLiveZone || !firstMover) return null;

    return {
      mover: firstMover,
      liveZone: firstLiveZone,
      zone: zones.find((item) => item.zone_id === firstLiveZone.zone_id) ?? null
    };
  }, [liveSample?.zones, selectedLiveVehicleId, zones]);
  const liveVehicleAssessment = useMemo(() => {
    if (!selectedLiveVehicle || !liveSample) return null;
    const sampleHistory = liveSamples.slice(0, liveSampleIndex + 1);
    const samples = sampleHistory.some((sample) => sample.sample_id === liveSample.sample_id)
      ? sampleHistory
      : [...sampleHistory, liveSample];

    return assessLiveVehicleNearMissRisk(
      samples,
      liveSample,
      selectedLiveVehicle.liveZone,
      selectedLiveVehicle.mover,
      selectedLiveVehicle.zone,
      latestAssessment?.safety_incident_risk_score
    );
  }, [latestAssessment?.safety_incident_risk_score, liveSample, liveSampleIndex, liveSamples, selectedLiveVehicle]);
  const pendingApproval = state?.pendingApprovals.find((approval) => approval.status === "pending") ?? null;
  const hasIntervention = Boolean(
    pendingApproval ||
      state?.toolCalls.length ||
      (latestAssessment && ["High", "Persistent High", "Critical / Low Confidence"].includes(latestAssessment.risk_band))
  );
  const actionExplanation = useMemo(
    () => explainAction(selectedCase, latestAssessment, pendingApproval),
    [latestAssessment, pendingApproval, selectedCase]
  );
  const safetyCase = state?.safetyCases.at(-1) ?? null;
  const decisionTimeline = useMemo(
    () => buildDecisionTimeline(state?.traceEvents ?? [], latestAssessment, currentEvent),
    [currentEvent, latestAssessment, state?.traceEvents]
  );
  const signalUsesLiveVehicle = Boolean(liveVehicleAssessment);
  const signalVehicleId = currentEvent?.vehicle_id ?? selectedLiveVehicle?.mover.vehicle_id ?? "--";
  const signalEventLabel = currentEvent?.event_type ?? selectedLiveVehicle?.mover.state ?? "--";
  const signalSpeed = currentEvent
    ? `${currentEvent.speed} / ${currentEvent.speed_limit} km/h`
    : selectedLiveVehicle
      ? `${selectedLiveVehicle.mover.speed} / ${selectedLiveVehicle.mover.speed_limit} km/h`
      : "--";
  const signalZoneName = state?.currentZone?.zone_name ?? selectedLiveVehicle?.zone?.zone_name ?? selectedLiveVehicle?.liveZone.zone_id ?? "Unavailable / pending";
  const signalTraffic = state?.currentZone?.traffic_level ?? state?.latestFeatures?.traffic_level ?? trafficLevelFromPressure(selectedLiveVehicle?.liveZone.traffic_pressure) ?? "--";
  const signalGps = currentEvent?.gps_freshness ?? selectedLiveVehicle?.mover.gps_freshness ?? "--";
  const signalRisk = liveVehicleAssessment?.assessment.safety_incident_risk_score ?? latestAssessment?.safety_incident_risk_score ?? null;
  const signalConfidence = liveVehicleAssessment?.assessment.confidence ?? latestAssessment?.confidence ?? "--";
  const signalRiskLabel = liveVehicleAssessment?.assessment.risk_band ?? latestAssessment?.risk_band ?? scoreSeverityLabel(signalRisk);
  const signalRiskClass = liveVehicleAssessment?.assessment.risk_band
    ? bandClass(liveVehicleAssessment.assessment.risk_band)
    : latestAssessment?.risk_band
      ? bandClass(latestAssessment.risk_band)
      : "neutral";
  const signalFeatures = liveVehicleAssessment?.features ?? state?.latestFeatures ?? null;
  const signalReasons = liveVehicleAssessment?.assessment.top_risk_reasons ?? latestAssessment?.top_risk_reasons ?? [];
  const signalZoneRisk = selectedLiveVehicle ? calculateZoneOperationalRisk(selectedLiveVehicle.liveZone) : null;
  const signalSpeedClass = currentEvent
    ? speedSeverityClass(currentEvent.speed, currentEvent.speed_limit)
    : speedSeverityClass(selectedLiveVehicle?.mover.speed, selectedLiveVehicle?.mover.speed_limit);
  const signalEventClass = eventSignalClass(signalEventLabel);
  const signalTrafficClass = trafficSeverityClass(signalTraffic);
  const signalGpsClass = gpsSeverityClass(signalGps);

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
              const nextScenarioId = event.target.value;
              setScenarioId(nextScenarioId);
              if (nextScenarioId) start(nextScenarioId);
              else resetToLiveMonitoring();
            }}
          >
            <option value="">Live monitoring</option>
            {scenarios.map((scenario) => (
              <option key={scenario.scenario_id} value={scenario.scenario_id}>
                {scenario.name}
              </option>
            ))}
          </select>
          <button className="icon-button" onClick={resetToLiveMonitoring} title="Reset to live monitoring">
            <RefreshCw size={16} /> Reset
          </button>
          <button className="icon-button" onClick={previous} disabled={!state || !currentEvent} title="Go to previous decision point">
            <StepBack size={16} /> Prev Decision
          </button>
          <button className="icon-button" onClick={step} disabled={!state || state.isComplete} title="Jump to next decision point">
            <StepForward size={16} /> Next Decision
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

      <section className="dashboard">
        <section className="panel live-dashboard-panel">
          <div className="panel-header">
            <div>
              <h2>Zone Monitor</h2>
              <p className="small muted">Operational zone telemetry</p>
            </div>
            <span className={`badge ${bandClass(latestAssessment?.risk_band)}`}>
              <ShieldAlert size={14} />
              {hasIntervention ? (latestAssessment?.risk_band ?? "Review") : "Monitoring"}
            </span>
          </div>
          <div className="panel-body">
            <div className="live-monitor" aria-label="Live zone telemetry monitor">
              <div className="live-monitor-header">
                <div>
                  <strong>{hasIntervention ? "Vehicle risk crossed an intervention threshold" : "Continuous assessment active"}</strong>
                </div>
                <div className="live-clock">
                  <Clock3 size={14} />
                  <span>{liveSample ? timeLabel(liveSample.timestamp) : "--:--:--"}</span>
                  <i className={`live-dot ${isPlaying ? "active" : ""}`} />
                </div>
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
                        <p className="small muted">
                          {card.zone.zone_id} - {card.live?.active_prime_movers ?? 0} PMs
                        </p>
                      </div>
                      <span className={`badge ${card.className}`}>{card.level}</span>
                    </div>
                    <div className="risk-meter" aria-hidden="true">
                      <span style={{ width: riskPercent(card.operationalRisk) }} />
                    </div>
                    <div className="zone-live-grid">
                      <span>
                        Zone Risk <strong>{card.operationalRisk.toFixed(2)}</strong>
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
                    </div>
                    <div className="zone-flag-row">
                      {card.flags.slice(0, 3).map((flag) => (
                        <em key={flag}>{flag}</em>
                      ))}
                    </div>
                    <ul className="prime-mover-list">
                      {(card.live?.prime_movers ?? []).map((mover) => (
                        <li
                          className={`${scoreSeverityClass(
                            card.live && liveSample
                              ? assessLiveVehicleNearMissRisk(liveSamples.slice(0, liveSampleIndex + 1), liveSample, card.live, mover, card.zone).assessment
                                  .safety_incident_risk_score
                              : null
                          )} ${selectedLiveVehicle?.mover.vehicle_id === mover.vehicle_id && signalUsesLiveVehicle ? "selected" : ""}`}
                          key={mover.vehicle_id}
                        >
                          <button type="button" onClick={() => setSelectedLiveVehicleId(mover.vehicle_id)}>
                            <span>{mover.vehicle_id}</span>
                            <strong>{mover.speed} km/h</strong>
                            <small>
                              limit {mover.speed_limit} km/h
                              <em className={`state-tag ${eventSignalClass(mover.state)}`}>{mover.state}</em>
                            </small>
                          </button>
                        </li>
                      ))}
                    </ul>
                  </article>
                ))}
              </div>
            </div>
          </div>
        </section>

        <aside className="snapshot-column">
          <section className="panel vehicle-signal-panel">
            <div className="panel-header">
              <h3>Vehicle Signal</h3>
              <span className={`badge ${signalRiskClass}`}>
                {signalRiskLabel}
              </span>
            </div>
            <div className="panel-body">
              <div className="signal-metrics">
                <div className={`metric signal-card ${scoreSeverityClass(signalRisk)}`}>
                  <p className="metric-label">Vehicle Near-Miss Risk</p>
                  <p className="metric-value">{signalRisk === null ? "--" : signalRisk.toFixed(2)}</p>
                </div>
                <div className={`metric signal-card ${confidenceSeverityClass(signalConfidence)}`}>
                  <p className="metric-label">Confidence</p>
                  <p className="metric-value">{signalConfidence}</p>
                </div>
              </div>

              <h3 className="section-title">{signalUsesLiveVehicle ? "Selected Vehicle" : "Current Event"}</h3>
              <div className="kv-grid compact">
                <div className="kv signal-card neutral">
                  <span>Vehicle</span>
                  <strong>{signalVehicleId}</strong>
                </div>
                <div className={`kv signal-card ${signalEventClass}`}>
                  <span>{signalUsesLiveVehicle ? "State" : "Event"}</span>
                  <strong>{signalEventLabel}</strong>
                </div>
                <div className={`kv signal-card ${signalSpeedClass}`}>
                  <span>Speed</span>
                  <strong>{signalSpeed}</strong>
                </div>
                <div className={`kv signal-card ${scoreSeverityClass(signalZoneRisk)}`}>
                  <span>Zone</span>
                  <strong>{signalZoneName}</strong>
                </div>
                <div className={`kv signal-card ${signalTrafficClass}`}>
                  <span>Traffic</span>
                  <strong>{signalTraffic}</strong>
                </div>
                <div className={`kv signal-card ${signalGpsClass}`}>
                  <span>GPS</span>
                  <strong>{signalGps}</strong>
                </div>
              </div>

              <h3 className="section-title">Rolling Features</h3>
              <div className="kv-grid compact">
                <div className={`kv signal-card ${speedSeverityClass(signalFeatures?.speed, signalFeatures?.speed_limit)}`}>
                  <span>Over Limit</span>
                  <strong>{signalFeatures ? `${signalFeatures.speed_over_limit} km/h` : "--"}</strong>
                </div>
                <div className={`kv signal-card ${scoreSeverityClass(signalFeatures?.speeding_ratio_10m)}`}>
                  <span>Exposure 10m</span>
                  <strong>{signalFeatures ? `${Math.round(signalFeatures.speeding_ratio_10m * 100)}%` : "--"}</strong>
                </div>
                <div className={`kv signal-card ${countSeverityClass(signalFeatures?.recent_harsh_brake_count_10m)}`}>
                  <span>Harsh Brakes</span>
                  <strong>{signalFeatures?.recent_harsh_brake_count_10m ?? "--"}</strong>
                </div>
                <div className={`kv signal-card ${countSeverityClass(signalFeatures?.recent_sharp_turn_count_10m)}`}>
                  <span>Sharp Turns</span>
                  <strong>{signalFeatures?.recent_sharp_turn_count_10m ?? "--"}</strong>
                </div>
                <div className={`kv signal-card ${restrictionSeverityClass(signalFeatures?.restriction_level)}`}>
                  <span>Restriction</span>
                  <strong>{signalFeatures?.restriction_level ?? "--"}</strong>
                </div>
                <div className={`kv signal-card ${trendSeverityClass(signalFeatures?.risk_trend)}`}>
                  <span>Trend</span>
                  <strong>{signalFeatures?.risk_trend ?? "--"}</strong>
                </div>
              </div>

              <h3 className="section-title">Surrounding Motion</h3>
              <div className="kv-grid compact">
                <div
                  className={`kv signal-card ${distanceSeverityClass(
                    signalFeatures?.nearest_vehicle_distance_m,
                    signalFeatures?.interaction_features_available
                  )}`}
                >
                  <span>Nearest PM</span>
                  <strong>
                    {signalFeatures?.interaction_features_available ? `${Math.round(signalFeatures.nearest_vehicle_distance_m)}m` : "--"}
                  </strong>
                </div>
                <div className={`kv signal-card ${countSeverityClass(signalFeatures?.nearby_vehicle_count_50m)}`}>
                  <span>Within 50m</span>
                  <strong>{signalFeatures?.interaction_features_available ? signalFeatures.nearby_vehicle_count_50m : "--"}</strong>
                </div>
                <div
                  className={`kv signal-card ${closingSeverityClass(
                    signalFeatures?.closing_rate_mps,
                    signalFeatures?.interaction_features_available
                  )}`}
                >
                  <span>Closing</span>
                  <strong>{signalFeatures?.interaction_features_available ? `${signalFeatures.closing_rate_mps.toFixed(1)} m/s` : "--"}</strong>
                </div>
                <div
                  className={`kv signal-card ${scoreSeverityClass(
                    signalFeatures?.interaction_features_available ? signalFeatures.nearest_vehicle_relative_speed_kmh / 30 : null
                  )}`}
                >
                  <span>Relative Speed</span>
                  <strong>
                    {signalFeatures?.interaction_features_available ? `${signalFeatures.nearest_vehicle_relative_speed_kmh.toFixed(1)} km/h` : "--"}
                  </strong>
                </div>
              </div>

              <h3 className="section-title">Risk Reasons</h3>
              {!signalReasons.length ? (
                <div className="empty compact-empty">Risk reasons appear after live model assessment.</div>
              ) : (
                <ul className="reason-list compact-reasons">
                  {signalReasons.slice(0, 3).map((reason) => (
                    <li key={reason}>{reason}</li>
                  ))}
                </ul>
              )}
            </div>
          </section>
        </aside>

        <aside className="right-column">
          <section className="panel priority-panel">
            <div className="panel-header">
              <h3>AI Assessment</h3>
              <span className={`badge ${actionExplanation.statusClass}`}>
                <FastForward size={14} />
                {pendingApproval ? "Approval" : selectedCase?.authority_class ?? "Idle"}
              </span>
            </div>
            <div className="scenario-context">
              <span>Scenario</span>
              <strong>{state?.selectedScenario.name ?? "Live monitoring"}</strong>
              <p>{state?.selectedScenario.description ?? "Monitoring live telemetry without a selected replay scenario."}</p>
            </div>
            <div className="tab-bar" role="tablist" aria-label="AI assessment details">
              <button className={rightTab === "action" ? "active" : ""} onClick={() => setRightTab("action")} type="button">
                Action
              </button>
              <button className={rightTab === "timeline" ? "active" : ""} onClick={() => setRightTab("timeline")} type="button">
                Timeline
              </button>
            </div>
            <div className="panel-body">
              {rightTab === "action" ? (
                <>
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
                      {state.toolCalls.slice(-3).map((tool) => (
                        <li key={tool.tool_call_id}>
                          <div className="tool-row">
                            <strong>{tool.tool_name}</strong>
                            <span className={`badge ${tool.status === "failed" ? "critical" : "low"}`}>
                              {tool.status === "failed" ? <AlertTriangle size={13} /> : <CheckCircle2 size={13} />}
                              {tool.status}
                            </span>
                          </div>
                          <p className="small">{toolRationale(tool, latestAssessment)}</p>
                        </li>
                      ))}
                    </ul>
                  )}
                </>
              ) : null}

              {rightTab === "timeline" ? (
                <>
                  <div className="tool-row">
                    <strong>Timeline</strong>
                    <span className="badge neutral">
                      <Layers size={13} />
                      {hasIntervention ? `${decisionPointEvents.length + decisionTimeline.length} entries` : "monitoring"}
                    </span>
                  </div>
                  <ul className="intervention-timeline">
                    {normalTelemetryWindowCount > 0 ? (
                      <li className="normal">
                        <span className="trace-time">window</span>
                        <div>
                          <span className="event-code neutral">normal telemetry</span>
                          <p>{normalTelemetryWindowCount} normal telemetry sample(s) scored before this decision point.</p>
                        </div>
                      </li>
                    ) : null}
                    {decisionPointEvents.map((event) => (
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
                    {decisionTimeline.map((trace) => (
                      <li key={trace.trace_id}>
                        <span className="trace-time">{timeLabel(trace.timestamp)}</span>
                        <div>
                          <span className="event-code neutral">{trace.event_type.replaceAll("_", " ")}</span>
                          <p>{trace.message}</p>
                        </div>
                      </li>
                    ))}
                  </ul>
                  <h3 className="section-title">Safety Case</h3>
                  {safetyCase ? (
                    <div className="approval">
                      <strong>{safetyCase.safety_case_id}</strong>
                      <p className="small">{safetyCase.summary}</p>
                      <p className="small muted">{safetyCase.evidence[0]}</p>
                    </div>
                  ) : (
                    <div className="empty compact-empty">No safety case created.</div>
                  )}

                  {latestAssessment?.uncertainty_reason ? (
                    <>
                      <h3 className="section-title">Uncertainty</h3>
                      <div className="approval">
                        <AlertTriangle size={16} /> {latestAssessment.uncertainty_reason}
                      </div>
                    </>
                  ) : null}
                </>
              ) : null}
            </div>
          </section>
        </aside>
      </section>
    </main>
  );
}
