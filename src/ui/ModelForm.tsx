import { useEffect, useRef, useState } from "react";
import { ApiError, saveModel, type ModelInfo } from "./modelsApi";

// Adding or changing a model in the page. Two adapters are offered; which one
// to pick depends only on the API the model speaks.

type Adapter = "completion" | "decision";

const ADAPTERS: { id: Adapter; name: string; about: string; baseUrl: string; model: string }[] = [
  {
    id: "completion",
    name: "Completion",
    about: "Chat models with an OpenAI-compatible Chat Completions API. The model reads the board as text and answers with an option id.",
    baseUrl: "https://api.openai.com/v1",
    model: "gpt-4.1-mini",
  },
  {
    id: "decision",
    name: "Decision",
    about: "Decision models with the Decisions API (POST /v1/systemone). The model scores every landing spot and returns probabilities.",
    baseUrl: "https://api.typesafe.ai",
    model: "jev-latest",
  },
];

interface Draft {
  label: string;
  adapter: Adapter;
  baseUrl: string;
  url: string;
  model: string;
  apiKey: string;
  timeoutMs: string;
  inputPerM: string;
  outputPerM: string;
  jsonMode: string;
  maxTokens: string;
  rotations: string;
  extraBody: string;
}

function draftOf(m?: ModelInfo): Draft {
  const s = m?.settings;
  const str = (v: unknown) => (v === undefined ? "" : String(v));
  return {
    label: s?.label ?? "",
    adapter: s?.adapter === "decision" ? "decision" : "completion",
    baseUrl: s?.baseUrl ?? "",
    url: s?.url ?? "",
    model: s?.model ?? "",
    apiKey: "",
    timeoutMs: str(s?.timeoutMs),
    inputPerM: str(s?.prices?.inputPerM),
    outputPerM: str(s?.prices?.outputPerM),
    jsonMode: s?.jsonMode ?? "schema",
    maxTokens: str(s?.maxTokens),
    rotations: str(s?.rotations),
    extraBody: s?.extraBody ? JSON.stringify(s.extraBody, null, 2) : "",
  };
}

/** The request body: empty fields left out, numbers as numbers, settings of the other adapter dropped. */
function settingsOf(d: Draft): Record<string, unknown> {
  const out: Record<string, unknown> = { label: d.label, adapter: d.adapter, model: d.model };
  const put = (key: string, v: string, asNumber = false) => {
    if (v.trim()) out[key] = asNumber ? Number(v) : v.trim();
  };
  put("baseUrl", d.baseUrl);
  put("url", d.url);
  put("apiKey", d.apiKey);
  put("timeoutMs", d.timeoutMs, true);
  if (d.inputPerM.trim() || d.outputPerM.trim()) out.prices = { inputPerM: Number(d.inputPerM || 0), outputPerM: Number(d.outputPerM || 0) };
  if (d.adapter === "completion") {
    out.jsonMode = d.jsonMode;
    put("maxTokens", d.maxTokens, true);
  } else {
    put("rotations", d.rotations, true);
  }
  if (d.extraBody.trim()) {
    try {
      out.extraBody = JSON.parse(d.extraBody);
    } catch {
      throw new ApiError("extraBody: must be a JSON object, such as {\"temperature\": 0}", "extraBody");
    }
  }
  return out;
}

interface Props {
  /** The page-added model being changed; absent when adding one. */
  model?: ModelInfo;
  onSaved: (model: ModelInfo) => void;
  onCancel: () => void;
}

