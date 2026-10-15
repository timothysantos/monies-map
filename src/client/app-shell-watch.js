// The latest app shell, for a lazy route's own display choice (plan-mode.js):
// the first screen only hands the shell on, so what a route needs from it
// costs the first screen a few bytes, not the route's code. A watcher gets the
// latest shell at once (if there is one) and every later one.
let latest = null;
const watchers = new Set();

export function publishAppShell(shell) {
  latest = shell ?? null;
  watchers.forEach((watcher) => watcher(latest));
}

export function watchAppShell(watcher) {
  if (latest) watcher(latest);
  watchers.add(watcher);
  return () => watchers.delete(watcher);
}
