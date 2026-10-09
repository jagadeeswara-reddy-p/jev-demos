import { useEffect, useMemo, useRef, useState } from "react";
import { ReplayBackend, fromJsonl, toJsonl } from "../arena/replayBackend";
import { DEFAULT_CONFIG, type AgentSpec, type ArenaBackend, type ClockMode } from "../arena/types";
import { MockBackend } from "../mock/mockBackend";
import { getProfile } from "../mock/profiles";
import { BoardFigure } from "./BoardFigure";
import { EventLog } from "./EventLog";
import { ArenaContext, useArenaState } from "./hooks";
import { SCENARIOS } from "./scenarios";
import { ArenaStore, fmtClock, fmtMs } from "./store";
import { SurvivalFigure } from "./SurvivalFigure";

const MAX_BOARDS = 6;
const SPEEDS = [1, 2, 4, 8];

let nextAgent = 1;

function specsFor(sources: string[]): AgentSpec[] {
  const seen = new Map<string, number>();
  return sources.map((sourceId) => {
    const p = getProfile(sourceId);
    const n = (seen.get(p.label) ?? 0) + 1;
    seen.set(p.label, n);
    return { id: `b${nextAgent++}`, name: n > 1 ? `${p.label} ${n}` : p.label, kind: p.kind, sourceId };
  });
}

function renamed(agents: AgentSpec[]): AgentSpec[] {
  const fresh = specsFor(agents.map((a) => a.sourceId));
  return agents.map((a, i) => ({ ...a, name: fresh[i].name, kind: fresh[i].kind }));
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
  const [scenarioId, setScenarioId] = useState(SCENARIOS[0].id);
  const [agents, setAgents] = useState<AgentSpec[]>(() => specsFor(SCENARIOS[0].sources));
  const [mode, setMode] = useState<ClockMode>(SCENARIOS[0].mode);
  const [speed, setSpeed] = useState(4);
  const [seed, setSeed] = useState(1);
  const [editing, setEditing] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const scenario = SCENARIOS.find((s) => s.id === scenarioId)!;
  const active = state.status === "running" || state.status === "paused";
  const editable = !active;
  const shown = editing || !state.config ? agents : state.config.agents;
  const hasRecording = store.recording.length > 0 && !active;

  const edit = (next: AgentSpec[]) => {
    setAgents(renamed(next));
    setEditing(true);
  };

  const pickScenario = (id: string) => {
    const s = SCENARIOS.find((x) => x.id === id)!;
    setScenarioId(id);
    setMode(s.mode);
    edit(specsFor(s.sources));
  };

  const startRun = () => {
    setError(null);
    const backend = new MockBackend();
    use(backend);
    backend.setSpeed(speed);
    store.reset();
    setEditing(false);
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
      if (state.status === "running") pause();
      else if (state.status === "paused") resume();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

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
              <button key={s} type="button" aria-pressed={speed === s} onClick={() => changeSpeed(s)}>
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
            <button type="button" className="btn primary" onClick={startRun} disabled={agents.length === 0}>
              Start run
            </button>
          )}
          {state.status === "running" && (
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
        <p className="scenario-note">{error ?? scenario.note}</p>
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
            board={state.boards.find((b) => b.spec.id === spec.id)}
            editable={editable}
            canRemove={shown.length > 1}
            onChangeSource={(sourceId) => edit(shown.map((a) => (a.id === spec.id ? { ...a, sourceId } : a)))}
            onRemove={() => edit(shown.filter((a) => a.id !== spec.id))}
          />
        ))}
        {editable && shown.length < MAX_BOARDS && (
          <button type="button" className="add-board" onClick={() => edit([...shown, ...specsFor(["llm-fast"])])}>
            <span className="plus" aria-hidden="true">
              +
            </span>
            <span>Add a board</span>
          </button>
        )}
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
