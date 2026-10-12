import { useEffect, useMemo, useRef, useState } from "react";
import { ReplayBackend, fromJsonl, toJsonl } from "../arena/replayBackend";
import { ServerBackend, fetchServerSetup } from "../arena/serverBackend";
import { DEFAULT_CONFIG, SPRINT_LINES, type AgentSpec, type ArenaBackend, type ClockMode, type SourceInfo } from "../arena/types";
import { MockBackend } from "../mock/mockBackend";
import { MOCK_SOURCES } from "../mock/mockSource";
import { BoardFigure } from "./BoardFigure";
import { EventLog } from "./EventLog";
import { ArenaContext, useArenaState } from "./hooks";
import { ResultsScreen } from "./ResultsScreen";
import { SCENARIOS } from "./scenarios";
import { ScoreStrip } from "./ScoreStrip";
import { ArenaStore, fmtClock, fmtMs, type ArenaState } from "./store";
import { SurvivalFigure } from "./SurvivalFigure";
import { ThemeToggle } from "./ThemeToggle";

const MOCK_DEFAULT = SCENARIOS.find((s) => s.id === "jev-vs-llm")!;
const SPEEDS = [1, 2, 4, 8];

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
  // The live line-up is set on the server (LINEUP in .env), not edited in the page.
  const [lineup, setLineup] = useState<string[] | null>(null);
  const [scenarioId, setScenarioId] = useState(MOCK_DEFAULT.id);
  const [agents, setAgents] = useState<AgentSpec[]>(() => specsFor(MOCK_SOURCES, MOCK_DEFAULT.sources));
  const [mode, setMode] = useState<ClockMode>(MOCK_DEFAULT.mode);
  const [speed, setSpeed] = useState(4);
  const [seed, setSeed] = useState(1);
  // 0 plays until everyone tops out; SPRINT_LINES races to that many lines.
  const [targetLines, setTargetLines] = useState(0);
  const [editing, setEditing] = useState(true);
  // setup: settings and boards; fight: boards only, full page; results: the animated summary.
  const [phase, setPhase] = useState<"setup" | "fight" | "results">("setup");
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // The server adds the live models (and says whether their keys are set).
  // Start on the live line-up when it's usable, otherwise stay on the mock one.
  useEffect(() => {
    void fetchServerSetup().then((setup) => {
      if (!setup) return;
      setSources(setup.sources);
      setLineup(setup.lineup);
      if (setup.lineup.every((id) => setup.sources.find((s) => s.id === id)?.available)) {
        const live = SCENARIOS.find((s) => s.id === "live")!;
        setScenarioId(live.id);
        setMode(live.mode);
        setAgents(specsFor(setup.sources, setup.lineup));
      }
    });
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
    backend.setSpeed(live ? 1 : speed);
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
    backend.setSpeed(speed);
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

  const changeSpeed = (s: number) => {
    setSpeed(s);
    backendRef.current.setSpeed(s);
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

  const runButtons = (
    <>
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
    </>
  );

  const boardFigures = shown.map((spec, i) => (
    <BoardFigure key={spec.id} index={i + 1} spec={spec} sources={sources} board={state.boards.find((b) => b.spec.id === spec.id)} />
  ));

  if (phase === "fight") {
    const cols = Math.min(3, Math.max(1, shown.length));
    const rowCount = Math.ceil(shown.length / cols);
    return (
      <main className="page stage">
        <header className="stage-bar">
          <h1 className="stage-title">Deadline Tetris</h1>
          <Readout state={state} rules={rules} seed={seed} />
          <div className="btn-row">
            {!liveRunning && (
              <div className="segmented" role="group" aria-label="Speed">
                {SPEEDS.map((sp) => (
                  <button key={sp} type="button" aria-pressed={speed === sp} onClick={() => changeSpeed(sp)}>
                    {sp}×
                  </button>
                ))}
              </div>
            )}
            {runButtons}
          </div>
        </header>
        {error && <p className="scenario-note">{error}</p>}
        <ScoreStrip agents={shown} rules={rules} />
        <div
          className="boards"
          style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`, gridTemplateRows: `repeat(${rowCount}, minmax(0, 1fr))` }}
        >
          {boardFigures}
        </div>
      </main>
    );
  }

  return (
    <main className="page">
      <header className="masthead">
        <h1>Deadline Tetris</h1>
        <p>
          Models play the same game, piece for piece. The pieces keep falling while each one thinks,{" "}
          <strong>so an answer that comes too late doesn't count.</strong>
        </p>
      </header>
      <div className="rule" aria-hidden="true" />


      <div className="arena">
        <div className="arena-main">
          <SurvivalFigure figIndex={1} agents={shown} rules={rules} />
          <div className="boards">{boardFigures}</div>
        </div>
        <aside className="arena-side">
          <Readout state={state} rules={rules} seed={seed} />
          <section className="controls" aria-label="Run settings">
            <div className="control">
              <label className="label" htmlFor="scenario">
                Line-up
              </label>
              <select id="scenario" className="field" value={scenarioId} disabled={!editable} onChange={(e) => pickScenario(e.target.value)}>
                {SCENARIOS.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="control">
              <span className="label" id="clock-label">
                Clock
              </span>
              <div className="segmented" role="group" aria-labelledby="clock-label">
                {(["realtime", "frozen"] as const).map((m) => (
                  <button key={m} type="button" aria-pressed={mode === m} disabled={!editable} onClick={() => (setMode(m), setEditing(true))}>
                    {m === "realtime" ? "Real time" : "Frozen"}
                  </button>
                ))}
              </div>
            </div>

            <div className="control">
              <span className="label" id="goal-label">
                Goal
              </span>
              <div className="segmented" role="group" aria-labelledby="goal-label">
                {[0, SPRINT_LINES].map((n) => (
                  <button
                    key={n}
                    type="button"
                    aria-pressed={targetLines === n}
                    disabled={!editable}
                    title={n ? `Race to clear ${n} lines` : "Play until every board tops out"}
                    onClick={() => (setTargetLines(n), setEditing(true))}
                  >
                    {n ? `${n} lines` : "Survive"}
                  </button>
                ))}
              </div>
            </div>

            <div className="control">
              <span className="label" id="speed-label">
                Speed
              </span>
              <div className="segmented" role="group" aria-labelledby="speed-label">
                {SPEEDS.map((s) => (
                  <button
                    key={s}
                    type="button"
                    aria-pressed={liveRunning ? s === 1 : speed === s}
                    disabled={liveRunning}
                    title={liveRunning ? "Live runs play at 1×. Replay the run afterwards to fast-forward." : undefined}
                    onClick={() => changeSpeed(s)}
                  >
                    {s}×
                  </button>
                ))}
              </div>
            </div>

            <div className="control">
              <label className="label" htmlFor="seed">
                Seed
              </label>
              <div className="btn-row">
                <input
                  id="seed"
                  className="field"
                  type="number"
                  min={0}
                  value={seed}
                  disabled={!editable}
                  onChange={(e) => (setSeed(Math.max(0, Number(e.target.value) || 0)), setEditing(true))}
                />
                <button
                  type="button"
                  className="icon-btn"
                  style={{ height: 34, width: 34 }}
                  disabled={!editable}
                  onClick={() => (setSeed(Math.floor(Math.random() * 100_000)), setEditing(true))}
                  aria-label="Pick a random seed"
                  title="Random seed"
                >
                  ↻
                </button>
              </div>
            </div>

            <ThemeToggle />

            <div className="btn-row">
              {!active && (
                <button type="button" className="btn primary" onClick={startRun} disabled={agents.length === 0 || Boolean(blocked)}>
                  {isLive(agents) ? "Start live run" : "Start run"}
                </button>
              )}
              {runButtons}
              {state.status === "finished" && state.config && (
                <button type="button" className="btn" onClick={() => setPhase("results")}>
                  Results
                </button>
              )}
              <button type="button" className="btn" onClick={() => replay()} disabled={!hasRecording}>
                Replay
              </button>
              <button type="button" className="btn" onClick={exportLog} disabled={!hasRecording}>
                Export log
              </button>
              <button type="button" className="btn" onClick={() => fileRef.current?.click()} disabled={active}>
                Load log
              </button>
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
            </div>
            <p className="scenario-note">
              {error ??
                (blocked && editable
                  ? `${blocked.label} can't run yet: ${blocked.reason}.`
                  : liveRunning
                    ? "Live run: real response times at 1×. When it ends, use Replay to watch it faster."
                    : isLive(agents) && editable
                      ? `${scenario.note} Live runs play at 1×.`
                      : scenario.note)}
            </p>
          </section>
          <EventLog />
        </aside>
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
