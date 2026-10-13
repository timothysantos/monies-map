export function sanitizeTabParams(params, tabId) {
  // Drop parameters that are irrelevant to the active tab so the route and
  // query cache stay canonical.
  if (tabId !== "entries") {
    [
      "action",
      "amount",
      "merchant",
      "description",
      "date",
      "account",
      "account_id",
      "category",
      "note",
      "owner",
      "shared",
      "editing_entry",
      "entries_scope",
      "entry_id",
      "entry_wallet",
      "entry_category",
      "entry_person",
      "entry_type",
      "entry_min",
      "entry_max",
      "from_ask"
    ].forEach((key) => params.delete(key));
  }

  if (tabId !== "faq") {
    params.delete("faq");
  }

  if (tabId !== "splits") {
    [
      "split_group",
      "split_mode",
      "split_action",
      "editing_split_expense"
    ].forEach((key) => params.delete(key));
  }

  if (tabId !== "ask") {
    ["mode", "from", "saved_entry", "ask_text"].forEach((key) => params.delete(key));
  }
}

// The Ask page's way in from another page: the new entry card from the
// Entries + button (mode "add") or the Splits receipt button (mode
// "expense", with the open split group). The view, month and scope stay.
export function buildAskLocation(currentParams, { mode = "", from = "", splitGroup = "" } = {}) {
  const params = new URLSearchParams();
  for (const key of ["view", "month", "scope"]) {
    const value = currentParams.get(key);
    if (value) {
      params.set(key, value);
    }
  }
  if (mode) params.set("mode", mode);
  if (from) params.set("from", from);
  if (splitGroup) params.set("split_group", splitGroup);
  return { pathname: "/ask", search: `?${params.toString()}` };
}

export function getSelectedTabId(pathname) {
  // Translate the current browser pathname to the app's tab identity.
  if (pathname.startsWith("/entries")) {
    return "entries";
  }

  if (pathname === "/month") {
    return "month";
  }

  if (pathname === "/splits") {
    return "splits";
  }

  if (pathname === "/imports") {
    return "imports";
  }

  if (pathname === "/settings") {
    return "settings";
  }

  if (pathname === "/faq") {
    return "faq";
  }

  if (pathname === "/ask") {
    return "ask";
  }

  return "summary";
}

export function buildRoutePageRequest({ tabId, viewId, month, scope, summaryStart = undefined, summaryEnd = undefined }) {
  // Convert the active tab into the exact page endpoint and query params the
  // server expects for that screen.
  if (tabId === "month") {
    return {
      path: "/api/month-page",
      params: new URLSearchParams({
        view: viewId,
        month,
        scope
      })
    };
  }

  if (tabId === "entries") {
    return {
      path: "/api/entries-page",
      params: new URLSearchParams({
        view: viewId,
        month
      })
    };
  }

  if (tabId === "splits") {
    return {
      path: "/api/splits-page",
      params: new URLSearchParams({
        view: viewId,
        month
      })
    };
  }

  if (tabId === "imports") {
    return { path: "/api/imports-page", params: new URLSearchParams() };
  }

  if (tabId === "settings") {
    return { path: "/api/settings-page", params: new URLSearchParams() };
  }

  return null;
}

// Entries page request params. The Entries API has no scope parameter; scope
// stays in the route intent only.
export function buildEntriesPageParams({ viewId, month }) {
  return new URLSearchParams({
    view: viewId,
    month
  });
}

export function buildPageViewFromRouteData(tabId, pageData, selectedViewId, appShell) {
  // Shape the route-page response into the minimal view object the UI needs.
  // FAQ and Ask have no page request: their view is the shell's person.
  if (tabId === "faq" || tabId === "ask") {
    const fallbackLabel = selectedViewId === "household"
      ? "Household"
      : appShell?.household?.people?.find((person) => person.id === selectedViewId)?.name ?? "Household";
    return {
      id: selectedViewId ?? appShell?.selectedViewId ?? "household",
      label: fallbackLabel
    };
  }

  if (!pageData) {
    return null;
  }

  const fallbackLabel = selectedViewId === "household"
    ? "Household"
    : appShell?.household?.people?.find((person) => person.id === selectedViewId)?.name ?? "Household";
  const baseView = {
    id: pageData.viewId ?? selectedViewId ?? appShell?.selectedViewId ?? "household",
    label: pageData.label ?? fallbackLabel
  };

  if (tabId === "month" && pageData.monthPage) {
    // Month should only expose the month payload here; the summary slice can
    // exist separately, but it must not be synthesized into a second source.
    return {
      ...baseView,
      summaryPage: pageData.summaryPage ?? null,
      monthPage: pageData.monthPage,
      // The view's wallet balances and statement health, fetched beside the
      // month page from the account pills query (not part of monthPage).
      accountPills: pageData.accountPills ?? null
    };
  }

  if (tabId === "entries" && pageData.monthPage) {
    return {
      ...baseView,
      splitsPage: {
        groups: pageData.splitGroups ?? []
      },
      monthPage: pageData.monthPage
    };
  }

  if (tabId === "splits" && pageData.splitsPage) {
    // Splits keeps a small month slice alongside its own data: the month key
    // and the month's transfers, for matching a settlement checkpoint to a
    // bank transfer.
    return {
      ...baseView,
      monthPage: pageData.monthPage ?? null,
      splitsPage: pageData.splitsPage
    };
  }

  if (tabId === "imports" && pageData.importsPage) {
    return {
      ...baseView,
      importsPage: pageData.importsPage
    };
  }

  if (tabId === "settings" && pageData.settingsPage) {
    return {
      ...baseView,
      settingsPage: pageData.settingsPage
    };
  }

  return null;
}

export function getAppShellAvailableViewIds(appShell) {
  if (!appShell) {
    return [];
  }

  if (Array.isArray(appShell.availableViewIds)) {
    return appShell.availableViewIds;
  }

  return [
    "household",
    ...(appShell.household?.people ?? []).map((person) => person.id)
  ];
}

export function resolveRouteViewId(selectedViewId, appShell, fallbackViewId) {
  const availableViewIds = getAppShellAvailableViewIds(appShell);
  if (!availableViewIds.length || availableViewIds.includes(selectedViewId)) {
    return selectedViewId;
  }

  return fallbackViewId ?? appShell?.selectedViewId ?? availableViewIds[0] ?? "household";
}
