// The cue on the Ask tab (phone) and the Ask field (desktop): how many
// reminders in this view are new to this device (docs/flows/reminders-flow.md,
// "The dot"). First-screen code, so it stays tiny and makes no request: it
// reads the answer Ask already kept in the query cache (so there is a dot only
// once Ask has read the reminders in this visit, for example a reminder that
// came back from Later or one a refresh found) and what this device
// remembers (reminders-device-state.js). Opening Ask with a reminder on show
// marks it seen and the dot goes.

import { useCallback, useSyncExternalStore } from "react";
import { hashKey } from "@tanstack/react-query";

import { todayInAppTimeZone } from "../lib/app-calendar";
import { queryKeys } from "./query-keys";
import { reminderDeviceState, unseenReminders } from "./reminders-device-state";

/**
 * @param {{ queryClient: any, viewId: string }} options
 * @returns {number} how many reminders are new to this device
 */
export function useRemindersCue({ queryClient, viewId }) {
  const queryKey = queryKeys.reminders(viewId);
  const hash = hashKey(queryKey);
  const subscribe = useCallback((listener) => {
    const stopCache = queryClient.getQueryCache().subscribe((event) => {
      if (event?.query?.queryHash === hash) listener();
    });
    const stopDevice = reminderDeviceState.subscribe(listener);
    return () => {
      stopCache();
      stopDevice();
    };
  }, [hash, queryClient]);
  // The count is a number, so a store read that did not change is equal.
  const read = useCallback(() => {
    const answer = queryClient.getQueryData(queryKey);
    return answer ? unseenReminders(answer.reminders, reminderDeviceState.getSnapshot(), todayInAppTimeZone()).length : 0;
  }, [queryClient, queryKey]);
  return useSyncExternalStore(subscribe, read, read);
}
