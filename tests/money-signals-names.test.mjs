// Place names in Money insights come from raw bank descriptions: reference
// numbers, card and terminal codes, unit numbers, the city and the country
// go, capitals read naturally, and a payment to a person (PayNow, GIRO, a
// transfer) or a bare code gives no name, so the line skips it.
import assert from "node:assert/strict";
import test from "node:test";

import { tidyName } from "../src/domain/money-signals/format.ts";

test("a bank description reads as the place a person would name", () => {
  assert.equal(tidyName("BUS/MRT 912263684 SINGAPORE SG"), "Bus/MRT");
  assert.equal(tidyName("Bus/Mrt 912263684 Singapore Sg"), "Bus/MRT");
  assert.equal(tidyName("GRAB *FOOD 1234"), "Grab Food");
  assert.equal(tidyName("NTUC FP-TAMPINES #01-23 SINGAPORE SG"), "NTUC FP-Tampines");
  assert.equal(tidyName("COURTS MEGASTORE TAMPINES PTE LTD"), "Courts Megastore Tampines");
  assert.equal(tidyName("SHOPEE SG"), "Shopee");
  assert.equal(tidyName("STARBUCKS XX4321 SINGAPORE SGP"), "Starbucks");
  assert.equal(tidyName("7-ELEVEN USD 12.30"), "7-Eleven");
  assert.equal(tidyName("Kopitiam"), "Kopitiam");
  // Payments to a person or an account, codes and generic payment words
  // are not places: nothing to name, so the line skips them.
  assert.equal(tidyName("PAYNOW TRANSFER OTHR PIB2508120123456789 TO TAN AH KOW"), "");
  assert.equal(tidyName("PayNow to 91234567"), "");
  assert.equal(tidyName("GIRO - IRAS"), "");
  assert.equal(tidyName("FUNDS TRANSFER 1234567890"), "");
  assert.equal(tidyName("REF 88812345"), "");
  assert.equal(tidyName("912263684"), "");
  assert.equal(tidyName("POS PURCHASE 12345678"), "");
  assert.equal(tidyName(""), "");
  assert.equal(tidyName(undefined), "");
});
