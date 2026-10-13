import { useEffect, useRef, useState } from "react";
import { Icon } from "./Icon";
import { ModelForm } from "./ModelForm";
import { ApiError, deleteModel, listModels, saveLineup, testModel, type ModelInfo, type TestResult } from "./modelsApi";

// Every configured model in one list: tick up to six for the live line-up
// (boards follow the order they were ticked in), test any model with one real
// decision, and add, change or remove the models added here.

const MAX_LINEUP = 6;
const ADAPTER_NAMES = { completion: "Completion", decision: "Decision", bedrock: "Bedrock" } as const;

type TestState = { pending: true } | { pending: false; result?: TestResult; error?: string };

interface Props {
  open: boolean;
  lineup: string[];
  onClose: () => void;
  /** Models or the line-up changed on the server; the page should reload its setup. */
  onChanged: () => void;
}

export function ModelsPanel({ open, lineup, onClose, onChanged }: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [models, setModels] = useState<ModelInfo[] | null>(null);
  const [view, setView] = useState<{ form: false } | { form: true; model?: ModelInfo }>({ form: false });
  const [tests, setTests] = useState<Record<string, TestState>>({});
  const [error, setError] = useState<string | null>(null);

  const reload = () =>
    listModels()
      .then(setModels)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      dialog.showModal();
      setView({ form: false });
      setError(null);
      void reload();
    } else if (!open && dialog.open) dialog.close();
  }, [open]);

  const run = async (id: string) => {
    setTests((t) => ({ ...t, [id]: { pending: true } }));
    try {
      const result = await testModel(id);
      setTests((t) => ({ ...t, [id]: { pending: false, result } }));
    } catch (e) {
      setTests((t) => ({ ...t, [id]: { pending: false, error: e instanceof Error ? e.message : String(e) } }));
    }
  };

  const toggle = async (id: string) => {
    const next = lineup.includes(id) ? lineup.filter((x) => x !== id) : [...lineup, id];
    setError(null);
    try {
      await saveLineup(next);
      onChanged();
    } catch (e) {
      setError(e instanceof ApiError ? e.message.replace(/^lineup: /, "Line-up: ") : String(e));
    }
  };

  const remove = async (m: ModelInfo) => {
    if (!confirm(`Remove ${m.label}? Its settings and key are deleted from models.local.json.`)) return;
    try {
      await deleteModel(m.id);
      await reload();
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const saved = async (m: ModelInfo) => {
    setView({ form: false });
    await reload();
    onChanged();
    if (m.available) void run(m.id);
  };

  const picked = lineup.filter((id) => models?.some((m) => m.id === id)).length;
  const full = lineup.length >= MAX_LINEUP;

  return (
    <dialog ref={dialogRef} className="drawer" aria-labelledby="models-title" onClose={onClose} onCancel={onClose}>
      <header className="drawer-head">
        <h2 id="models-title" className="drawer-title">
          Models
        </h2>
        <button type="button" className="icon-btn" onClick={onClose} aria-label="Close">
          <Icon name="close" />
        </button>
      </header>

      {view.form ? (
        <ModelForm model={view.model} onSaved={saved} onCancel={() => setView({ form: false })} />
      ) : (
        <>
          <p className="drawer-note">
            Tick up to {MAX_LINEUP} for the live line-up; boards follow the order you tick them in. {picked} of {MAX_LINEUP} picked.
          </p>
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          {!models ? (
            <p className="drawer-note">Loading…</p>
          ) : (
            <ul className="model-list">
              {models.map((m) => {
                const slot = lineup.indexOf(m.id);
                const test = tests[m.id];
                return (
                  <li key={m.id} className="model-row" data-off={!m.available || undefined}>
                    <label className="model-pick" title={slot >= 0 ? `Board ${slot + 1}` : full ? "The line-up is full" : "Add to the line-up"}>
                      <input type="checkbox" checked={slot >= 0} disabled={slot < 0 && full} onChange={() => void toggle(m.id)} />
                      <span className="model-slot" aria-hidden="true">
                        {slot >= 0 ? slot + 1 : ""}
                      </span>
                    </label>
                    <div className="model-main">
                      <div className="model-name">
                        {m.label}
                        <span className="model-adapter">{ADAPTER_NAMES[m.adapter]}</span>
                        {!m.builtIn && <span className="model-adapter">added here</span>}
                      </div>
                      <p className="model-desc">{m.available ? m.description : m.reason}</p>
                      {test && <TestLine test={test} />}
                    </div>
                    <div className="model-actions">
                      <button type="button" className="btn btn-small" onClick={() => void run(m.id)} disabled={!m.available || test?.pending}>
                        Test
                      </button>
                      {!m.builtIn && (
                        <>
                          <button type="button" className="icon-btn" onClick={() => setView({ form: true, model: m })} aria-label={`Change ${m.label}`} title="Change">
                            <Icon name="edit" />
                          </button>
                          <button type="button" className="icon-btn" onClick={() => void remove(m)} aria-label={`Remove ${m.label}`} title="Remove">
                            <Icon name="trash" />
                          </button>
                        </>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
          <div className="drawer-foot">
            <button type="button" className="btn primary" onClick={() => setView({ form: true })}>
              <Icon name="plus" /> Add model
            </button>
            <p className="form-hint">Built-in models are set in models.json and their keys in .env. Models added here are saved to models.local.json.</p>
          </div>
        </>
      )}
    </dialog>
  );
}

function TestLine({ test }: { test: TestState }) {
  if (test.pending) return <p className="model-test">Asking for one move…</p>;
  if (test.error) return <p className="model-test" data-status="error">{test.error}</p>;
  const r = test.result!;
  const text =
    r.status === "ok"
      ? `Picked ${r.choice} of ${r.options} options in ${r.latencyMs} ms${r.usage ? `, ${r.usage.inputTokens} tokens in` : ""}.`
      : `${r.status === "invalid" ? "Answered, but" : "Failed:"} ${r.detail ?? "no detail"} (${r.latencyMs} ms)`;
  return (
    <p className="model-test" data-status={r.status}>
      {text}
    </p>
  );
}
