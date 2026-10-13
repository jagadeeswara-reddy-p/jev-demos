import { useEffect, useMemo, useRef, useState } from "react";
import { ReplayBackend, fromJsonl, toJsonl } from "../arena/replayBackend";
import { ServerBackend, fetchServerSetup } from "../arena/serverBackend";
import { DEFAULT_CONFIG, SPRINT_LINES, type AgentSpec, type ArenaBackend, type ClockMode, type SourceInfo } from "../arena/types";
import { MockBackend } from "../mock/mockBackend";
import { MOCK_SOURCES } from "../mock/mockSource";
import { BoardFigure } from "./BoardFigure";
import { ArenaContext, useArenaState } from "./hooks";
import { ResultsScreen } from "./ResultsScreen";
import { SCENARIOS } from "./scenarios";
import { ScoreStrip } from "./ScoreStrip";
import { ArenaStore, fmtClock, fmtMs, type ArenaState } from "./store";
import { Icon } from "./Icon";
import { ModelsPanel } from "./ModelsPanel";
import { ThemeToggle } from "./ThemeToggle";

const MOCK_DEFAULT = SCENARIOS.find((s) => s.id === "jev-vs-llm")!;
// Speed isn't offered on screen (recordings play at 1×); ?speed=8 fast-forwards mock runs and replays.
const SPEED = Math.max(1, Number(new URLSearchParams(location.search).get("speed")) || 1);

let nextAgent = 1;

function sourceOf(sources: SourceInfo[], id: string): SourceInfo {
  return (
    sources.find((s) => s.id === id) ?? {
      id,
      label: id,
      kind: "llm",
      description: "Unknown source",
      live: true,
      available: false,
      reason: "Not offered by this server",
    }
  );
}

/** Board specs for a list of sources; repeated sources get numbered names ("Jev 2"). */
function specsFor(sources: SourceInfo[], ids: string[]): AgentSpec[] {
  const seen = new Map<string, number>();
  return ids.map((sourceId) => {
    const s = sourceOf(sources, sourceId);
    const n = (seen.get(s.label) ?? 0) + 1;
    seen.set(s.label, n);
    return { id: `b${nextAgent++}`, name: n > 1 ? `${s.label} ${n}` : s.label, kind: s.kind, sourceId };
  });
}

export function App() {
  const store = useMemo(() => new ArenaStore(), []);
  const backendRef = useRef<ArenaBackend>(new MockBackend());
  const unsubRef = useRef<() => void>(() => {});
  const ctx = useMemo(() => ({ store, backend: () => backendRef.current }), [store]);

  useEffect(() => {
    unsubRef.current = backendRef.current.subscribe(store.apply);
    return () => {
      unsubRef.current();
      backendRef.current.pause();
    };
  }, [store]);

  const use = (backend: ArenaBackend) => {
    backendRef.current.pause();
    unsubRef.current();
    backendRef.current = backend;
    unsubRef.current = backend.subscribe(store.apply);
  };

  return (
    <ArenaContext.Provider value={ctx}>
      <Page store={store} use={use} backendRef={backendRef} />
    </ArenaContext.Provider>
  );
}

