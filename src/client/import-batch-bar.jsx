import * as Popover from "@radix-ui/react-popover";
import { Check } from "lucide-react";
import { useLayoutEffect, useState } from "react";

import { messages } from "./copy/en-SG";
import { EntryMobileSheet } from "./entry-mobile-sheet";
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
                    <button type="button" className={`import-blocker-chip is-${blocker.effect}`} onClick={() => onJump(blocker)}>
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

// One file of the batch: a done file goes to its summary, the file in
// review to its review, a waiting file opens. `inline` keeps the ask-first
// popover inside the phone sheet, which holds focus inside itself.
function ImportFileChip({ file, canShowDone, hasUnsavedReviewWork, inline = false, onOpenFile, onShowCurrentFile, onShowDoneFile }) {
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
  // Opening another file drops the row edits and fixes of the one in
  // review, so it asks first, like the commit button does.
  return (
    <ImportAskFirst
      question={hasUnsavedReviewWork ? messages.imports.batchSwitchWarning(file.title) : null}
      inline={inline}
      onConfirm={() => onOpenFile(file.item)}
    >
      {({ onClick }) => (
        <button
          type="button"
          className="import-file-chip is-waiting"
          title={file.title}
          aria-label={messages.imports.batchFileWaiting(file.label)}
          onClick={onClick}
        >
          <span>{file.label}</span>
        </button>
      )}
    </ImportAskFirst>
  );
}

/**
 * Runs `onConfirm` straight away, or, with a `question`, asks first in a
 * popover (never a browser dialog): Cancel keeps the review as it is, "Open
 * anyway" goes on. `children` renders the trigger button from the click
 * handler it is given.
 *
 * @param {{ question: string | null, inline?: boolean, onConfirm: () => void, children: (props: { onClick: (() => void) | undefined }) => import("react").ReactElement }} props
 */
export function ImportAskFirst({ question, inline = false, onConfirm, children }) {
  const [isAsking, setIsAsking] = useState(false);
  if (!question) {
    return children({ onClick: onConfirm });
  }
  const content = (
    <Popover.Content className="delete-popover import-file-switch-warning" sideOffset={8} align="start">
      <p>{question}</p>
      <div className="delete-popover-actions">
        <Popover.Close asChild>
          <button type="button" className="subtle-action">{messages.imports.batchSwitchCancel}</button>
        </Popover.Close>
        <button
          type="button"
          className="subtle-action"
          onClick={() => {
            setIsAsking(false);
            onConfirm();
          }}
        >
          {messages.imports.batchSwitchConfirm}
        </button>
      </div>
    </Popover.Content>
  );
  return (
    <Popover.Root open={isAsking} onOpenChange={setIsAsking}>
      <Popover.Trigger asChild>{children({ onClick: undefined })}</Popover.Trigger>
      {inline ? content : <Popover.Portal>{content}</Popover.Portal>}
    </Popover.Root>
  );
}

// The phone's view of the import bar, opened from the commit bar's "{n}
// things left": the batch's file chips and the blockers, in the shared
// mobile sheet. The panel closes the sheet before it runs a chip's action,
// so a jump lands after focus has come back from the sheet.
export function ImportProgressSheet({
  batch,
  doneImportId,
  hasUnsavedReviewWork,
  blockers,
  onClose,
  onOpenFile,
  onShowCurrentFile,
  onShowDoneFile,
  onJump
}) {
  return (
    <EntryMobileSheet
      title={messages.imports.batchBarLabel}
      description={messages.imports.blockerThingsLeft(blockers.remainingCount)}
      saveLabel={messages.common.close}
      isSaveDisabled
      onSave={onClose}
      onClose={onClose}
      footerContent={<></>}
    >
      <div className="import-progress-sheet">
        {batch.total ? (
          <section className="import-progress-sheet-section">
            <span className="import-blockers-title" id="import-progress-files-title">{messages.imports.batchFilesLabel}</span>
            <ul className="import-file-chips" aria-labelledby="import-progress-files-title">
              {batch.files.map((file) => (
                <li key={file.id}>
                  <ImportFileChip
                    file={file}
                    canShowDone={file.state === "done" && Boolean(doneImportId) && file.importId === doneImportId}
                    hasUnsavedReviewWork={hasUnsavedReviewWork}
                    inline
                    onOpenFile={onOpenFile}
                    onShowCurrentFile={onShowCurrentFile}
                    onShowDoneFile={onShowDoneFile}
                  />
                </li>
              ))}
            </ul>
            <span className="import-file-position">{messages.imports.batchFilePosition(batch.index, batch.total)}</span>
          </section>
        ) : null}
        {blockers.blockers.length ? (
          <section className="import-progress-sheet-section">
            <span className="import-blockers-title" id="import-progress-blockers-title">{messages.imports.blockersTitle}</span>
            <ul className="import-blocker-list" aria-labelledby="import-progress-blockers-title">
              {blockers.blockers.map((blocker) => (
                <li key={blocker.id}>
                  <button type="button" className={`import-blocker-chip is-${blocker.effect}`} onClick={() => onJump(blocker)}>
                    {blocker.label}
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </div>
    </EntryMobileSheet>
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
