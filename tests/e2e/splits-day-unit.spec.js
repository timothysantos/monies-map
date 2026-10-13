import { expect, test } from "@playwright/test";
import sharp from "sharp";

import { gotoPageAfterApi, postJson, reseedDemo } from "./helpers";

// A day on Splits reads as one unit, the way a day on Entries does
// (design.md, "Splits activity list"): the date is a quiet label above that
// day's rounded group, not a box of its own. On the orange panel the sticky
// header takes the panel's own colour, so it leaves no band behind the label.
// (The header staying sticky is also proved in splits-date-groups.spec.js.)

const MONTH = "2026-06";

async function seedSplitsDay(page, marker) {
  await reseedDemo(page);
  for (let index = 0; index < 3; index += 1) {
    await postJson(page, "/api/splits/expenses/create", {
      date: `${MONTH}-12`,
      description: `${marker} ${index + 1}`,
      categoryName: "Food & Drinks",
      payerPersonName: "Joyce",
      amountMinor: 1000 + index,
      groupId: null,
      note: "day unit"
    });
  }
  await gotoPageAfterApi(
    page,
    `/splits?view=person-tim&month=${MONTH}&split_group=split-group-none`,
    "/api/splits-page",
    () => page.locator(".split-activity-card").filter({ hasText: `${marker} 1` }).first()
  );
}

// A day's geometry and type, measured the same way on Splits and Entries.
function readDayUnit(page, { head, rows }) {
  return page.evaluate(({ head, rows }) => {
    const header = document.querySelector(head);
    const group = document.querySelector(rows);
    const text = header.querySelector(":scope > strong");
    const headerBox = header.getBoundingClientRect();
    const groupBox = group.getBoundingClientRect();
    const headerStyle = getComputedStyle(header);
    const textStyle = getComputedStyle(text);
    const rule = getComputedStyle(text, "::after");
    const groupStyle = getComputedStyle(group);
    return {
      header: {
        left: headerBox.left,
        width: headerBox.width,
        height: headerBox.height,
        radius: headerStyle.borderTopLeftRadius,
        borders: [headerStyle.borderTopWidth, headerStyle.borderBottomWidth, headerStyle.borderLeftWidth],
        boxShadow: headerStyle.boxShadow,
        position: headerStyle.position
      },
      group: { left: groupBox.left, width: groupBox.width, radius: parseFloat(groupStyle.borderTopLeftRadius), overflow: groupStyle.overflow },
      labelOffset: text.getBoundingClientRect().left - groupBox.left,
      type: { size: textStyle.fontSize, family: textStyle.fontFamily, tracking: textStyle.letterSpacing, transform: textStyle.textTransform, weight: textStyle.fontWeight, ruleHeight: rule.height, ruleContent: rule.content }
    };
  }, { head, rows });
}

for (const [name, viewport] of [["desktop", { width: 1280, height: 800 }], ["phone", { width: 390, height: 844 }]]) {
  test(`${name}: a Splits day is a quiet date label over one rounded group, like an Entries day`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await seedSplitsDay(page, `Playwright day unit ${name} ${Date.now()}`);

    const splits = await readDayUnit(page, { head: ".split-date-header", rows: ".split-date-items" });
    // The date is not a box: no border, radius or shadow of its own...
    expect(splits.header.radius).toBe("0px");
    expect(splits.header.borders).toEqual(["0px", "0px", "0px"]);
    expect(splits.header.boxShadow).toBe("none");
    // ...and it lines up with the group under it: same left edge and width,
    // the label inset like Entries', the group's corners rounded.
    expect(Math.abs(splits.header.left - splits.group.left)).toBeLessThanOrEqual(1);
    expect(Math.abs(splits.header.width - splits.group.width)).toBeLessThanOrEqual(1);
    expect(splits.labelOffset).toBeLessThanOrEqual(8);
    expect(splits.group.radius).toBeGreaterThanOrEqual(16);
    expect(splits.group.overflow).toBe("hidden");
    // Still sticky, tall enough for its 44px refresh button, and the button is there.
    expect(splits.header.position).toBe("sticky");
    expect(splits.header.height).toBeGreaterThanOrEqual(44);
    await expect(page.getByRole("button", { name: "Refresh split rows for 12 Jun 2026" })).toBeVisible();

    // The same label type as an Entries day: size, face, tracking, case, and
    // the hairline rule after it; the same group radius; the same unboxed head.
    const shell = await page.request.get("/api/app-shell");
    const month = (await shell.json()).trackedMonths.at(-1);
    await gotoPageAfterApi(page, `/entries?view=person-tim&month=${month}`, "/api/entries-page", () => page.locator(".entries-date-head").first());
    const entries = await readDayUnit(page, { head: ".entries-date-head", rows: ".entries-date-group .entries-rows" });
    expect(splits.type).toEqual(entries.type);
    expect(splits.type.ruleHeight).toBe("1px");
    expect(splits.group.radius).toBe(entries.group.radius);
    expect(splits.header.radius).toBe(entries.header.radius);
    expect(splits.header.borders).toEqual(entries.header.borders);
  });

  test(`${name}: the Splits date label paints the panel's own colour, so no band shows behind it`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await seedSplitsDay(page, `Playwright day band ${name} ${Date.now()}`);
    const header = page.locator(".split-date-header").first();
    await header.scrollIntoViewIfNeeded();
    const box = await header.boundingBox();
    const panel = await page.locator(".panel-splits").boundingBox();
    expect(box).not.toBeNull();
    // A pixel in the header's top padding, and one in the panel's own side
    // padding level with it: the same colour to within 2 per channel.
    const pixel = async (x, y) => {
      const png = await page.screenshot({ clip: { x, y, width: 1, height: 1 } });
      const { data } = await sharp(png).raw().toBuffer({ resolveWithObject: true });
      return [data[0], data[1], data[2]];
    };
    const inHeader = await pixel(box.x + box.width / 2, box.y + 3);
    const besideHeader = await pixel(Math.max(panel.x + 2, box.x - 6), box.y + 3);
    for (let channel = 0; channel < 3; channel += 1) {
      expect(Math.abs(inHeader[channel] - besideHeader[channel]), `channel ${channel}: ${inHeader} vs ${besideHeader}`).toBeLessThanOrEqual(2);
    }
  });
}
