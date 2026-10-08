import * as Popover from "@radix-ui/react-popover";
import { Check } from "lucide-react";
import { useLayoutEffect, useState } from "react";

import { messages } from "./copy/en-SG";
import "./import-review.css";

// The import bar: the three steps, one chip per file of this session's
// batch (import-batch-model.js) and what blocks a clean commit of the file
// in review (import-blockers-model.js). It sticks to the top of the page
// on desktop and tablet while a batch is in progress; on a phone it
// scrolls with the page and the commit bar is the only sticky bar.
export function ImportBatchBar({
  barRef,
  isSticky,
  stepper,
  batch,
  doneImportId,
  hasUnsavedReviewWork,
  blockers,
  showBlockers,
  onOpenFile,
  onShowCurrentFile,
  onShowDoneFile,
  onJump
}) {
  return (
    <nav ref={barRef} className={`import-batch-bar${isSticky ? " is-sticky" : ""}`} aria-label={messages.imports.batchBarLabel}>
      {stepper}
      {batch.total ? (
        <div className="import-file-strip">
          <ul className="import-file-chips" aria-label={messages.imports.batchFilesLabel}>
            {batch.files.map((file) => (
              <li key={file.id}>
                <ImportFileChip
                  file={file}
                  canShowDone={file.state === "done" && Boolean(doneImportId) && file.importId === doneImportId}
                  hasUnsavedReviewWork={hasUnsavedReviewWork}
                  onOpenFile={onOpenFile}
                  onShowCurrentFile={onShowCurrentFile}
                  onShowDoneFile={onShowDoneFile}
                />
              </li>
            ))}
          </ul>
          <span className="import-file-position">{messages.imports.batchFilePosition(batch.index, batch.total)}</span>
        </div>
      ) : null}
      {showBlockers && (blockers.blockers.length || blockers.matched) ? (
        <div className="import-blockers">
          {blockers.blockers.length ? (
            <>
              <span className="import-blockers-title" id="import-blockers-title">{messages.imports.blockersTitle}</span>
              <ul className="import-blocker-list" aria-labelledby="import-blockers-title">
                {blockers.blockers.map((blocker) => (
                  <li key={blocker.id}>
                    <button type="button" className={`import-blocker-chip is-${blocker.effect}`} onClick={() => onJump(blocker.target)}>
                      {blocker.label}
                    </button>
                  </li>
                ))}
              </ul>
            </>
          ) : null}
          {blockers.matched ? <span className="import-blocker-matched">{blockers.matched.label}</span> : null}
        </div>
      ) : null}
      {/* Announces the count as blockers are fixed. */}
      <span className="import-blockers-live import-sr-only" aria-live="polite">
        {showBlockers && blockers.remainingCount ? messages.imports.blockerThingsLeft(blockers.remainingCount) : ""}
      </span>
    </nav>
  );
}

function ImportFileChip({ file, canShowDone, hasUnsavedReviewWork, onOpenFile, onShowCurrentFile, onShowDoneFile }) {
  const [isAsking, setIsAsking] = useState(false);
  if (file.state === "done") {
    return (
      <button
        type="button"
        className="import-file-chip is-done"
        title={file.title}
        aria-label={messages.imports.batchFileDone(file.label)}
        disabled={!canShowDone}
        onClick={onShowDoneFile}
      >
        <Check size={14} aria-hidden="true" />
        <span>{file.label}</span>
      </button>
    );
  }
  if (file.state === "reviewing") {
    return (
      <button type="button" className="import-file-chip is-reviewing" title={file.title} aria-current="step" onClick={onShowCurrentFile}>
        <span>{file.label}</span>
      </button>
    );
  }
  const chip = (
    <button
      type="button"
      className="import-file-chip is-waiting"
      title={file.title}
      aria-label={messages.imports.batchFileWaiting(file.label)}
      onClick={hasUnsavedReviewWork ? undefined : () => onOpenFile(file.item)}
    >
      <span>{file.label}</span>
    </button>
  );
  if (!hasUnsavedReviewWork) {
    return chip;
  }
  // Opening another file drops the row edits and fixes of the one in
  // review, so it asks first, like the commit button does.
  return (
    <Popover.Root open={isAsking} onOpenChange={setIsAsking}>
      <Popover.Trigger asChild>{chip}</Popover.Trigger>
      <Popover.Portal>
        <Popover.Content className="delete-popover import-file-switch-warning" sideOffset={8} align="start">
          <p>{messages.imports.batchSwitchWarning(file.title)}</p>
          <div className="delete-popover-actions">
            <Popover.Close asChild>
              <button type="button" className="subtle-action">{messages.imports.batchSwitchCancel}</button>
            </Popover.Close>
            <button
              type="button"
              className="subtle-action"
              onClick={() => {
                setIsAsking(false);
                onOpenFile(file.item);
              }}
            >
              {messages.imports.batchSwitchConfirm}
            </button>
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

// Keeps --import-sticky-top (below the app's own sticky environment
// banner) and --import-sticky-offset (where content starts under the bar)
// on the panel, so jump targets land below the bar, never under it.
export function useImportStickyOffset(panelRef, barRef, isSticky) {
  useLayoutEffect(() => {
    const panel = panelRef.current;
    const bar = barRef.current;
    if (!panel || !bar || !isSticky) {
      panel?.style.removeProperty("--import-sticky-offset");
      panel?.style.removeProperty("--import-sticky-top");
      return undefined;
    }
    const measure = () => {
      const banner = document.querySelector(".environment-banner");
      const bannerStyle = banner ? getComputedStyle(banner) : null;
      const top = bannerStyle?.position === "sticky" ? banner.getBoundingClientRect().height : 0;
      panel.style.setProperty("--import-sticky-top", `${top}px`);
      panel.style.setProperty("--import-sticky-offset", `${top + bar.getBoundingClientRect().height}px`);
    };
    measure();
    if (typeof ResizeObserver === "undefined") {
      return undefined;
    }
    const observer = new ResizeObserver(measure);
    observer.observe(bar);
    return () => observer.disconnect();
  }, [barRef, isSticky, panelRef]);
}
