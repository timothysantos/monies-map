// Apple Pay Shortcut purchases in another currency for API tests: a saved
// SGD/IDR rate (the test Worker runs with FX_RATES_OFFLINE), the Shortcut
// token, and a Wallet purchase posted the way the Shortcut posts it.
export const TOKEN = "test-shortcut-token";

export async function enableShortcut(db, settings = {}) {
  await db.prepare("INSERT OR REPLACE INTO app_settings (key, value_json) VALUES ('shortcut_api', ?)").bind(JSON.stringify({ apiKey: TOKEN, ...settings })).run();
}

export async function saveRate(db, { quotePerBase = 14025, fetchedAt = new Date().toISOString(), rateDate = "2026-10-02", source = "frankfurter" } = {}) {
  await db.prepare("INSERT OR REPLACE INTO fx_rates (base_currency, quote_currency, quote_per_base, rate_date, source, fetched_at) VALUES ('SGD', 'IDR', ?, ?, ?, ?)")
    .bind(quotePerBase, rateDate, source, fetchedAt).run();
}

export async function postWalletPurchase(fetchWorker, body) {
  const response = await fetchWorker(`/api/shortcuts/entries/create?shortcut_token=${TOKEN}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ date: "2026-10-03", ...body })
  });
  return { status: response.status, payload: await response.json() };
}