export function ModelForm({ model, onSaved, onCancel }: Props) {
  const [d, setD] = useState<Draft>(() => draftOf(model));
  const [error, setError] = useState<ApiError | null>(null);
  const [saving, setSaving] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const adapter = ADAPTERS.find((a) => a.id === d.adapter)!;
  const set = (key: keyof Draft) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setD({ ...d, [key]: e.target.value });

  // Put the cursor where the server found the problem.
  useEffect(() => {
    if (!error?.field) return;
    const name = error.field.startsWith("prices.") ? error.field.replace("prices.", "") : error.field;
    formRef.current?.querySelector<HTMLElement>(`[name="${name}"]`)?.focus();
  }, [error]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      onSaved(await saveModel(settingsOf(d), model?.id));
    } catch (err) {
      setError(err instanceof ApiError ? err : new ApiError(String(err)));
    } finally {
      setSaving(false);
    }
  };

  const invalid = (name: string) => (error?.field === name || error?.field === `prices.${name}` ? true : undefined);
  const field = (name: keyof Draft, label: string, props: React.InputHTMLAttributes<HTMLInputElement> = {}) => (
    <label className="form-field">
      <span className="form-label">{label}</span>
      <input className="field" name={name} value={d[name]} onChange={set(name)} aria-invalid={invalid(name)} {...props} />
    </label>
  );

  return (
    <form ref={formRef} className="model-form" onSubmit={submit} noValidate>
      <h3 className="drawer-subtitle">{model ? `Change ${model.label}` : "Add a model"}</h3>

      <fieldset className="form-field">
        <legend className="form-label">Adapter</legend>
        <div className="segmented" role="group">
          {ADAPTERS.map((a) => (
            <button key={a.id} type="button" aria-pressed={d.adapter === a.id} onClick={() => setD({ ...d, adapter: a.id })}>
              {a.name}
            </button>
          ))}
        </div>
        <p className="form-hint">{adapter.about}</p>
      </fieldset>

      {field("label", "Name on the board", { required: true, maxLength: 40, placeholder: "My model", autoFocus: !model })}
      {field("baseUrl", "API address", { type: "url", placeholder: adapter.baseUrl, spellCheck: false })}
      {field("model", "Model name", { required: true, placeholder: adapter.model, spellCheck: false })}
      {field("apiKey", "API key", {
        type: "password",
        autoComplete: "off",
        placeholder: model?.settings.hasKey ? "Saved. Leave blank to keep it." : "Optional for local servers",
      })}

      <details className="form-more">
        <summary>More settings</summary>
        {field("url", "Full request address", {
          type: "url",
          spellCheck: false,
          placeholder: d.adapter === "completion" ? "Replaces API address + /chat/completions" : "Replaces API address + /v1/systemone",
        })}
        <div className="form-row">
          {field("inputPerM", "Input price, $ per M tokens", { inputMode: "decimal", placeholder: "0" })}
          {field("outputPerM", "Output price, $ per M tokens", { inputMode: "decimal", placeholder: "0" })}
        </div>
        <div className="form-row">
          {field("timeoutMs", "Timeout, ms", { inputMode: "numeric", placeholder: d.adapter === "completion" ? "60000" : "30000" })}
          {d.adapter === "completion"
            ? field("maxTokens", "Reply token limit", { inputMode: "numeric", placeholder: "Provider default" })
            : field("rotations", "Option-order rotations", { inputMode: "numeric", placeholder: "1 (off)" })}
        </div>
        {d.adapter === "completion" ? (
          <label className="form-field">
            <span className="form-label">Answer format</span>
            <select className="field" name="jsonMode" value={d.jsonMode} onChange={set("jsonMode")} aria-invalid={invalid("jsonMode")}>
              <option value="schema">Strict JSON schema</option>
              <option value="object">JSON mode</option>
              <option value="none">Plain text with JSON</option>
            </select>
            <span className="form-hint">Use JSON mode or plain text if the API rejects strict schemas.</span>
          </label>
        ) : (
          <p className="form-hint">
            Rotations ask the same question with the options shifted and average the answers, which cancels a preference for options listed
            first. The server must accept <code>option_order</code>.
          </p>
        )}
        <label className="form-field">
          <span className="form-label">Extra request fields (JSON)</span>
          <textarea
            className="field form-code"
            name="extraBody"
            rows={3}
            value={d.extraBody}
            onChange={set("extraBody")}
            aria-invalid={invalid("extraBody")}
            spellCheck={false}
            placeholder={d.adapter === "completion" ? '{"temperature": 0}' : '{"max_len": 4096}'}
          />
        </label>
      </details>

      {error && (
        <p className="form-error" role="alert">
          {error.message}
        </p>
      )}
      <div className="form-actions">
        <button type="button" className="btn" onClick={onCancel}>
          Cancel
        </button>
        <button type="submit" className="btn primary" disabled={saving}>
          {saving ? "Saving…" : model ? "Save changes" : "Add model"}
        </button>
      </div>
    </form>
  );
}
