import { expect, test } from "@playwright/test";

import { expectFits } from "./fit-check.js";
import { STRESS, addWaitingTaps, seedStressHousehold } from "./fit-stress-fixture.js";
import { gotoPageAfterApi, postJson, reseedDemo } from "./helpers";

// A trip page's "how firm the total is" and "Needs a look" (DOMAIN.md "Trip
// page"): Spent in parts (not on a statement yet, estimated), each an
// openable figure whose View entries opens the trip view at the part to the
// cent; a count of payments with no amount yet; and a short list of real
// doubts, each with one way to fix it, that is not there at all when
// nothing needs a look. Fit-checked with the heavy household.

// Days counted back from today, so the won taxi is a recent estimate (an
// old one would need a look of its own).
const day = (back) => new Date(Date.now() - back * 86_400_000).toISOString().slice(0, 10);
const MONTH = day(0).slice(0, 7);

async function seedTrip(page, { doubts = true } = {}) {
  await reseedDemo(page);
  const make = (description, date, amountMinor, extra = {}) => postJson(page, "/api/entries/create", {
    date, description, accountName: "UOB One", categoryName: "Travel", amountMinor, entryType: "expense", ownershipType: "direct", ownerName: "Tim", ...extra
  }).then((body) => body.entryId);
  const ids = [
    await make("LOTTE HOTEL SEOUL", day(6), 119_820),
    await make("GWANGJANG MARKET", day(5), 3_680, { categoryName: "Food & Drinks" }),
    // A taxi paid in won: an estimate until the card statement comes in.
    await make("KAKAO T", day(4), 2_000, { categoryName: "Public Transport", originalAmountMinor: 2_000_000, originalCurrency: "KRW" })
  ];
  if (doubts) {
    ids.push(await make("GWANGJANG MARKET", day(5), 3_680, { categoryName: "Food & Drinks" }));
    ids.push(await make("MYSTERY STALL", day(3), 1_200, { categoryName: "Other" }));
    ids.push(await make("ANOTHER STALL", day(2), 900, { categoryName: "Other" }));
    ids.push(await make("THIRD STALL", day(1), 700, { categoryName: "Other" }));
  }
  const { tripEvent } = await postJson(page, "/api/trip-events/save", { name: "Seoul trip", startDate: day(6), endDate: day(0), currency: "KRW" });
  await postJson(page, "/api/trip-events/entries/set", { entryIds: ids, tripEventId: tripEvent.id });
  return { tripEvent, ids };
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => window.localStorage.setItem("monies-map:money-totals-visible", "true"));
});

const tripPage = (page) => page.locator("[data-trip-page]");
const menu = (page) => page.locator('[data-figure-menu="trip"]');
const lead = (page) => page.locator("[data-trip-lead]");

