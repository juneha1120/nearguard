"use client";

import {
  AlertTriangle,
  Bot,
  BrainCircuit,
  CheckCircle2,
  ClipboardCheck,
  Clock3,
  Cpu,
  FastForward,
  FileSearch,
  Layers,
  Pause,
  Play,
  RefreshCw,
  ShieldAlert,
  Sparkles,
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
  eventSignalClass,
  explainAction,
  gpsSeverityClass,
  isDecisionPointEvent,
  liveModelAssessment,
  livePredictionKey,
  liveRiskLevel,
  restrictionSeverityClass,
  riskPercent,
  scoreSeverityClass,
  scoreSeverityLabel,
  speedSeverityClass,
  timeLabel,
  toolLabel,
  toolRationale,
  trafficLevelFromPressure,
  trafficSeverityClass,
  trendSeverityClass,
  weatherSeverityClass,
  zoneFlags,
  zoneRiskClass,
  traceCategoryClass,
  traceLabel,
  type ScenarioMetadata,
  type ZoneRiskCard
} from "@/components/dashboard/dashboard-utils";
import { calculateZoneOperationalRisk, assessLiveVehicleNearMissRisk } from "@/lib/model/live-risk";
import {
  applyWorkerReportToLiveSample,
  describeWorkerReportInfluence,
  workerReportApplicationState
} from "@/lib/model/report-enrichment";
import type {
  LivePrediction,
  LiveTelemetrySample,
  ReplayState,
  ReviewOutcome,
  ScenarioTelemetrySample,
  ScenarioZoneTelemetrySample,
  WorkerRiskReport,
  ZoneRegistryEntry
} from "@/lib/types/domain";