function Page({
  store,
  use,
  backendRef,
}: {
  store: ArenaStore;
  use: (b: ArenaBackend) => void;
  backendRef: React.MutableRefObject<ArenaBackend>;
}) {
  const state = useArenaState();
  const [sources, setSources] = useState<SourceInfo[]>(MOCK_SOURCES);
  // The live line-up is kept on the server (picked in the Models panel, LINEUP in .env until then).
  const [lineup, setLineup] = useState<string[] | null>(null);
  const [modelsOpen, setModelsOpen] = useState(false);
  const [scenarioId, setScenarioId] = useState(MOCK_DEFAULT.id);
  const [agents, setAgents] = useState<AgentSpec[]>(() => specsFor(MOCK_SOURCES, MOCK_DEFAULT.sources));
  const [mode, setMode] = useState<ClockMode>(MOCK_DEFAULT.mode);
  const [seed, setSeed] = useState(1);
  // 0 plays until everyone tops out; SPRINT_LINES races to that many lines.
  const [targetLines, setTargetLines] = useState(0);
  const [editing, setEditing] = useState(true);
  // setup: settings and boards; fight: boards only, full page; results: the animated summary.
  const [phase, setPhase] = useState<"setup" | "fight" | "results">("setup");
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // The server adds the live models (and says whether their keys are set).
  // On load, start on the live line-up when it's usable, otherwise stay on the mock one.
  // After a change in the Models panel, show the live line-up as it now stands.
  const loadSetup = (afterEdit: boolean) =>
    fetchServerSetup().then((setup) => {
      if (!setup) return;
      setSources(setup.sources);
      setLineup(setup.lineup);
      const usable = setup.lineup.length > 0 && setup.lineup.every((id) => setup.sources.find((s) => s.id === id)?.available);
      if (afterEdit || usable) {
        const live = SCENARIOS.find((s) => s.id === (afterEdit && scenarioId === "live-frozen" ? "live-frozen" : "live"))!;
        setScenarioId(live.id);
        setMode(live.mode);
        setAgents(specsFor(setup.sources, setup.lineup));
        setEditing(true);
      }
    });

  useEffect(() => {
    void loadSetup(false);
  }, []);

  const scenario = SCENARIOS.find((s) => s.id === scenarioId)!;
  const active = state.status === "running" || state.status === "paused";
  const editable = !active;
  const shown = editing || !state.config ? agents : state.config.agents;
  const hasRecording = store.recording.length > 0 && !active;
  const isLive = (list: AgentSpec[]) => list.some((a) => sourceOf(sources, a.sourceId).live);
  // A live run is in progress: real response times, so no speed-up and no pause.
  const liveRunning = active && backendRef.current instanceof ServerBackend;
  // The rules on screen: the run's own once it has started (old logs predate sprint mode), otherwise the settings.
  const rules =
    editing || !state.config
      ? { mode, targetLines }
      : { mode: state.config.mode, targetLines: state.config.targetLines ?? 0 };
  const blocked = agents.map((a) => sourceOf(sources, a.sourceId)).find((s) => !s.available);

  const pickScenario = (id: string) => {
    const s = SCENARIOS.find((x) => x.id === id)!;
    setScenarioId(id);
    setMode(s.mode);
    setAgents(specsFor(sources, s.live && lineup ? lineup : s.sources));
    setEditing(true);
  };

  const startRun = () => {
    setError(null);
    const live = isLive(agents);
    const backend = live ? new ServerBackend((msg) => (setError(msg), store.setStatus("idle"))) : new MockBackend();
    use(backend);
    backend.setSpeed(live ? 1 : SPEED);
    store.reset();
    setEditing(false);
    if (live) store.setStatus("running");
    setPhase("fight");
    backend.start({ ...DEFAULT_CONFIG, seed, mode, targetLines, agents });
  };

  const replay = (events = store.recording.slice()) => {
    setError(null);
    const backend = new ReplayBackend(events);
    use(backend);
    backend.setSpeed(SPEED);
    store.reset();
    setEditing(false);
    setPhase("fight");
    backend.start();
  };

  const pause = () => {
    backendRef.current.pause();
    store.setStatus("paused");
  };
  const resume = () => {
    backendRef.current.resume();
    store.setStatus("running");
  };
  const stop = () => {
    backendRef.current.stop();
    // A replay has no simulation to report the stop, so close the run here.
    if (store.state.status !== "finished") {
      store.state.endAt = store.state.lastAt;
      store.setStatus("finished");
    }
  };

  const exportLog = () => {
    const blob = new Blob([toJsonl(store.recording)], { type: "application/x-ndjson" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `run-seed${state.config?.seed ?? seed}-${state.config?.mode ?? mode}.jsonl`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const loadLog = async (file: File) => {
    try {
      replay(fromJsonl(await file.text()));
    } catch (e) {
      setError(`Couldn't load ${file.name}. ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  // Space toggles pause, so a run can be stopped on an interesting moment.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== "Space" || (e.target as HTMLElement).closest("input, select, button, textarea")) return;
      e.preventDefault();
      if (liveRunning) return;
      if (state.status === "running") pause();
      else if (state.status === "paused") resume();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  // A finished fight moves on to the results after a beat; a run that failed to start goes back to setup.
  useEffect(() => {
    if (phase !== "fight") return;
    if (state.status === "idle") return setPhase("setup");
    if (state.status !== "finished") return;
    const id = setTimeout(() => setPhase("results"), 1500);
    return () => clearTimeout(id);
  }, [phase, state.status]);

  if (phase === "results" && state.config && state.status === "finished") {
    return (
      <ResultsScreen
        boards={state.boards}
        config={state.config}
        rules={rules}
        endAt={state.endAt ?? state.lastAt}
        mocked={!isLive(state.config.agents)}
        onBack={() => setPhase("setup")}
        onReplay={() => replay()}
        onRunAgain={startRun}
      />
    );
  }

  const boardFigures = shown.map((spec, i) => (
    <BoardFigure key={spec.id} index={i + 1} spec={spec} sources={sources} board={state.boards.find((b) => b.spec.id === spec.id)} />
  ));
  const cols = Math.min(3, Math.max(1, shown.length));
  const rowCount = Math.ceil(shown.length / cols);
  const note = error ?? (blocked && editable ? `${blocked.label} can't run yet: ${blocked.reason}.` : null);

  // One screen for setting up and for playing: the bar holds the settings until
  // Start, then the live readout; the cards stay where they are.
  return (
    <main className="page stage">
      <header className="stage-bar">
        <h1 className="stage-title">Deadline Tetris</h1>
        {phase === "fight" ? (
          <>
            <Readout state={state} rules={rules} seed={seed} />
            <div className="bar-group">
              {state.status === "running" && !liveRunning && (
                <button type="button" className="btn" onClick={pause}>
                  Pause
                </button>
              )}
              {state.status === "paused" && (
                <button type="button" className="btn primary" onClick={resume}>
                  Resume
                </button>
              )}
              {active && (
                <button type="button" className="btn" onClick={stop}>
                  Stop
                </button>
              )}
            </div>
          </>
        ) : (
          <>
            <div className="bar-settings" aria-label="Run settings">
              <label className="bar-field">
                <span className="bar-label">Line-up</span>
                <select className="field" value={scenarioId} onChange={(e) => pickScenario(e.target.value)} title={scenario.note}>
                  {SCENARIOS.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.label}
                    </option>
                  ))}
                </select>
              </label>
              <div className="bar-field">
                <span className="bar-label" id="clock-label">
                  Clock
                </span>
                <div className="segmented" role="group" aria-labelledby="clock-label">
                  {(["realtime", "frozen"] as const).map((m) => (
                    <button key={m} type="button" aria-pressed={mode === m} onClick={() => (setMode(m), setEditing(true))}>
                      {m === "realtime" ? "Real time" : "Frozen"}
                    </button>
                  ))}
                </div>
              </div>
              <div className="bar-field">
                <span className="bar-label" id="goal-label">
                  Goal
                </span>
                <div className="segmented" role="group" aria-labelledby="goal-label">
                  {[0, SPRINT_LINES].map((n) => (
                    <button
                      key={n}
                      type="button"
                      aria-pressed={targetLines === n}
                      title={n ? `Race to clear ${n} lines` : "Play until every board tops out"}
                      onClick={() => (setTargetLines(n), setEditing(true))}
                    >
                      {n ? `${n} lines` : "Survive"}
                    </button>
                  ))}
                </div>
              </div>
              <div className="bar-field">
                <label className="bar-label" htmlFor="seed">
                  Seed
                </label>
                <span className="seed-group">
                  <input
                    id="seed"
                    className="field seed-field"
                    type="number"
                    min={0}
                    value={seed}
                    onChange={(e) => (setSeed(Math.max(0, Number(e.target.value) || 0)), setEditing(true))}
                  />
                  <button
                    type="button"
                    className="icon-btn"
                    onClick={() => (setSeed(Math.floor(Math.random() * 100_000)), setEditing(true))}
                    aria-label="Pick a random seed"
                    title="Random seed"
                  >
                    <Icon name="dice" />
                  </button>
                </span>
              </div>
            </div>
            <div className="bar-group">
              {state.status === "finished" && state.config && (
                <button type="button" className="icon-btn" onClick={() => setPhase("results")} aria-label="Show results" title="Results">
                  <Icon name="chart" />
                </button>
              )}
              <button type="button" className="icon-btn" onClick={() => replay()} disabled={!hasRecording} aria-label="Replay the last run" title="Replay">
                <Icon name="replay" />
              </button>
              <button type="button" className="icon-btn" onClick={exportLog} disabled={!hasRecording} aria-label="Export the run log" title="Export log">
                <Icon name="download" />
              </button>
              <button type="button" className="icon-btn" onClick={() => fileRef.current?.click()} aria-label="Load a run log" title="Load log">
                <Icon name="upload" />
              </button>
              {lineup && (
                <button type="button" className="icon-btn" onClick={() => setModelsOpen(true)} aria-label="Models and line-up" title="Models">
                  <Icon name="models" />
                </button>
              )}
              <ThemeToggle />
              <input
                ref={fileRef}
                type="file"
                accept=".jsonl,.ndjson,application/x-ndjson"
                hidden
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void loadLog(f);
                  e.target.value = "";
                }}
              />
              <button type="button" className="btn primary start-btn" onClick={startRun} disabled={agents.length === 0 || Boolean(blocked)}>
                {isLive(agents) ? "Start live run" : "Start"}
              </button>
            </div>
          </>
        )}
      </header>
      {note && <p className="bar-note">{note}</p>}
      {lineup && <ModelsPanel open={modelsOpen} lineup={lineup} onClose={() => setModelsOpen(false)} onChanged={() => void loadSetup(true)} />}
      <ScoreStrip agents={shown} rules={rules} />
      <div className="boards" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`, gridTemplateRows: `repeat(${rowCount}, minmax(0, 1fr))` }}>
        {boardFigures}
      </div>
    </main>
  );
}

function Readout({ state, rules, seed }: { state: ArenaState; rules: { mode: ClockMode; targetLines: number }; seed: number }) {
  return (
    <div className="readout" aria-live="polite">
      <span className="level">LEVEL {String(state.level).padStart(2, "0")}</span>
      <span className="stat">
        a row every <b>{fmtMs(state.gravityMs)}</b>
      </span>
      <ClockStat />
      <span className="stat">
        clock <b>{rules.mode === "realtime" ? "real time" : "frozen"}</b>
      </span>
      <span className="stat">
        goal <b>{rules.targetLines ? `${rules.targetLines} lines` : "survive"}</b>
      </span>
      <span className="stat">
        seed <b>{state.config?.seed ?? seed}</b>
      </span>
      {state.status === "paused" && (
        <span className="stat">
          <b>paused</b>, press space to resume
        </span>
      )}
    </div>
  );
}

function ClockStat() {
  const state = useArenaState();
  return (
    <span className="stat">
      game time <b>{fmtClock(state.endAt ?? state.lastAt)}</b>
    </span>
  );
}
