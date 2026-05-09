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
      "entry_type"
    ].forEach((key) => params.delete(key));
  }

  if (tabId !== "splits") {
    [
      "split_group",
      "split_mode",
      "editing_split_expense"
    ].forEach((key) => params.delete(key));
  }
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

  return "summary";
}

export function buildRoutePageRequest({ tabId, viewId, month, scope, summaryStart, summaryEnd }) {
  // Convert the active tab into the exact page endpoint and query params the
  // server expects for that screen.
  if (tabId === "summary") {
    const params = new URLSearchParams({
      view: viewId,
      month,
      scope
    });
    if (summaryStart) {
      params.set("summary_start", summaryStart);
    }
    if (summaryEnd) {
      params.set("summary_end", summaryEnd);
    }
    return { path: "/api/summary-page", params };
  }

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

export function buildPageViewFromRouteData(tabId, pageData, selectedViewId, appShell) {
  // Shape the route-page response into the minimal view object the UI needs.
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

  if (tabId === "summary" && pageData.summaryPage) {
    return {
      ...baseView,
      summaryPage: pageData.summaryPage
    };
  }

  if (tabId === "month" && pageData.monthPage) {
    // Month should only expose the month payload here; the summary slice can
    // exist separately, but it must not be synthesized into a second source.
    return {
      ...baseView,
      summaryPage: pageData.summaryPage ?? null,
      monthPage: pageData.monthPage
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
    // Splits keeps the linked month slice alongside its own data so row
    // matching can work without widening the page-view contract.
    return {
      ...baseView,
      monthPage: pageData.monthPage ?? null,
      splitsPage: pageData.splitsPage
    };
  }

  if (tabId === "imports" || tabId === "settings" || tabId === "faq") {
    return {
      ...baseView,
      ...(tabId === "imports" ? { importsPage: pageData.importsPage } : null),
      ...(tabId === "settings" ? { settingsPage: pageData.settingsPage } : null)
    };
  }

  return null;
}
