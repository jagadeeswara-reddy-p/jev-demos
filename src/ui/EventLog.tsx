import { useArenaState } from "./hooks";
import { fmtClock } from "./store";

export function EventLog() {
  const { log } = useArenaState();
  return (
    <section aria-labelledby="log-title">
      <h2 id="log-title" className="section-title">
        Log
      </h2>
      <p className="section-note">Misses, failures and milestones, newest first.</p>
      {log.length === 0 ? (
        <p className="empty">Nothing yet.</p>
      ) : (
        <ol className="log" aria-live="off">
          {log.map((l, i) => (
            <li key={`${l.at}-${i}-${l.text}`} data-tone={l.tone}>
              <time>{fmtClock(l.at)}</time>
              <span>
                {l.agent && <b>{l.agent} </b>}
                {l.text}
              </span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
