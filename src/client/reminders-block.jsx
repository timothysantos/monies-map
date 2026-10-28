import "./reminders.css";
import * as Popover from "@radix-ui/react-popover";
import { CalendarCheck, Check, ChevronRight, CircleDashed, Clock, CreditCard, FileText, Repeat, Users } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";

import { remindersCopy as copy } from "./copy/reminders-copy";
import { unmaskedMoneyWithCurrency } from "./formatters";
import { useMoneyPrivacy } from "./money-privacy";
import { moneyToneClass } from "./money-tone-class";
import { getPersonColourVars } from "./person-colour";
import { hideReminder, laterUntil, markChecklistDoneShown, markChecklistOpen, markRemindersSeen, showReminderAgain } from "./reminders-actions";
import { reminderDeviceState, unseenReminders } from "./reminders-device-state";
import { allInKeysToShow, buildReminderList, cardLimitFor } from "./reminders-model";
import { SheetDialog } from "./sheet-dialog";
import { useReminders } from "./use-reminders";
import { useIsMobileLayout } from "./use-viewport";
import { todayInAppTimeZone } from "../lib/app-calendar";

const ICONS = { card: CreditCard, file: FileText, people: Users, repeat: Repeat, calendar: CalendarCheck };

// The reminder cards at the top of the Ask conversation (docs/flows/
// reminders-flow.md; design.md "Reminders in Ask"): chat mode only, above
// "Since you last looked". Up to 2 cards on a phone and 3 in the wide docked
// panel, then "N more reminders" (one text button that opens the rest in
// place). Each card's main action opens the page that settles it; Later (or
// Got it) puts it away on this device. Shows nothing while there is nothing
// to show, and nothing at all when the read fails.
/**
 * @param {{
 *   queryClient: any, view: { id: string }, enabled: boolean, placement: string,
 *   fetchRequiredQuery: (options: any) => Promise<any>,
 *   onOpen: (target: { pathname: string, extra: Record<string, string> }) => void
 * }} props
 */
export function RemindersBlock({ queryClient, view, enabled, placement, fetchRequiredQuery, onOpen }) {
  const { areTotalsVisible } = useMoneyPrivacy();
  const answer = useReminders({ queryClient, viewId: view.id, enabled, fetchRequiredQuery });
  const state = useSyncExternalStore(reminderDeviceState.subscribe, reminderDeviceState.getSnapshot, reminderDeviceState.getSnapshot);
  const [today] = useState(todayInAppTimeZone);
  const [expanded, setExpanded] = useState(false);
  // What the person put away in this visit: the card folds into one line
  // with Undo instead of vanishing under their thumb.
  const [folded, setFolded] = useState({});
  // The finished checklists whose one "all in" line this visit shows; kept for
  // the visit so the line does not vanish the moment it is marked as shown.
  const allInRef = useRef(/** @type {Set<string>} */ (new Set()));
  const reminders = answer?.reminders ?? null;
  if (reminders) {
    for (const key of allInKeysToShow(reminders, state, today)) allInRef.current.add(key);
  }

  const list = useMemo(() => (reminders ? buildReminderList({
    reminders,
    state,
    today,
    hidden: !areTotalsVisible,
    formatMoney: unmaskedMoneyWithCurrency,
    folded,
    allInKeys: allInRef.current,
    expanded,
    limit: cardLimitFor(placement)
  }) : null), [areTotalsVisible, expanded, folded, placement, reminders, state, today]);

  // Opening Ask with reminders on show marks them seen, so the dot only comes
  // back for a new reminder or one returning from Later; and a checklist
  // shown with something to do is remembered, so its finished line shows once.
  useEffect(() => {
    if (!reminders || !list || !list.entries.length) return;
    markRemindersSeen(unseenReminders(reminders, state, today).map((reminder) => reminder.key), today);
    for (const reminder of reminders) {
      if (reminder.kind !== "month_close") continue;
      if (!reminder.allDone) markChecklistOpen(reminder.key, today);
      else if (allInRef.current.has(reminder.key)) markChecklistDoneShown(reminder.key, today);
    }
  }, [list, reminders, state, today]);

  const choose = useCallback((reminder, change) => {
    if (change.until) laterUntil(reminder.key, change.until, today);
    else hideReminder(reminder.key, today);
    setFolded((current) => ({ ...current, [reminder.key]: change }));
  }, [today]);
  const undo = useCallback((key) => {
    showReminderAgain(key, today);
    setFolded((current) => {
      const next = { ...current };
      delete next[key];
      return next;
    });
  }, [today]);

  if (!list || !list.entries.length) {
    return null;
  }
  return (
    <section className="reminders" aria-label={copy.headingLabel}>
      <p className="ask-k reminders-k"><span>{copy.heading}</span><span>{list.total}</span></p>
      <div className="reminders-list">
        {list.entries.map((/** @type {any} */ entry) => {
          if (entry.kind === "folded") {
            return <FoldedLine key={entry.key} entry={entry} onUndo={() => undo(entry.key)} />;
          }
          if (entry.kind === "month_all_in") {
            return <p key={entry.key} className="reminders-all-in"><Check size={18} aria-hidden="true" />{entry.title}</p>;
          }
          const reminder = reminders.find((item) => item.key === entry.key);
          return <ReminderCard key={entry.key} card={entry} onOpen={onOpen} onChoose={(change) => choose(reminder, change)} />;
        })}
      </div>
      {list.more > 0 ? (
        <button type="button" className="reminders-more" onClick={() => setExpanded(true)}>
          {copy.more(list.more)}
          <ChevronRight size={16} aria-hidden="true" />
        </button>
      ) : null}
    </section>
  );
}