export function NearGuardDashboard() {
  const [scenarios, setScenarios] = useState<ScenarioMetadata[]>([]);
  const [zones, setZones] = useState<ZoneRegistryEntry[]>([]);
  const [liveSamples, setLiveSamples] = useState<LiveTelemetrySample[]>([]);
  const [livePredictions, setLivePredictions] = useState<LivePrediction[]>([]);
  const [livePredictionSampleId, setLivePredictionSampleId] = useState<string | null>(null);
  const [scenarioTelemetrySamples, setScenarioTelemetrySamples] = useState<ScenarioTelemetrySample[]>([]);
  const [scenarioZoneTelemetrySamples, setScenarioZoneTelemetrySamples] = useState<ScenarioZoneTelemetrySample[]>([]);
  const [liveSampleIndex, setLiveSampleIndex] = useState(0);
  const [scenarioClockMs, setScenarioClockMs] = useState<number | null>(null);
  const [scenarioId, setScenarioId] = useState("pm27-persistent-high-risk");
  const [state, setState] = useState<ReplayState | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [introScenario, setIntroScenario] = useState<ReplayState["selectedScenario"] | null>(null);
  const [rightPanelView, setRightPanelView] = useState<"assessment" | "report">("assessment");
  const [assessmentTab, setAssessmentTab] = useState<"action" | "timeline">("action");
  const [selectedLiveVehicleId, setSelectedLiveVehicleId] = useState<string | null>(null);
  const [reportDescription, setReportDescription] = useState(
    "Near the wharf, visibility around the container stack is poor and workers are crossing often."
  );
  const [workerReport, setWorkerReport] = useState<WorkerRiskReport | null>(null);
  const [isWorkerReportResolved, setIsWorkerReportResolved] = useState(false);
  const [isExtractingReport, setIsExtractingReport] = useState(false);
  const [reportExtractionError, setReportExtractionError] = useState<string | null>(null);
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
    setLiveSampleIndex(0);
    setScenarioClockMs(nextState.selectedScenario.events[0] ? new Date(nextState.selectedScenario.events[0].timestamp).getTime() : null);
    setIntroScenario(nextState.selectedScenario);
    setSelectedLiveVehicleId(null);
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
    setIntroScenario(null);
    setLiveSampleIndex(0);
    setScenarioClockMs(null);
    setScenarioTelemetrySamples([]);
    setScenarioZoneTelemetrySamples([]);
  }

  async function step() {
    setIsPlaying(false);
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

  async function reviewEvidence(reviewId: string, outcome: ReviewOutcome) {
    const response = await fetch("/api/replay/review", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ review_id: reviewId, outcome })
    });
    setState(await response.json());
  }

  async function approve(approvalId: string, approved: boolean) {
    const response = await fetch("/api/replay/approve", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ approval_id: approvalId, approved })
    });
    setState(await response.json());
  }

  async function extractWorkerReport() {
    const description = reportDescription.trim();
    if (!description || isExtractingReport) return;

    setIsExtractingReport(true);
    setReportExtractionError(null);
    try {
      const response = await fetch("/api/worker-reports/extract", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ description, reporter_role: "daily_safety_report" })
      });
      const payload = (await response.json()) as { report?: WorkerRiskReport; error?: string };
      if (!response.ok || !payload.report) {
        throw new Error(payload.error ?? "Worker report extraction failed.");
      }
      setWorkerReport(payload.report);
      setIsWorkerReportResolved(false);
    } catch (error) {
      setReportExtractionError(error instanceof Error ? error.message : "Worker report extraction failed.");
    } finally {
      setIsExtractingReport(false);
    }
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
      .then((payload) => {
        setLiveSamples(payload.samples);
      });
    start(scenarioId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (state) {
      if (liveTimerRef.current) window.clearInterval(liveTimerRef.current);
      liveTimerRef.current = null;
      return;
    }

    liveTimerRef.current = window.setInterval(() => {
      setLiveSampleIndex((index) => {
        if (!liveSamples.length) return 0;
        return (index + 1) % liveSamples.length;
      });
    }, 1000);
    return () => {
      if (liveTimerRef.current) window.clearInterval(liveTimerRef.current);
    };
  }, [liveSamples.length, state]);

  const nextDecisionTargetMs = useMemo(() => {
    if (!state || state.isComplete) return null;
    const event = state.selectedScenario.events.find((candidate, index) => index >= state.currentEventIndex && isDecisionPointEvent(candidate));
    return event ? new Date(event.timestamp).getTime() : null;
  }, [state]);

  useEffect(() => {
    if (!isPlaying) {
      if (timerRef.current) window.clearInterval(timerRef.current);
      timerRef.current = null;
      return;
    }
    if (!state || nextDecisionTargetMs === null) {
      setIsPlaying(false);
      return;
    }

    timerRef.current = window.setInterval(() => {
      setScenarioClockMs((currentClockMs) => {
        const current = currentClockMs ?? nextDecisionTargetMs;
        const nextClockMs = Math.min(current + 1000, nextDecisionTargetMs);

        if (nextClockMs >= nextDecisionTargetMs) {
          if (timerRef.current) window.clearInterval(timerRef.current);
          timerRef.current = null;
          void step();
        }

        return nextClockMs;
      });
    }, 1000);
    return () => {
      if (timerRef.current) window.clearInterval(timerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPlaying, nextDecisionTargetMs, state]);

  const selectedCase = state?.selectedCase ?? null;
  const latestAssessment = state?.latestRiskAssessment ?? null;
  const currentEvent = state?.currentEvent ?? null;
  const isScenarioMode = Boolean(state);
  const rawLiveSample = liveSamples[liveSampleIndex] ?? null;
  const livePredictionBySampleVehicle = useMemo(() => {
    const predictions = new Map<string, LivePrediction>();
    for (const prediction of livePredictions) {
      predictions.set(livePredictionKey(prediction.sample_id, prediction.vehicle_id), prediction);
    }
    return predictions;
  }, [livePredictions]);
  useEffect(() => {
    if (state || !rawLiveSample) return;

    let isCancelled = false;
    fetch(`/api/live-risk-predictions?sample_id=${encodeURIComponent(rawLiveSample.sample_id)}`)
      .then((response) => response.json())
      .then((payload) => {
        if (isCancelled) return;
        const predictions = (payload.predictions ?? []) as LivePrediction[];
        if (predictions.length) setLivePredictionSampleId(rawLiveSample.sample_id);
        setLivePredictions((current) => {
          const retained = current.filter((prediction) => prediction.sample_id !== rawLiveSample.sample_id);
          return [...retained, ...predictions].slice(-240);
        });
      })
      .catch(() => {
        // The API route falls back to exported predictions; keep the previous tick if even that fails.
      });

    return () => {
      isCancelled = true;
    };
  }, [rawLiveSample, state]);
  const latestLivePredictions = useMemo(
    () => livePredictions.filter((prediction) => prediction.sample_id === livePredictionSampleId),
    [livePredictionSampleId, livePredictions]
  );
  const latestLivePredictionByVehicle = useMemo(() => {
    const predictions = new Map<string, LivePrediction>();
    for (const prediction of latestLivePredictions) {
      predictions.set(prediction.vehicle_id, prediction);
    }
    return predictions;
  }, [latestLivePredictions]);
  const highestRiskLiveVehicleId = useMemo(() => {
    return (
      latestLivePredictions.reduce<LivePrediction | null>((highest, prediction) => {
        if (!highest) return prediction;
        return prediction.assessment.safety_incident_risk_score > highest.assessment.safety_incident_risk_score ? prediction : highest;
      }, null)?.vehicle_id ?? null
    );
  }, [latestLivePredictions]);
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
  const activeWorkerReport = isWorkerReportResolved ? null : workerReport;
  const workerReportState = useMemo(() => workerReportApplicationState(liveSample, activeWorkerReport), [activeWorkerReport, liveSample]);
  const enrichedLiveSample = useMemo(() => applyWorkerReportToLiveSample(liveSample, activeWorkerReport), [activeWorkerReport, liveSample]);
  const workerReportZoneRisk = useMemo(() => {
    if (!activeWorkerReport?.zone_id) return null;
    const baselineZone = liveSample?.zones.find((zone) => zone.zone_id === activeWorkerReport.zone_id) ?? null;
    const enrichedZone = enrichedLiveSample?.zones.find((zone) => zone.zone_id === activeWorkerReport.zone_id) ?? null;
    if (!baselineZone || !enrichedZone) return null;

    const before = calculateZoneOperationalRisk(baselineZone);
    const after = calculateZoneOperationalRisk(enrichedZone);
    return {
      before,
      after,
      delta: Number((after - before).toFixed(3))
    };
  }, [activeWorkerReport, enrichedLiveSample, liveSample]);
  const workerReportInfluencedFeatures = useMemo(
    () => describeWorkerReportInfluence(liveSample, activeWorkerReport),
    [activeWorkerReport, liveSample]
  );
  const workerReportStateCopy = isWorkerReportResolved && workerReport
    ? "Resolved"
    : {
        empty: "No report extracted",
        applied: "Applied to zone risk",
        held_for_review: "Held for review",
        missing_zone: "Zone not extracted",
        zone_not_in_view: "Zone not in current view"
      }[workerReportState];
  const workerReportBadgeClass = isWorkerReportResolved
    ? "neutral"
    : workerReport
      ? confidenceSeverityClass(workerReport.extraction_confidence)
      : "neutral";
  const liveSignalSample = useMemo(() => {
    if (isScenarioMode) return enrichedLiveSample;
    if (!livePredictionSampleId) return enrichedLiveSample;
    return applyWorkerReportToLiveSample(
      liveSamples.find((sample) => sample.sample_id === livePredictionSampleId) ?? enrichedLiveSample,
      activeWorkerReport
    );
  }, [activeWorkerReport, enrichedLiveSample, isScenarioMode, livePredictionSampleId, liveSamples]);
  const zoneRiskCards = useMemo<ZoneRiskCard[]>(
    () =>
      zones.map((zone) => {
        const live = enrichedLiveSample?.zones.find((item) => item.zone_id === zone.zone_id) ?? null;
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
    [enrichedLiveSample?.zones, zones]
  );
  const selectedLiveVehicle = useMemo(() => {
    const liveZones = liveSignalSample?.zones ?? [];
    const preferredVehicleId = selectedLiveVehicleId ?? (!isScenarioMode ? highestRiskLiveVehicleId : null);

    for (const liveZone of liveZones) {
      const mover = liveZone.prime_movers.find((item) => item.vehicle_id === preferredVehicleId);
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
  }, [highestRiskLiveVehicleId, isScenarioMode, liveSignalSample?.zones, selectedLiveVehicleId, zones]);
  const liveVehiclePrediction = useMemo(() => {
    if (isScenarioMode || !selectedLiveVehicle) return null;
    return latestLivePredictionByVehicle.get(selectedLiveVehicle.mover.vehicle_id) ?? null;
  }, [isScenarioMode, latestLivePredictionByVehicle, selectedLiveVehicle]);
  const reportAdjustedLiveAssessment = useMemo(() => {
    if (isScenarioMode || !activeWorkerReport || activeWorkerReport.extraction_confidence === "low" || !selectedLiveVehicle || !liveSignalSample) return null;
    if (activeWorkerReport.zone_id && activeWorkerReport.zone_id !== selectedLiveVehicle.liveZone.zone_id) return null;
    if (activeWorkerReport.vehicle_id && activeWorkerReport.vehicle_id !== selectedLiveVehicle.mover.vehicle_id) return null;
    return assessLiveVehicleNearMissRisk(
      [liveSignalSample],
      liveSignalSample,
      selectedLiveVehicle.liveZone,
      selectedLiveVehicle.mover,
      selectedLiveVehicle.zone
    );
  }, [activeWorkerReport, isScenarioMode, liveSignalSample, selectedLiveVehicle]);
  const liveVehicleAssessment = useMemo(() => {
    if (reportAdjustedLiveAssessment) return reportAdjustedLiveAssessment;
    if (!liveVehiclePrediction) return null;
    return liveModelAssessment(liveVehiclePrediction);
  }, [liveVehiclePrediction, reportAdjustedLiveAssessment]);
  const pendingReview = state?.pendingReviews.find((review) => review.status === "pending") ?? null;
  const pendingApproval = state?.pendingApprovals.find((approval) => approval.status === "pending") ?? null;
  const hasIntervention = Boolean(
    pendingReview ||
      pendingApproval ||
      state?.toolCalls.length ||
      (latestAssessment && ["High", "Persistent High", "Critical / Low Confidence"].includes(latestAssessment.risk_band))
  );
  const actionExplanation = useMemo(
    () => explainAction(selectedCase, latestAssessment, pendingApproval),
    [latestAssessment, pendingApproval, selectedCase]
  );
  const latestDriverAdvisory =
    state?.toolCalls
      .slice()
      .reverse()
      .find((tool) => tool.tool_name === "notify_driver" && tool.status === "delivered") ?? null;
  const assessmentStatusCopy = pendingReview ? "Review" : pendingApproval ? "Authorization" : latestDriverAdvisory ? "Advisory sent" : selectedCase?.authority_class ?? "Idle";
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
            <p>Human-in-the-loop Prime Mover Safety Risk</p>
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
            onClick={() => setIsPlaying((value) => !value)}
            disabled={!state || state.isComplete || nextDecisionTargetMs === null}
            title={isPlaying ? "Pause replay" : "Play replay until the next decision"}
          >
            {isPlaying ? <Pause size={16} /> : <Play size={16} />} {isPlaying ? "Pause" : "Play"}
          </button>
        </div>
      </header>

      {introScenario ? (
        <div className="modal-backdrop" role="presentation">
          <section className="scenario-modal" role="dialog" aria-modal="true" aria-labelledby="scenario-modal-title">
            <span className="scenario-modal-kicker">Scenario selected</span>
            <h2 id="scenario-modal-title">{introScenario.name}</h2>
            <p>{introScenario.description}</p>
            <ul>
              {introScenario.highlights.map((highlight) => (
                <li key={highlight}>{highlight}</li>
              ))}
            </ul>
            <div className="scenario-modal-footer">
              <span>
                {introScenario.events.filter(isDecisionPointEvent).length} decisions - clock paused
              </span>
              <button className="primary-button" type="button" onClick={() => setIntroScenario(null)}>
                OK
              </button>
            </div>
          </section>
        </div>
      ) : null}

      <section className="dashboard">
        <section className="panel live-dashboard-panel">
          <div className="panel-header">
            <div>
              <h2>{isScenarioMode ? "Scenario Replay Monitor" : "Zone Monitor"}</h2>
            </div>
            <span className={`badge ${bandClass(latestAssessment?.risk_band)}`}>
              <ShieldAlert size={14} />
              {isScenarioMode ? (isPlaying ? "Playing" : state?.isComplete ? "Complete" : "Paused") : hasIntervention ? (latestAssessment?.risk_band ?? "Review") : "Monitoring"}
            </span>
          </div>
          <div className="panel-body">
            <div className="live-monitor" aria-label="Live zone telemetry monitor">
              <div className="live-monitor-header">
                <div>
                  <strong>
                    {isScenarioMode
                      ? state?.isComplete
                        ? "Scenario complete"
                        : isPlaying
                          ? "Replaying toward next decision point"
                          : "Scenario clock paused"
                      : hasIntervention
                        ? "Vehicle risk crossed an intervention threshold"
                        : "Continuous assessment active"}
                  </strong>
                </div>
                <div className="live-clock">
                  <Clock3 size={14} />
                  <span>{liveSample ? timeLabel(liveSample.timestamp) : "--:--:--"}</span>
                  <i className={`live-dot ${isScenarioMode ? (isPlaying ? "active" : "paused") : ""}`} />
                </div>
              </div>
              <div className="zone-risk-board">
                {zoneRiskCards.map((card) => {
                  const isReportEnrichedZone = workerReportState === "applied" && workerReport?.zone_id === card.zone.zone_id;
                  const isSelectedVehicleZone =
                    Boolean(selectedLiveVehicleId) &&
                    Boolean(card.live?.prime_movers.some((mover) => mover.vehicle_id === selectedLiveVehicleId));

                  return (
                    <article
                      className={`zone-live-card ${card.className} ${card.zone.zone_id === currentEvent?.zone_id ? "current" : ""} ${
                        isReportEnrichedZone ? "report-enriched" : ""
                      } ${isSelectedVehicleZone ? "selected-vehicle-zone" : ""}`}
                      key={card.zone.zone_id}
                    >
                    <div className="zone-live-top">
                      <div>
                        <strong>{card.zone.zone_name}</strong>
                        <p className="small muted">
                          {card.zone.zone_id} - {card.live?.active_prime_movers ?? 0} PMs
                        </p>
                      </div>
                      <div className="zone-badge-stack">
                        {isReportEnrichedZone ? (
                          <span className="badge report">
                            <Sparkles size={13} /> Report enriched
                          </span>
                        ) : null}
                        <span className={`badge ${card.className}`}>{card.level}</span>
                      </div>
                    </div>
                    <div className="risk-meter" aria-hidden="true">
                      <span style={{ width: riskPercent(card.operationalRisk) }} />
                    </div>
                    <div className="zone-live-grid">
                      <span className={scoreSeverityClass(card.operationalRisk)}>
                        Zone Risk <strong>{card.operationalRisk.toFixed(2)}</strong>
                      </span>
                      <span className={trafficSeverityClass(trafficLevelFromPressure(card.live?.traffic_pressure))}>
                        Traffic <strong>{trafficLevelFromPressure(card.live?.traffic_pressure) ?? "--"}</strong>
                      </span>
                      <span className={weatherSeverityClass(card.live?.weather)}>
                        Weather <strong>{card.live ? card.live.weather.replace("_", " ") : "--"}</strong>
                      </span>
                      <span className={restrictionSeverityClass(card.live?.restriction_level)}>
                        Restriction <strong>{card.live?.restriction_level ?? "--"}</strong>
                      </span>
                      <span className={trafficSeverityClass(card.live?.pedestrian_exposure)}>
                        Pedestrian <strong>{card.live?.pedestrian_exposure ?? "--"}</strong>
                      </span>
                      <span className={speedSeverityClass(card.live?.avg_speed, card.live?.prime_movers[0]?.speed_limit)}>
                        Avg Speed <strong>{card.live ? `${card.live.avg_speed} km/h` : "--"}</strong>
                      </span>
                    </div>
                    {card.flags.length ? (
                      <div className="zone-flag-row">
                        {card.flags.slice(0, 3).map((flag) => (
                          <em key={flag}>{flag}</em>
                        ))}
                      </div>
                    ) : null}
                    <ul className="prime-mover-list">
                      {(card.live?.prime_movers ?? []).map((mover) => {
                        const prediction =
                          liveSample && !isScenarioMode
                            ? livePredictionBySampleVehicle.get(livePredictionKey(liveSample.sample_id, mover.vehicle_id)) ??
                              latestLivePredictionByVehicle.get(mover.vehicle_id)
                            : null;

                        return (
                          <li
                            className={`${scoreSeverityClass(prediction?.assessment.safety_incident_risk_score ?? null)} ${
                              selectedLiveVehicleId === mover.vehicle_id ? "selected" : ""
                            }`}
                            key={mover.vehicle_id}
                          >
                            <button
                              aria-pressed={selectedLiveVehicleId === mover.vehicle_id}
                              type="button"
                              onClick={() => setSelectedLiveVehicleId(mover.vehicle_id)}
                            >
                              <span>{mover.vehicle_id}</span>
                              <strong>{mover.speed} km/h</strong>
                              <small>
                                limit {mover.speed_limit} km/h
                                <em className={`state-tag ${eventSignalClass(mover.state)}`}>{mover.state}</em>
                              </small>
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                    </article>
                  );
                })}
              </div>
            </div>
          </div>
        </section>

        <aside className="snapshot-column">
          <section className="panel vehicle-signal-panel">
            <div className="panel-header">
              <h3>
                Vehicle Signal
                {selectedLiveVehicleId ? <span className="vehicle-signal-selection">{selectedLiveVehicleId}</span> : null}
              </h3>
              <span className={`badge ${signalRiskClass}`}>
                {signalRiskLabel}
              </span>
            </div>
            <div className="panel-body">
              <div className="signal-metrics">
                <div className={`metric signal-card ${scoreSeverityClass(signalRisk)}`}>
                  <p className="metric-label">Next 15m Synthetic Risk</p>
                  <p className="metric-value">{signalRisk === null ? "--" : signalRisk.toFixed(2)}</p>
                </div>
                <div className={`metric signal-card ${confidenceSeverityClass(signalConfidence)}`}>
                  <p className="metric-label">Confidence</p>
                  <p className="metric-value">{signalConfidence}</p>
                </div>
              </div>

              <h3 className="section-title">{selectedLiveVehicleId ? "Selected Vehicle" : signalUsesLiveVehicle ? "Selected Vehicle" : "Current Event"}</h3>
              <div className="kv-grid compact vehicle-identity-grid">
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
              <div className="kv-grid compact rolling-feature-grid">
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
              <div className="kv-grid compact surrounding-motion-grid">
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
            </div>
          </section>
        </aside>

        <aside className="right-column">
          <section className="panel priority-panel">
            <div className="panel-header">
              <div className="panel-title-switch" role="tablist" aria-label="Right panel view">
                <button
                  className={rightPanelView === "assessment" ? "active" : ""}
                  onClick={() => setRightPanelView("assessment")}
                  type="button"
                >
                  Risk Assessment
                </button>
                <button className={rightPanelView === "report" ? "active" : ""} onClick={() => setRightPanelView("report")} type="button">
                  Report Intelligence
                </button>
              </div>
            </div>
            {rightPanelView === "assessment" ? (
              <>
                <div className="scenario-context">
                  <span>{isScenarioMode ? "Scenario" : "Mode"}</span>
                  <strong>{state?.selectedScenario.name ?? "Live monitoring"}</strong>
                </div>
                <div className="tab-bar" role="tablist" aria-label="Risk assessment details">
                  <button className={assessmentTab === "action" ? "active" : ""} onClick={() => setAssessmentTab("action")} type="button">
                    Action
                  </button>
                  <button className={assessmentTab === "timeline" ? "active" : ""} onClick={() => setAssessmentTab("timeline")} type="button">
                    Timeline
                  </button>
                </div>
              </>
            ) : null}
            <div className="panel-body">
              {rightPanelView === "assessment" && assessmentTab === "action" ? (
                <>
                  <div className="priority-action">
                    <div className="tool-row">
                      <div className="ai-card-kicker">
                        <Cpu size={14} />
                        <span>Model Risk Evaluation</span>
                      </div>
                      <span className={`badge ${actionExplanation.statusClass}`}>
                        <FastForward size={14} />
                        {assessmentStatusCopy}
                      </span>
                    </div>
                    <strong>{actionExplanation.title}</strong>
                    <div className="confidence-strip" aria-hidden="true">
                      <i className={actionExplanation.statusClass} />
                      <i className={signalRiskClass} />
                      <i className={workerReportBadgeClass} />
                    </div>
                  </div>

                  <h3 className="section-title">Human Review - Evidence Quality</h3>
                  {pendingReview ? (
                    <div className="approval priority-approval">
                      <div className="approval-step">
                        <span>REVIEW</span>
                        <strong>Evidence review required</strong>
                      </div>
                      <strong>{pendingReview.reason}</strong>
                      <p className="small muted">Review changes case handling only. It does not authorize a zone advisory.</p>
                      <div className="approval-actions">
                        <button className="primary-button" onClick={() => reviewEvidence(pendingReview.review_id, "continue_monitoring")}>
                          <ClipboardCheck size={16} /> Continue Monitoring
                        </button>
                        <button className="icon-button" onClick={() => reviewEvidence(pendingReview.review_id, "escalate")}>
                          Escalate
                        </button>
                        <button className="icon-button" onClick={() => reviewEvidence(pendingReview.review_id, "insufficient_evidence")}>
                          Evidence Insufficient
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="empty compact-empty">No evidence review pending.</div>
                  )}

                  <h3 className="section-title">Human Authorization - Disruptive Action</h3>
                  {pendingApproval ? (
                    <div className="approval priority-approval">
                      <div className="approval-step">
                        <span>AUTHORIZE</span>
                        <strong>Zone action authorization</strong>
                      </div>
                      <strong>{pendingApproval.requested_action}</strong>
                      <p className="small muted">{pendingApproval.rationale}</p>
                      <div className="approval-actions">
                        <button className="primary-button" onClick={() => approve(pendingApproval.approval_id, true)}>
                          <ClipboardCheck size={16} /> Authorize
                        </button>
                        <button className="icon-button" onClick={() => approve(pendingApproval.approval_id, false)}>
                          Reject
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="empty compact-empty">No disruptive action authorization pending.</div>
                  )}

                  <h3 className="section-title">Policy Rationale</h3>
                  <ul className="rationale-list">
                    {actionExplanation.rationale.map((item) => (
                      <li key={item}>
                        <span className="rationale-dot" aria-hidden="true" />
                        {item}
                      </li>
                    ))}
                  </ul>

                  <h3 className="section-title">Agent-Coordinated Actions</h3>
                  {!state?.toolCalls.length ? (
                    <div className="empty compact-empty">No tools called yet.</div>
                  ) : (
                    <ul className="tool-list rationale-tools">
                      {state.toolCalls.slice(-3).map((tool) => (
                        <li className="task-row" key={tool.tool_call_id}>
                          <div className="tool-row">
                            <strong>
                              <span className={`task-status-dot ${tool.status === "failed" ? "failed" : "complete"}`} />
                              {toolLabel(tool.tool_name)}
                            </strong>
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

              {rightPanelView === "report" ? (
                <>
                  <div className="worker-report-box">
                    <div className="ai-card-kicker">
                      <BrainCircuit size={14} />
                      <span>Context Extraction</span>
                    </div>
                    <label htmlFor="worker-report-description">Field Worker Safety Note / Shift Log</label>
                    <textarea
                      id="worker-report-description"
                      value={reportDescription}
                      onChange={(event) => setReportDescription(event.target.value)}
                      placeholder="e.g. Near wharf 3, visibility around container stack is poor and workers are crossing often."
                      rows={4}
                    />
                    <button
                      className="primary-button"
                      type="button"
                      onClick={extractWorkerReport}
                      disabled={isExtractingReport || !reportDescription.trim()}
                    >
                      <FileSearch size={16} /> {isExtractingReport ? "Extracting Context..." : "Extract Context"}
                    </button>
                    {reportExtractionError ? (
                      <div className="report-error">
                        <AlertTriangle size={15} /> {reportExtractionError}
                      </div>
                    ) : null}
                    {workerReport ? (
                      <div className="report-result">
                        <div className="tool-row">
                          <strong>
                            <Bot size={14} /> Parsed Operational Context
                          </strong>
                          <span className={`badge ${workerReportBadgeClass}`}>{workerReportStateCopy}</span>
                        </div>
                        <div className="context-card-source">
                          <span>Field Worker Safety Note</span>
                          <strong>{workerReport.extracted_context.operational_note.length} chars</strong>
                        </div>
                        <div className="report-flow">
                          <span>
                            Report <strong>{workerReport.extraction_confidence} confidence</strong>
                          </span>
                          <span>
                            Inputs <strong>{workerReportInfluencedFeatures.length} changed</strong>
                          </span>
                          <span>
                            Zone Risk{" "}
                            <strong>
                              {workerReportZoneRisk ? `${workerReportZoneRisk.before.toFixed(2)} -> ${workerReportZoneRisk.after.toFixed(2)}` : "--"}
                            </strong>
                          </span>
                        </div>
                        <div className="report-context-grid">
                          <span>
                            Hazard <strong>{workerReport.extracted_context.hazard_type.replaceAll("_", " ")}</strong>
                          </span>
                          <span>
                            Zone <strong>{workerReport.extracted_context.zone_id ?? "--"}</strong>
                          </span>
                          <span>
                            Vehicle <strong>{workerReport.extracted_context.vehicle_id ?? "--"}</strong>
                          </span>
                          <span>
                            Severity <strong>{workerReport.extracted_context.reported_severity}</strong>
                          </span>
                        </div>
                        <p className="small">{workerReport.extracted_context.operational_note}</p>
                        <div className="report-actions">
                          <button
                            className={isWorkerReportResolved ? "primary-button" : "icon-button"}
                            type="button"
                            onClick={() => setIsWorkerReportResolved((resolved) => !resolved)}
                          >
                            {isWorkerReportResolved ? "Reopen report" : "Resolve report"}
                          </button>
                        </div>
                        {workerReportInfluencedFeatures.length ? (
                          <div className="report-input-list">
                            {workerReportInfluencedFeatures.map((feature) => (
                              <div key={feature.field}>
                                <span>{feature.label}</span>
                                <strong>
                                  {feature.before} {"->"} {feature.after}
                                </strong>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <div className="empty compact-empty">No zone inputs changed.</div>
                        )}
                        <div className="zone-flag-row">
                          {workerReport.extracted_context.model_feature_impacts.map((impact) => (
                            <em key={impact}>{impact.replaceAll("_", " ")}</em>
                          ))}
                        </div>
                      </div>
                    ) : (
                      <div className="empty compact-empty">No worker report ingested yet.</div>
                    )}
                  </div>
                </>
              ) : null}

              {rightPanelView === "assessment" && assessmentTab === "timeline" ? (
                <>
                  <div className="tool-row">
                    <strong>Decision & Action Timeline</strong>
                    <span className="badge neutral">
                      <Layers size={13} />
                      {decisionTimeline.length > 0 ? `${decisionTimeline.length} entries` : "monitoring"}
                    </span>
                  </div>
                  <ul className="intervention-timeline">
                    {decisionTimeline.map((trace) => {
                      const categoryClass = traceCategoryClass(trace.event_type);
                      const label = traceLabel(trace.event_type);
                      const metadataToolCall = (trace.metadata as { toolCall?: { tool_name: string; status: string } })?.toolCall;
                      const toolName = metadataToolCall?.tool_name;

                      return (
                        <li className={`timeline-row ${categoryClass}`} key={trace.trace_id}>
                          <span className="trace-time">{timeLabel(trace.timestamp)}</span>
                          <div>
                            <div className="tool-row" style={{ marginBottom: "2px" }}>
                              <span className={`event-code ${categoryClass}`}>
                                {toolName ? `${label}: ${toolLabel(toolName)}` : label}
                              </span>
                              {trace.event_type === "tool_call" && metadataToolCall?.status === "failed" ? (
                                <span className="badge critical">
                                  <AlertTriangle size={11} />
                                  Failed
                                </span>
                              ) : null}
                            </div>
                            <p>{trace.message}</p>
                          </div>
                        </li>
                      );
                    })}
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
