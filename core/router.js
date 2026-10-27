// Tiny router. A feature gives routes like: { "GET /api/tasks": handler, "PATCH /api/tasks/:id": handler }
// handler({ params, body, query }) -> any JSON-able value (or throw httpError).
export const httpError = (status, message) => Object.assign(new Error(message), { status });

export function buildRouter(features) {
  const routes = [];
  for (const f of features) {
    for (const [key, handler] of Object.entries(f.routes || {})) {
      const [method, pattern] = key.split(" ");
      const names = [];
      const re = new RegExp("^" + pattern.replace(/:(\w+)/g, (_, n) => (names.push(n), "([^/]+)")) + "$");
      routes.push({ method, re, names, handler });
    }
  }
  return async function route(method, pathname, query, body) {
    for (const r of routes) {
      if (r.method !== method) continue;
      const m = pathname.match(r.re);
      if (!m) continue;
      const params = Object.fromEntries(r.names.map((n, i) => [n, decodeURIComponent(m[i + 1])]));
      return { status: 200, data: await r.handler({ params, body, query }) };
    }
    return null;
  };
}