function FoldedLine({ entry, onUndo }) {
  return (
    <p className="reminders-folded" role="status">
      <span>{entry.text}</span>
      <button type="button" className="reminders-folded-undo" onClick={onUndo}>{copy.undo}</button>
    </p>
  );
}

function ReminderCard({ card, onOpen, onChoose }) {
  const Icon = ICONS[card.icon] ?? CreditCard;
  const style = card.personName ? getPersonColourVars(card.personName) : undefined;
  return (
    <article className="reminder-card" data-reminder-kind={card.kind} style={style}>
      <div className="reminder-head">
        <span className={`reminder-bubble is-${card.tone}`}><Icon size={18} aria-hidden="true" /></span>
        <div className="reminder-copy">
          <h3 className="reminder-title">{card.title}</h3>
          <p className="reminder-sentence">{card.sentence}</p>
        </div>
        {card.amountText ? <span className={`reminder-amount ${moneyToneClass(card.amountTone)}`}>{card.amountText}</span> : <span />}
      </div>
      {card.progress ? <Progress progress={card.progress} /> : null}
      {card.rows ? <CheckRows rows={card.rows} onOpen={onOpen} /> : null}
      <div className="reminder-actions">
        <button type="button" className="reminder-button" onClick={() => onOpen(card.target)}>
          {card.primaryLabel}
          <ChevronRight size={16} aria-hidden="true" />
        </button>
        {card.quiet === "got-it" ? (
          <button type="button" className="reminder-button is-quiet" onClick={() => onChoose({ gotIt: true })}>
            <Check size={16} aria-hidden="true" />
            {copy.gotIt}
          </button>
        ) : (
          <LaterControl card={card} onChoose={onChoose} />
        )}
      </div>
    </article>
  );
}

function Progress({ progress }) {
  return (
    <div className="reminder-progress" role="img" aria-label={progress.label}>
      {progress.done.map((done, index) => <i key={index} className={done ? "is-done" : ""} />)}
    </div>
  );
}

function CheckRows({ rows, onOpen }) {
  return (
    <div className="reminder-rows">
      {rows.map((row) => {
        const content = (
          <>
            {row.done ? <Check size={20} aria-hidden="true" /> : <CircleDashed size={20} aria-hidden="true" />}
            <span className="reminder-row-label">{row.label}</span>
            <span className="reminder-row-value">
              {row.amountText ? <strong className={moneyToneClass(row.amountTone)}>{row.amountText}</strong> : null}
              {row.amountText ? " " : ""}{row.value}
            </span>
            <ChevronRight size={16} className={row.target ? "reminder-row-chevron" : "reminder-row-chevron is-none"} aria-hidden="true" />
          </>
        );
        return row.target ? (
          <button key={row.id} type="button" className={`reminder-row is-open${row.done ? " is-done" : ""}`} onClick={() => onOpen(row.target)}>{content}</button>
        ) : (
          <div key={row.id} className={`reminder-row ${row.done ? "is-done" : "is-open"}`}>{content}</div>
        );
      })}
    </div>
  );
}

// "Later": on a phone a bottom sheet in the app's sheet look, on a wide
// screen a small menu under the button (like "More pages"). The same choices:
// three days with their dates, then one "not for this one".
function LaterControl({ card, onChoose }) {
  const isPhone = useIsMobileLayout();
  const [open, setOpen] = useState(false);
  const pick = (change) => {
    setOpen(false);
    onChoose(change);
  };
  const choices = (
    <LaterChoices later={card.later} onPick={pick} />
  );
  if (isPhone) {
    return (
      <>
        <button type="button" className="reminder-button is-quiet" aria-haspopup="dialog" onClick={() => setOpen(true)}>
          <Clock size={16} aria-hidden="true" />
          {copy.later}
        </button>
        {open ? (
          <SheetDialog
            title={copy.laterSheet.title}
            description={card.laterTitle}
            closeLabel={copy.laterSheet.close}
            quietLabel={copy.cancel}
            hideSubmit
            onClose={() => setOpen(false)}
          >
            {choices}
            <p className="reminder-later-note">{card.later.note}</p>
          </SheetDialog>
        ) : null}
      </>
    );
  }
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button type="button" className="reminder-button is-quiet" aria-haspopup="dialog">
          <Clock size={16} aria-hidden="true" />
          {copy.later}
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content className="reminder-later-popover" side="bottom" align="end" sideOffset={6} aria-label={copy.laterSheet.title}>
          <p className="reminder-later-title">{copy.laterSheet.title}</p>
          {choices}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

function LaterChoices({ later, onPick }) {
  return (
    <div className="reminder-later-choices">
      <div className="reminder-pick-group">
        {later.days.map((choice) => (
          <button key={choice.id} type="button" className="reminder-pick" onClick={() => onPick({ until: choice.date })}>
            <span>{choice.label}</span>
            <small>{choice.dateText}</small>
            <ChevronRight size={16} aria-hidden="true" />
          </button>
        ))}
      </div>
      <div className="reminder-pick-group">
        {later.skips.map((skip) => (
          <button key={skip.label} type="button" className="reminder-pick" onClick={() => onPick({ skipped: true })}>
            <span>{skip.label}</span>
            <small>{skip.hint}</small>
            <ChevronRight size={16} aria-hidden="true" />
          </button>
        ))}
      </div>
    </div>
  );
}
