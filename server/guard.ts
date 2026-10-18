// Keeps other websites from driving the API through the user's browser. The
// server runs models on the user's keys, so a page on another site must not be
// able to start runs, test models or change their settings:
//   - Host must be this machine (or a name in ALLOWED_HOSTS), which defeats DNS
//     rebinding, where a hostile domain is re-pointed at 127.0.0.1;
//   - a request that changes something must come from this server's own page
//     (Origin, when the browser sends one) and declare a JSON body, which a
//     cross-site form or "simple" fetch cannot do without a CORS preflight this
//     server never answers.

const LOOPBACK = ["localhost", "127.0.0.1", "::1"];
const WILDCARD = ["0.0.0.0", "::", ""];

/** Hostnames the API answers to. `null` means any (HOST=0.0.0.0 with no ALLOWED_HOSTS: shared on purpose). */
export function allowedHosts(host: string, extra: string[]): Set<string> | null {
  if (WILDCARD.includes(host) && extra.length === 0) return null;
  return new Set([...LOOPBACK, ...(WILDCARD.includes(host) ? [] : [host]), ...extra].map((h) => h.toLowerCase()));
}

/** "localhost:5317" → "localhost"; "[::1]:5317" → "::1". */
function hostname(hostHeader: string): string {
  const h = hostHeader.trim().toLowerCase();
  if (h.startsWith("[")) return h.slice(1, h.indexOf("]"));
  return h.split(":")[0];
}

/** A 403/415 response when the request may not reach the API, or undefined when it may. */
export function rejectForeign(req: Request, allowed: Set<string> | null): Response | undefined {
  const hostHeader = req.headers.get("host") ?? "";
  if (allowed && !allowed.has(hostname(hostHeader))) {
    return Response.json({ error: `This server only answers to ${[...allowed].join(", ")}; add other names to ALLOWED_HOSTS` }, { status: 403 });
  }
  if (req.method === "GET" || req.method === "HEAD") return undefined;
  const origin = req.headers.get("origin");
  if (origin) {
    let originHost = "";
    try {
      originHost = new URL(origin).host.toLowerCase();
    } catch {}
    if (originHost !== hostHeader.toLowerCase()) return Response.json({ error: "Requests from other sites are not accepted" }, { status: 403 });
  }
  if (!(req.headers.get("content-type") ?? "").toLowerCase().includes("application/json")) {
    return Response.json({ error: "Send the request with Content-Type: application/json" }, { status: 415 });
  }
  return undefined;
}

type Handler = (req: never, server: never) => unknown;
type Route = Handler | Record<string, Handler> | unknown;

/** Wraps every /api/ route so each request passes `rejectForeign` first. Other routes (the page) are left alone. */
export function protect<T extends Record<string, Route>>(routes: T, allowed: Set<string> | null): T {
  const wrap =
    (h: Handler): Handler =>
    (req: never, server: never) =>
      rejectForeign(req as unknown as Request, allowed) ?? h(req, server);
  const out: Record<string, Route> = {};
  for (const [path, route] of Object.entries(routes)) {
    if (!path.startsWith("/api/")) out[path] = route;
    else if (typeof route === "function") out[path] = wrap(route as Handler);
    else out[path] = Object.fromEntries(Object.entries(route as Record<string, Handler>).map(([m, h]) => [m, wrap(h)]));
  }
  return out as T;
}
