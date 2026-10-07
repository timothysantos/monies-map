import assert from "node:assert/strict";
import test from "node:test";

import { initialSplitCleanupState, splitCleanupReducer } from "../src/client/import-split-cleanup-model.js";

function run(actions, state = initialSplitCleanupState) {
  return actions.reduce(splitCleanupReducer, state);
}

// Drives the reducer the way the panel does: commit saved, the refresh loop
// awaited, then "commitRefreshed". `clickLaterBeforeRefreshSettles` puts the
// user's click between the save and the refresh settling.
async function commitWithRefresh({ state, commitKey, clickLaterBeforeRefreshSettles }) {
  let current = splitCleanupReducer(state, { type: "commitSaved", commitKey });
  let settleRefresh;
  const refresh = new Promise((resolve) => { settleRefresh = resolve; });
  const refreshDone = refresh.then(() => {
    current = splitCleanupReducer(current, { type: "commitRefreshed", commitKey });
  });
  if (clickLaterBeforeRefreshSettles) {
    current = splitCleanupReducer(current, { type: "later" });
  }
  settleRefresh();
  await refreshDone;
  return current;
}

test("a Later click made while the commit is still refreshing stays dismissed", async () => {
  const state = await commitWithRefresh({
    state: initialSplitCleanupState,
    commitKey: 1,
    clickLaterBeforeRefreshSettles: true
  });

  assert.deepEqual(state, { dismissed: true, commitKey: 1, dismissedSinceCommit: true });
});

test("a new commit brings the card back after an earlier Later, once its refresh settles", async () => {
  const afterFirstCommit = await commitWithRefresh({
    state: initialSplitCleanupState,
    commitKey: 1,
    clickLaterBeforeRefreshSettles: true
  });

  const saved = splitCleanupReducer(afterFirstCommit, { type: "commitSaved", commitKey: 2 });
  // The card stays put off until the new commit's refresh brings its count.
  assert.equal(saved.dismissed, true);

  const refreshed = splitCleanupReducer(saved, { type: "commitRefreshed", commitKey: 2 });
  assert.deepEqual(refreshed, { dismissed: false, commitKey: 2, dismissedSinceCommit: false });
});

test("a refresh for an older commit does not undo the dismissal", () => {
  const state = run([
    { type: "commitSaved", commitKey: 1 },
    { type: "commitSaved", commitKey: 2 },
    { type: "later" },
    { type: "commitRefreshed", commitKey: 1 }
  ]);

  assert.equal(state.dismissed, true);
  assert.equal(state.commitKey, 2);
});

test("a Later click before the commit was saved is answered by that commit's refresh", () => {
  const state = run([
    { type: "later" },
    { type: "commitSaved", commitKey: 1 },
    { type: "commitRefreshed", commitKey: 1 }
  ]);

  assert.equal(state.dismissed, false);
});

test("no pending matches clears the dismissal so later matches show", () => {
  const dismissed = run([{ type: "later" }]);
  assert.equal(dismissed.dismissed, true);

  const cleared = splitCleanupReducer(dismissed, { type: "noPendingMatches" });
  assert.equal(cleared.dismissed, false);

  // Unchanged state keeps its identity so React skips the re-render.
  assert.equal(splitCleanupReducer(cleared, { type: "noPendingMatches" }), cleared);
});
