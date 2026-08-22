"use client";

import {
  AlertTriangle,
  CheckCircle2,
  ClipboardCheck,
  Clock3,
  FastForward,
  Gauge,
  Layers,
  MapPin,
  Pause,
  Play,
  RefreshCw,
  ShieldAlert,
  StepForward
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { EventType, ReplayState, RiskBand, VehicleEvent } from "@/lib/types/domain";

type ScenarioMetadata = {
  scenario_id: string;
  name: string;
  description: string;
  primary_vehicle_id: string;
  highlights: string[];
};

type MapZoneView = {
  zoneId: string;
  name: string;
  className: string;
  bounds: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
};

const MAP_ZONES: MapZoneView[] = [
  { zoneId: "YARD-C4", name: "YARD-C4", className: "caution", bounds: { x: 12, y: 18, width: 30, height: 28 } },
  { zoneId: "PPT-LINK-25", name: "PPT-LINK-25", className: "slow", bounds: { x: 58, y: 18, width: 30, height: 28 } },
  { zoneId: "YARD-U2", name: "YARD-U2", className: "restricted", bounds: { x: 12, y: 58, width: 30, height: 28 } },
  { zoneId: "WHARF-C4", name: "WHARF-C4", className: "wharf", bounds: { x: 58, y: 58, width: 30, height: 28 } }
];

const ABNORMAL_EVENTS: EventType[] = ["speeding", "harsh_brake", "sharp_turn", "stale_gps", "risk_persistent"];

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

function formatEventLabel(eventType: EventType) {
  return eventType.replaceAll("_", " ");
}

function eventKey(event: VehicleEvent) {
  return event.event_id;
}

export function NearGuardDashboard() {
  const [scenarios, setScenarios] = useState<ScenarioMetadata[]>([]);
  const [scenarioId, setScenarioId] = useState("pm27-persistent-high-risk");
  const [state, setState] = useState<ReplayState | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [selectedMapVehicle, setSelectedMapVehicle] = useState<string | null>(null);
  const timerRef = useRef<number | null>(null);

  async function start(id = scenarioId) {
    const response = await fetch("/api/replay/start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ scenario_id: id })
    });
    setState(await response.json());
    setIsPlaying(false);
    setSelectedMapVehicle(null);
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
    start(scenarioId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!isPlaying) {
      if (timerRef.current) window.clearInterval(timerRef.current);
      timerRef.current = null;
      return;
    }
    timerRef.current = window.setInterval(() => {
      step();
    }, 1300);
    return () => {
      if (timerRef.current) window.clearInterval(timerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPlaying]);

  const selectedCase = state?.selectedCase ?? null;
  const latestAssessment = state?.latestRiskAssessment ?? null;
  const currentEvent = state?.currentEvent ?? null;
  const currentZone = state?.currentZone ?? null;
  const vehiclePosition = currentEvent?.position ?? currentZone?.center ?? { x: 50, y: 50 };
  const vehicleHeading = currentEvent?.heading_degrees ?? 90;
  const accuracy = currentEvent?.accuracy_m ?? 10;
  const showVehicleDetails = Boolean(selectedMapVehicle && selectedMapVehicle === currentEvent?.vehicle_id);
  const evidenceEvents = useMemo(() => {
    if (!state?.currentEvent) return [];
    const currentTime = new Date(state.currentEvent.timestamp).getTime();
    const tenMinutes = 10 * 60 * 1000;
    return state.selectedScenario.events
      .slice(0, state.currentEventIndex)
      .filter((event) => {
        if (event.vehicle_id !== state.currentEvent?.vehicle_id || !event.position) return false;
        const eventTime = new Date(event.timestamp).getTime();
        return eventTime <= currentTime && currentTime - eventTime <= tenMinutes;
      });
  }, [state]);
  const behaviorEvidence = useMemo(() => {
    const abnormalEvents = evidenceEvents.filter((event) => ABNORMAL_EVENTS.includes(event.event_type));
    return {
      abnormalEvents,
      hasBehaviorSignal: abnormalEvents.length > 0 || currentEvent?.event_type === "speed_normalized"
    };
  }, [currentEvent?.event_type, evidenceEvents]);
  const contextChips = useMemo(() => {
    if (!currentEvent) return [];
    const chips: { label: string; tone: "neutral" | "warning" | "critical" | "low" }[] = [];
    if (!currentZone) chips.push({ label: "zone context missing", tone: "critical" });
    if (currentZone?.slow_down_zone_active) chips.push({ label: "slow-down zone", tone: "warning" });
    if (currentZone?.restriction_level === "restricted") chips.push({ label: "restricted zone", tone: "critical" });
    if (currentZone?.restriction_level === "wharf") chips.push({ label: "wharf context", tone: "warning" });
    if (currentZone?.pedestrian_exposure === "high") chips.push({ label: "pedestrian exposure high", tone: "critical" });
    if (currentZone?.traffic_level === "high") chips.push({ label: "traffic high", tone: "warning" });
    if (currentEvent.gps_freshness !== "fresh") chips.push({ label: `${currentEvent.gps_freshness} GPS`, tone: "critical" });
    if (latestAssessment?.uncertainty_reason) chips.push({ label: "low confidence context", tone: "critical" });
    return chips.length ? chips : [{ label: "context normal", tone: "low" }];
  }, [currentEvent, currentZone, latestAssessment?.uncertainty_reason]);
  const pendingApproval = state?.pendingApprovals.find((approval) => approval.status === "pending") ?? null;
  const safetyCase = state?.safetyCases.at(-1) ?? null;
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
            onClick={() => setIsPlaying((value) => !value)}
            disabled={!state || state.isComplete}
            title={isPlaying ? "Pause replay" : "Auto-play replay"}
          >
            {isPlaying ? <Pause size={16} /> : <Play size={16} />} {isPlaying ? "Pause" : "Play"}
          </button>
        </div>
      </header>

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
              {latestAssessment?.risk_band ?? "Not started"}
            </span>
          </div>
          <div className="panel-body">
            <p className="muted">{state?.selectedScenario.description}</p>
            <div className="evidence-map-heading">
              <div>
                <h3>Risk Evidence Replay</h3>
                <p className="small muted">
                  Recent telemetry window and zone context used to explain the current risk event.
                </p>
              </div>
              <span className="badge neutral">
                <Layers size={13} />
                {currentEvent ? `${evidenceEvents.length} evidence points` : "quiet"}
              </span>
            </div>
            <div className={`prime-map evidence-replay ${currentEvent ? "live" : "waiting"}`} aria-label="Risk evidence replay map">
              <div className="map-grid" />
              <div className="map-route route-top" />
              <div className="map-route route-middle" />
              <div className="map-route route-bottom" />
              <div className="map-route route-left" />
              <div className="map-route route-center" />
              <div className="map-route route-right" />
              {MAP_ZONES.map((zone) => (
                <div
                  className={`map-zone ${zone.className} ${zone.zoneId === currentEvent?.zone_id ? "current evidence-zone" : ""}`}
                  key={zone.zoneId}
                  style={{
                    left: `${zone.bounds.x}%`,
                    top: `${zone.bounds.y}%`,
                    width: `${zone.bounds.width}%`,
                    height: `${zone.bounds.height}%`
                  }}
                >
                  <span>{zone.name}</span>
                </div>
              ))}
              {evidenceEvents.slice(0, -1).map((event, index) => {
                const nextEvent = evidenceEvents[index + 1];
                if (!event.position || !nextEvent?.position) return null;
                const left = Math.min(event.position.x, nextEvent.position.x);
                const top = Math.min(event.position.y, nextEvent.position.y);
                const width = Math.max(Math.abs(nextEvent.position.x - event.position.x), 1);
                const height = Math.max(Math.abs(nextEvent.position.y - event.position.y), 1);
                return (
                  <div
                    className={`evidence-segment ${eventSeverityClass(nextEvent)}`}
                    key={`${event.event_id}-${nextEvent.event_id}`}
                    style={{
                      left: `${left}%`,
                      top: `${top}%`,
                      width: `${width}%`,
                      height: `${height}%`
                    }}
                  />
                );
              })}
              {evidenceEvents.map((event) =>
                event.position ? (
                  <div
                    className={`evidence-point ${eventSeverityClass(event)} ${event.event_id === currentEvent?.event_id ? "trigger" : ""}`}
                    key={eventKey(event)}
                    style={{
                      left: `${event.position.x}%`,
                      top: `${event.position.y}%`
                    }}
                    title={`${event.vehicle_id} ${formatEventLabel(event.event_type)}`}
                  >
                    <span>{formatEventLabel(event.event_type)}</span>
                  </div>
                ) : null
              )}
              {latestAssessment ? (
                <div
                  className={`risk-horizon ${bandClass(latestAssessment.risk_band)}`}
                  style={{
                    left: `${vehiclePosition.x}%`,
                    top: `${vehiclePosition.y}%`,
                    transform: `translate(-50%, -50%) rotate(${vehicleHeading}deg) scale(${0.8 + latestAssessment.safety_incident_risk_score * 0.55})`
                  }}
                />
              ) : null}
              {currentEvent ? (
                <>
                  <div
                    className={`gps-accuracy ${currentEvent.gps_freshness}`}
                    style={{
                      left: `${vehiclePosition.x}%`,
                      top: `${vehiclePosition.y}%`,
                      width: `${Math.max(34, accuracy * 2.1)}px`,
                      height: `${Math.max(34, accuracy * 2.1)}px`
                    }}
                  />
                  <button
                    className={`vehicle-marker evidence-trigger ${bandClass(latestAssessment?.risk_band)} ${currentEvent.event_type}`}
                    style={{
                      left: `${vehiclePosition.x}%`,
                      top: `${vehiclePosition.y}%`
                    }}
                    type="button"
                    title={`Open ${currentEvent.vehicle_id} telemetry`}
                    onClick={() =>
                      setSelectedMapVehicle((value) => (value === currentEvent.vehicle_id ? null : currentEvent.vehicle_id))
                    }
                  >
                    <span className="vehicle-heading" style={{ transform: `rotate(${vehicleHeading}deg)` }}>
                      <span className="topdown-truck active">
                        <span className="truck-cab" />
                        <span className="truck-trailer" />
                      </span>
                    </span>
                    <span className="vehicle-label">{currentEvent.vehicle_id}</span>
                    <span className="trigger-label">{formatEventLabel(currentEvent.event_type)}</span>
                  </button>
                </>
              ) : (
                <div className="map-empty">Evidence replay starts after a risk assessment.</div>
              )}
              {currentEvent ? (
                <div className="context-chip-row">
                  {contextChips.map((chip) => (
                    <span className={`context-chip ${chip.tone}`} key={chip.label}>
                      {chip.label}
                    </span>
                  ))}
                </div>
              ) : null}
              {showVehicleDetails ? (
                <div className="map-popover">
                  <div className="tool-row">
                    <strong>{currentEvent?.vehicle_id}</strong>
                    <span className={`badge ${bandClass(latestAssessment?.risk_band)}`}>{latestAssessment?.risk_band ?? "Monitoring"}</span>
                  </div>
                  <p className="small muted">{currentZone?.zone_name ?? "Zone context unavailable"}</p>
                  <div className="map-popover-grid">
                    <span>
                      <Gauge size={13} /> {currentEvent?.speed}/{currentEvent?.speed_limit} km/h
                    </span>
                    <span>
                      <MapPin size={13} /> {currentEvent?.gps_freshness}
                    </span>
                    <span>Over limit {state?.latestFeatures?.speed_over_limit ?? 0} km/h</span>
                    <span>{behaviorEvidence.abnormalEvents.length} abnormal events</span>
                  </div>
                  {latestAssessment?.top_risk_reasons.length ? (
                    <ul className="popover-reasons">
                      {latestAssessment.top_risk_reasons.slice(0, 3).map((reason) => (
                        <li key={reason}>{reason}</li>
                      ))}
                    </ul>
                  ) : null}
                  <p className="small">{selectedCase?.recommended_action ?? "Collecting telemetry."}</p>
                </div>
              ) : null}
            </div>
            <div className="grid-two">
              <div className="metric">
                <p className="metric-label">Synthetic Near-Miss Risk</p>
                <p className="metric-value">{latestAssessment ? latestAssessment.safety_incident_risk_score.toFixed(2) : "--"}</p>
              </div>
              <div className="metric">
                <p className="metric-label">Horizon / Evidence</p>
                <p className="metric-value">
                  {latestAssessment ? `${latestAssessment.prediction_horizon} / ${latestAssessment.evidence_authority}` : "--"}
                </p>
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
          <section className="panel">
            <div className="panel-header">
              <h3>Interventions</h3>
              <FastForward size={16} />
            </div>
            <div className="panel-body">
              <div className="kv">
                <span>Recommended Action</span>
                <strong>{selectedCase?.recommended_action ?? "Awaiting telemetry."}</strong>
              </div>
              <div className="kv" style={{ marginTop: 8 }}>
                <span>Authority</span>
                <strong>{selectedCase?.authority_class ?? "--"}</strong>
              </div>

              <h3 className="section-title">Tool Calls</h3>
              {!state?.toolCalls.length ? (
                <div className="empty">No tools called yet.</div>
              ) : (
                <ul className="tool-list">
                  {state.toolCalls.map((tool) => (
                    <li key={tool.tool_call_id}>
                      <div className="tool-row">
                        <strong>{tool.tool_name}</strong>
                        <span className={`badge ${tool.status === "failed" ? "critical" : "low"}`}>
                          {tool.status === "failed" ? <AlertTriangle size={13} /> : <CheckCircle2 size={13} />}
                          {tool.status}
                        </span>
                      </div>
                      <p className="small muted">{tool.error ?? tool.result}</p>
                    </li>
                  ))}
                </ul>
              )}

              <h3 className="section-title">Approval</h3>
              {pendingApproval ? (
                <div className="approval">
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
                <div className="empty">No pending approval.</div>
              )}

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
              <h3>Execution Trace</h3>
              <Clock3 size={16} />
            </div>
            <div className="panel-body">
              {!state?.traceEvents.length ? (
                <div className="empty">Trace starts when replay begins.</div>
              ) : (
                <ul className="trace-list">
                  {state.traceEvents.map((item) => (
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
