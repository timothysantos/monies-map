import assert from "node:assert/strict";
import test from "node:test";
import { access } from "node:fs/promises";

import { createSeededTemplate, openSeededDatabase } from "./support/d1-workspace.mjs";

test("a run shares only its seed template; writes and disposal stay isolated", async (t) => {
  const previous = process.env.MONIES_TEST_D1_TEMPLATE;
  delete process.env.MONIES_TEST_D1_TEMPLATE;
  const source = await createSeededTemplate();
  t.after(async () => {
    if (previous === undefined) delete process.env.MONIES_TEST_D1_TEMPLATE;
    else process.env.MONIES_TEST_D1_TEMPLATE = previous;
    await source.dispose();
  });
  process.env.MONIES_TEST_D1_TEMPLATE = source.persistTo;
  const shared = await createSeededTemplate();
  assert.equal(shared.persistTo, source.persistTo);
  await shared.dispose();
  await access(source.persistTo);

  const first = await openSeededDatabase(t, shared);
  const second = await openSeededDatabase(t, shared);
  await first.db.prepare("UPDATE people SET display_name = 'Private test change' WHERE id = 'person-tim'").run();
  assert.equal((await second.db.prepare("SELECT display_name FROM people WHERE id = 'person-tim'").first()).display_name, "Tim");

  // A different fixture must seed its own template, even within a shared run.
  const custom = await createSeededTemplate({ vars: { DEMO_DATASET: "showcase" } });
  t.after(() => custom.dispose());
  assert.notEqual(custom.persistTo, source.persistTo);
  assert.equal(custom.config.vars.DEMO_DATASET, "showcase");
  const customDb = await openSeededDatabase(t, custom);
  assert.equal((await customDb.db.prepare("SELECT display_name FROM people WHERE id = 'person-ethan'").first()).display_name, "Ethan");
  assert.equal(await customDb.db.prepare("SELECT id FROM people WHERE id = 'person-tim'").first(), null);
});
