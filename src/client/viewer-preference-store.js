import { APP_SHELL_PERSISTED_CACHE_KEY } from "./app-shell-query";

// One remembered display choice of the signed-in login (the pattern of
// lead-view.js, which keeps its own copy for Plan | Simple): the app shell
// carries it (`field`, stored on the server under the login), a switch saves
// it with a POST to `path`, and this device's storage is only a first-paint
// cache that the shell's value replaces. Without a login (the demo, local
// dev) the device's storage is where it is kept. A choice that is on its way
// to the server is not undone by a shell that arrives meanwhile with the old
// value. Storage can be missing or blocked (a private window): then the
// default is used and the choice lasts for the visit.
export function createPreferenceStore({ field, storageKey, path, isValid, storage = globalThis.localStorage, send = undefined }) {
  const post = send ?? (async (value) => {
    const response = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ [field]: value })
    });
    if (!response.ok) throw new Error(`${field} not saved (${response.status})`);
  });

  function read() {
    try {
      const stored = storage?.getItem(storageKey);
      return isValid(stored) ? stored : null;
    } catch {
      return null;
    }
  }

  function write(value) {
    try {
      if (value) storage?.setItem(storageKey, value);
      else storage?.removeItem(storageKey);
    } catch {
      // Not remembered on this device; the switch still works for this visit.
    }
  }

  function patchPersistedShell(value) {
    try {
      const cached = JSON.parse(storage.getItem(APP_SHELL_PERSISTED_CACHE_KEY));
      if (cached?.data) {
        cached.data[field] = value;
        storage.setItem(APP_SHELL_PERSISTED_CACHE_KEY, JSON.stringify(cached));
      }
    } catch {
      // No kept shell, or storage blocked: the next load asks the server.
    }
  }

  let chosen = read();
  let signedIn = false;
  let saving = 0;
  const listeners = new Set();
  const set = (next) => {
    if (next === chosen) return;
    chosen = next;
    listeners.forEach((listener) => listener());
  };
  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    get: () => chosen,
    // The app shell's word: with a login, its choice (or none) replaces this
    // device's cache; without one, the device keeps its own.
    applyShell(shell) {
      if (!shell) return;
      signedIn = Boolean(shell.viewerIdentity);
      if (!signedIn || saving > 0) return;
      const fromServer = isValid(shell[field]) ? shell[field] : null;
      write(fromServer);
      set(fromServer);
    },
    // The switch: shown at once, then saved for the login. A failed save keeps
    // the choice for this visit and on this device.
    async choose(value) {
      set(value);
      write(value);
      if (!signedIn) return;
      patchPersistedShell(value);
      saving += 1;
      try {
        await post(value);
      } catch {
        // Kept locally; the next successful switch saves it.
      } finally {
        saving -= 1;
      }
    }
  };
}
