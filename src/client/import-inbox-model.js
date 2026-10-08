// What the folded Import inbox says: how many required files are still
// missing, overall and per bank, once the queued files the intake model
// matched (`buildIntakeMatch`) are ticked off their checklist lines.
export function buildInboxChecklistProgress(inbox, intakeQueue = []) {
  const tickedFileIds = new Set(
    intakeQueue
      .filter((item) => !item.duplicate && item.matchStatus === "matched")
      .flatMap((item) => item.expectedFileIds ?? [])
  );
  const sessions = {};
  let requiredCount = 0;
  let missingCount = 0;
  for (const session of inbox?.sessions ?? []) {
    const required = session.expectedFiles.filter((file) => file.priority === "required");
    const missing = required.filter((file) => !tickedFileIds.has(file.id)).length;
    sessions[session.institution] = { requiredCount: required.length, missingCount: missing };
    requiredCount += required.length;
    missingCount += missing;
  }
  return { requiredCount, missingCount, tickedFileIds, sessions };
}

// The inbox is the plan before a bank run; once files are queued or one is
// in review, the queue is the work and the inbox folds to one line.
export function isInboxOpenByDefault({ queuedCount, isFileInReview }) {
  return queuedCount === 0 && !isFileInReview;
}

// A fold the user can toggle that still follows its default when the
// default changes. With `followClose: false` it only opens with its default
// (a form the user opened to type in never closes under them).
export function nextFoldState(state, defaultOpen, { followClose = true } = {}) {
  if (state.defaultOpen === defaultOpen) {
    return state;
  }
  const open = defaultOpen ? true : followClose ? false : state.open;
  return { defaultOpen, open };
}
