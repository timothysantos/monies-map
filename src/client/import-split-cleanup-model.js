// Whether the post-import split clean-up card has been put off with "Later".
//
// A commit shows the card again for its own possible split links once its
// refresh has settled. That refresh can take several attempts, and the page
// it brings back (with the new match count) can reach the screen before the
// last attempt returns, so the user may click "Later" while the commit is
// still refreshing. A "Later" clicked after a commit was saved is the answer
// for that commit and is never undone by its refresh.

export const initialSplitCleanupState = {
  dismissed: false,
  // Identifies the latest saved commit; its refresh only applies to it.
  commitKey: null,
  dismissedSinceCommit: false
};

/**
 * @param {typeof initialSplitCleanupState} state
 * @param {{ type: "later" }
 *   | { type: "commitSaved", commitKey: unknown }
 *   | { type: "commitRefreshed", commitKey: unknown }
 *   | { type: "noPendingMatches" }} action
 * @returns {typeof initialSplitCleanupState}
 */
export function splitCleanupReducer(state, action) {
  switch (action.type) {
    case "later":
      return state.dismissed && state.dismissedSinceCommit
        ? state
        : { ...state, dismissed: true, dismissedSinceCommit: true };
    case "commitSaved":
      return { ...state, commitKey: action.commitKey, dismissedSinceCommit: false };
    case "commitRefreshed":
      if (action.commitKey !== state.commitKey || state.dismissedSinceCommit || !state.dismissed) {
        return state;
      }
      return { ...state, dismissed: false };
    case "noPendingMatches":
      return state.dismissed ? { ...state, dismissed: false } : state;
    default:
      return state;
  }
}