test.describe("desktop", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("the parts add up to Spent and open Entries at themselves; Needs a look lists only the doubts and fixes each where it is fixed", async ({ page }) => {
    const { tripEvent, ids } = await seedTrip(page);
    const answer = await (await page.request.get(`/api/trip-page?trip=${tripEvent.id}`)).json();
    const estimate = answer.tripPage.firmness.parts.find((part) => part.part === "estimate");
    expect(estimate?.amountMinor).toBe(2_000);
    await gotoPageAfterApi(page, `/trips/${tripEvent.id}?view=household&month=${MONTH}`, "/api/trip-page", () => tripPage(page));
    const spent = answer.tripPage.spentMinor;
    const firm = tripPage(page).locator("[data-trip-firmness]");
    await expect(firm.locator("[data-trip-firm]")).toHaveText([
      /^Not on a statement yet\$[\d,.]+$/,
      /^Estimated\$[\d,.]+$/
    ]);
    const money = (minor) => `$${(minor / 100).toLocaleString("en-SG", { minimumFractionDigits: 2 })}`;
    await expect(firm.locator('[data-trip-firm="estimate"] .trip-owed-amount')).toHaveText(money(estimate.amountMinor));
    await expect(firm.locator('[data-trip-firm="waiting"] .trip-owed-amount')).toHaveText(money(spent - estimate.amountMinor));

    // The estimated part opens the trip view at its own money.
    await firm.locator('[data-trip-firm="estimate"] .trip-owed-amount').click();
    await menu(page).getByRole("button", { name: "View entries" }).click();
    await expect(page).toHaveURL(/\/entries\?.*entry_trip=/);
    await expect(lead(page).locator("[data-trip-spent]")).toHaveText(money(estimate.amountMinor));
    await expect(page.locator(".entry-row")).toHaveCount(1);
    await page.goBack();

    // Needs a look: the copy first, then the three in Other; three shown,
    // then Spending mix's "Show all 4".
    const look = page.locator('[data-trip-card="look"]');
    await expect(look.getByRole("heading", { name: "Needs a look" })).toBeVisible();
    await expect(look.locator("[data-trip-look]")).toHaveCount(3);
    await expect(look.locator("[data-trip-look]").first()).toContainText("Same day and amount as GWANGJANG MARKET. One may be a copy.");
    await look.getByRole("button", { name: "Show all 4" }).click();
    await expect(look.locator("[data-trip-look]")).toHaveCount(4);
    await expect(look.locator('[data-trip-look="other_category"]').first()).toContainText("In Other, so it has no category yet.");
    await expect(look.getByRole("button", { name: "Show fewer" })).toBeVisible();

    // See both: the trip view with just the two.
    await look.getByRole("button", { name: "See both: GWANGJANG MARKET" }).click();
    await expect(page).toHaveURL(/entry_trip=.*entry_id=.*entry_id=/);
    await expect(page.locator(".entry-row")).toHaveCount(2);
    await page.goBack();

    // Open: that entry's editor, in the trip view (whose lead opens the trip again).
    await page.locator('[data-trip-card="look"]').getByRole("button", { name: "Open: MYSTERY STALL" }).click();
    await expect(page).toHaveURL(new RegExp(`editing_entry=${ids[4]}`));
    await expect(page.locator(".entry-edit-card.is-inline")).toBeVisible({ timeout: 30_000 });
    await expect(lead(page).getByRole("button", { name: "Open Seoul trip" })).toBeVisible();

    // Hidden money: the parts show no amount.
    await page.goto(`/trips/${tripEvent.id}?view=household&month=${MONTH}`);
    await expect(firm).toBeVisible();
    await page.getByRole("button", { name: "Hide money totals" }).first().click();
    await expect(firm).not.toContainText("$");
    await expect(firm.locator('[data-trip-firm="estimate"]')).toContainText("••••");
  });

  test("an ordinary trip has no Needs a look card at all", async ({ page }) => {
    const { tripEvent } = await seedTrip(page, { doubts: false });
    await gotoPageAfterApi(page, `/trips/${tripEvent.id}?view=household&month=${MONTH}`, "/api/trip-page", () => tripPage(page));
    await expect(tripPage(page).locator("[data-trip-firmness]")).toBeVisible();
    await expect(page.locator('[data-trip-card="look"]')).toHaveCount(0);
    await expect(tripPage(page)).not.toContainText("Needs a look");
  });
});

// The phone fit check (docs/code-spec.md "Phone fit check") with the heavy
// household's trip: long names, a long rupiah estimate, payments with no
// amount yet and a doubt in Other; and the two desktop widths.
for (const viewport of [{ width: 320, height: 568 }, { width: 375, height: 557 }, { width: 390, height: 844 }, { width: 1280, height: 800 }, { width: 1440, height: 900 }]) {
  test.describe(`fit ${viewport.width}x${viewport.height}`, () => {
    test.use({ viewport, ...(viewport.width < 768 ? { isMobile: true, hasTouch: true } : {}) });

    test("the trip page's parts and Needs a look fit", async ({ page }) => {
      const { tripEvent } = await seedStressHousehold(page);
      await addWaitingTaps(page, 1);
      const other = await postJson(page, "/api/entries/create", {
        date: STRESS.today, description: STRESS.noSpaceShop, accountName: "UOB One", categoryName: "Other", amountMinor: 98_765_432, entryType: "expense", ownershipType: "direct", ownerName: STRESS.tim
      });
      await postJson(page, "/api/trip-events/entries/set", { entryIds: [other.entryId], tripEventId: tripEvent.id });
      await gotoPageAfterApi(page, `/trips/${tripEvent.id}?view=household&month=${STRESS.month}`, "/api/trip-page", () => tripPage(page));
      await expect(tripPage(page).locator("[data-trip-firmness]")).toBeVisible();
      await expect(tripPage(page).locator("[data-trip-no-amount]")).toHaveText("1 payment with no amount yet");
      await expect(page.locator('[data-trip-card="look"] [data-trip-look="other_category"]').first()).toBeVisible();
      await expectFits(page, { root: "[data-trip-page]" });
    });
  });
}
