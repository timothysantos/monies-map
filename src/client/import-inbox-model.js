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

// A bank's checklist lines, one group per account (or per shared statement
// that covers several accounts), so an account behind on several months is
// one box listing its months. Groups and months keep the download order.
export function groupInboxFilesByAccount(files = []) {
  const groups = new Map();
  for (const file of files) {
    const key = `${file.accountName}\u0000${file.ownerLabel}\u0000${file.sourceType}`;
    if (!groups.has(key)) {
      groups.set(key, {
        key,
        accountName: file.accountName,
        ownerLabel: file.ownerLabel,
        institution: file.institution,
        sourceType: file.sourceType,
        supportedFileTypes: file.supportedFileTypes,
        coveredAccountNames: file.coveredAccounts?.map((account) => account.accountName) ?? [],
        files: []
      });
    }
    groups.get(key).files.push(file);
  }
  return Array.from(groups.values());
}

// A bank's checklist lines by owner, then by account inside each owner, so
// one person's downloads sit together. Owners keep the order they first
// appear in the download order.
export function groupInboxFilesByOwner(files = []) {
  const filesByOwner = new Map();
  for (const file of files) {
    if (!filesByOwner.has(file.ownerLabel)) {
      filesByOwner.set(file.ownerLabel, []);
    }
    filesByOwner.get(file.ownerLabel).push(file);
  }
  return Array.from(filesByOwner, ([ownerLabel, ownerFiles]) => ({
    ownerLabel,
    accounts: groupInboxFilesByAccount(ownerFiles)
  }));
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
