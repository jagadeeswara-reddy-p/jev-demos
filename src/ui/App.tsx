import { useEffect, useMemo, useRef, useState } from "react";
import { ReplayBackend, fromJsonl, toJsonl } from "../arena/replayBackend";
import { ServerBackend, fetchServerSetup } from "../arena/serverBackend";
import { DEFAULT_CONFIG, type AgentSpec, type ArenaBackend, type ClockMode, type SourceInfo } from "../arena/types";
import { MockBackend } from "../mock/mockBackend";
import { MOCK_SOURCES } from "../mock/mockSource";
import { BoardFigure } from "./BoardFigure";
import { EventLog } from "./EventLog";
import { ArenaContext, useArenaState } from "./hooks";
import { SCENARIOS } from "./scenarios";
import { ArenaStore, fmtClock, fmtMs } from "./store";
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
  const [editing, setEditing] = useState(true);
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
    backend.start({ ...DEFAULT_CONFIG, seed, mode, agents });
  };

  const replay = (events = store.recording.slice()) => {
    setError(null);
    const backend = new ReplayBackend(events);
    use(backend);
    backend.setSpeed(speed);
    store.reset();
    setEditing(false);
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

  return (
    <main className="page">
      <div className="topbar">
        <ThemeToggle />
      </div>
      <header className="masthead">
        <h1>Deadline Tetris</h1>
        <p>
          Models play the same game, piece for piece. The pieces keep falling while each one thinks,{" "}
          <strong>so an answer that comes too late doesn't count.</strong>
        </p>
      </header>
      <div className="rule" aria-hidden="true" />

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

        <div className="btn-row" style={{ marginLeft: "auto" }}>
          {!active && (
            <button type="button" className="btn primary" onClick={startRun} disabled={agents.length === 0 || Boolean(blocked)}>
              {isLive(agents) ? "Start live run" : "Start run"}
            </button>
          )}
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

      <div className="readout" aria-live="polite">
        <span className="level">LEVEL {String(state.level).padStart(2, "0")}</span>
        <span className="stat">
          a row every <b>{fmtMs(state.gravityMs)}</b>
        </span>
        <ClockStat />
        <span className="stat">
          clock <b>{(state.config?.mode ?? mode) === "realtime" ? "real time" : "frozen"}</b>
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

      <div className="boards" >
        {shown.map((spec, i) => (
          <BoardFigure
            key={spec.id}
            index={i}
            spec={spec}
            sources={sources}
            board={state.boards.find((b) => b.spec.id === spec.id)}
          />
        ))}
      </div>

      <div className="lower">
        <SurvivalFigure figIndex={shown.length + 1} />
        <EventLog />
      </div>
    </main>
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
