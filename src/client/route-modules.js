// One loader per route panel. Navigation (React.lazy) and speculative warmup
// share these promises, so a warmed route is never downloaded twice and a
// click on a route that is still loading waits on the same import.
// The dynamic imports stay literal so Vite keeps one chunk per route.
const loaders = {
  entries: () => import("./entries-panel.jsx"),
  faq: () => import("./faq-panel.jsx"),
  imports: () => import("./imports-panel.jsx"),
  month: () => import("./month-panel.jsx"),
  settings: () => import("./settings-panel.jsx"),
  splits: () => import("./splits-panel.jsx"),
  summary: () => import("./summary-panel.jsx")
};

export const ROUTE_IDS = Object.freeze(Object.keys(loaders));

const pending = new Map();
const loaded = new Set();

// Same promise for concurrent callers. A rejected load is forgotten so the
// next caller retries; the rejection still reaches this caller.
export function loadRouteModule(routeId) {
  const loader = loaders[routeId];
  if (!loader) {
    return Promise.reject(new Error(`Unknown route module: ${routeId}`));
  }
  if (!pending.has(routeId)) {
    const promise = loader().then(
      (module) => {
        loaded.add(routeId);
        return module;
      },
      (error) => {
        pending.delete(routeId);
        throw error;
      }
    );
    pending.set(routeId, promise);
  }
  return pending.get(routeId);
}

export function getRouteModuleState(routeId) {
  if (loaded.has(routeId)) {
    return "loaded";
  }
  return pending.has(routeId) ? "pending" : "idle";
}
