// One stated share is enough on Ask's split drafts (the owner's iPhone bug:
// "Add to splits, Joyce's share 1.6" on a saved $7.90 entry was answered
// "How should it be split? The two shares need to add up to the whole
// amount."). The other person has the remainder, a bare number is read as
// dollars or a percentage by the entry's total, the draft card carries both
// people's amounts and percents, and a share that cannot be right is asked
// back in plain words. The rules' own reader (the AI-off backup) reads the
// same phrasings into the same shares.
import assert from "node:assert/strict";
import test from "node:test";

import { parseAskTurnAction, validateAskTurnAction } from "../src/domain/ask-turn.ts";
import { interpretShareNumber, readSharesByRules, readShareMentions } from "../src/domain/ask-turn-shares.ts";

const people = [{ id: "person-tim", name: "Tim" }, { id: "person-joyce", name: "Joyce" }];

function context(text, entry = {}, extra = {}) {
  return {
    today: "2026-10-13",
    month: "2026-10",
    viewId: "person-tim",
    scope: "direct_plus_shared",
    page: "ask",
    people,
    entry: { today: "2026-10-13", accounts: [], people, categoryNames: ["Food & Drinks"], categoryMatchRules: [], defaultAccountPriorityIds: [], viewerName: "Tim" },
    groups: [{ id: "split-group-home", name: "Home", currency: "SGD" }],
    planLines: [],
    focus: {
      kind: "saved_entry",
      entry: {
        entryId: "txn-tori",
        description: "Tori-Q",
        categoryName: "Food & Drinks",
        date: "2026-10-12",
        entryType: "expense",
        accountName: "Apple Pay",
        currency: "SGD",
        amountMinor: 790,
        payerPersonId: "person-tim",
        linkedToSplits: false,
        ...entry
      }
    },
    history: [],
    text,
    ...extra
  };
}

function splitReply(text, shares, entry) {
  const action = parseAskTurnAction({ action: "add_entry_to_splits", split: { payer: null, group: null, shares } });
  assert.ok(action);
  return validateAskTurnAction(action, context(text, entry));
}

function figures(reply) {
  assert.equal(reply.kind, "split_proposal", JSON.stringify(reply));
  return reply.proposal.shares.map((share) => [share.personName, share.amountMinor, Math.round(share.basisPoints / 100)]);
}

// --- The owner's message ----------------------------------------------------

test("\"Add to splits, Joyce's share 1.6\" on $7.90: Joyce $1.60, Tim the remaining $6.30, shown for both", () => {
  const text = "Add to splits, Joyce's share 1.6";
  // The shape that failed in production: Tim listed with nothing in him.
  const withEmptyTim = splitReply(text, [{ person: "Joyce", percent: null, amount: "1.6", all: null }, { person: "Tim", percent: null, amount: null, all: null }]);
  assert.deepEqual(figures(withEmptyTim), [["Tim", 630, 80], ["Joyce", 160, 20]]);
  assert.equal(withEmptyTim.proposal.splitAmountMinor, 630);
  // One share only.
  assert.deepEqual(figures(splitReply(text, [{ person: "Joyce", amount: 1.6 }])), [["Tim", 630, 80], ["Joyce", 160, 20]]);
  // The model derived Tim's 6.3 itself: the figure the person never wrote is dropped, not asked about.
  assert.deepEqual(figures(splitReply(text, [{ person: "Joyce", amount: "1.6" }, { person: "Tim", amount: "6.3" }])), [["Tim", 630, 80], ["Joyce", 160, 20]]);
  // The model read 1.6 as a percentage: a bare number under the total is dollars.
  assert.deepEqual(figures(splitReply(text, [{ person: "Joyce", percent: 1.6 }])), [["Tim", 630, 80], ["Joyce", 160, 20]]);
});

test("a bare number is a guess the card says so about: it offers the percentage reading, and that message reads 1.6%", () => {
  const reply = splitReply("Add to splits, Joyce's share 1.6", [{ person: "Joyce", amount: "1.6" }]);
  assert.equal(reply.proposal.percentGuess.retryText, "Add to splits, Joyce's share is 1.6%");
  const retry = splitReply("Joyce's share is 1.6%", [{ person: "Joyce", amount: "1.6" }]);
  assert.deepEqual(retry.proposal.shares.map((share) => share.amountMinor), [777, 13]);
  assert.equal(retry.proposal.percentGuess, undefined);
});

// --- Phrasings --------------------------------------------------------------

const PHRASINGS = [
  // [message, the model's shares, [Tim, Joyce] amounts, guessed]
  ["Joyce's share 1.6", [{ person: "Joyce", amount: "1.6" }], [630, 160], true],
  ["Joyce pays 2", [{ person: "Joyce", amount: "2" }], [590, 200], true],
  ["Joyce owes me 1.60", [{ person: "Joyce", amount: "1.60" }], [630, 160], true],
  ["Joyce 30%", [{ person: "Joyce", percent: 30 }], [553, 237], false],
  ["Tim 70%", [{ person: "Tim", percent: 70 }], [553, 237], false],
  ["all Joyce", [{ person: "Joyce", all: true }], [0, 790], false],
  ["Joyce's share is 100", [{ person: "Joyce", amount: "100" }], [0, 790], false],
  ["split 50/50", [], [395, 395], false],
  ["Joyce's share is $2", [{ person: "Joyce", percent: 2 }], [590, 200], false],
  ["Joyce's share is 25 percent", [{ person: "Joyce", amount: "25" }], [593, 197], false]
];

for (const [message, shares, [tim, joyce], guessed] of PHRASINGS) {
  test(`phrasing "${message}": Tim ${tim}, Joyce ${joyce}${guessed ? ", a guess" : ""}`, () => {
    const reply = splitReply(message, shares);
    assert.equal(reply.kind, "split_proposal", JSON.stringify(reply));
    assert.deepEqual(reply.proposal.shares.map((share) => share.amountMinor), [tim, joyce]);
    assert.equal(reply.proposal.shares[0].amountMinor + reply.proposal.shares[1].amountMinor, 790);
    assert.equal(Boolean(reply.proposal.percentGuess), guessed);
  });
}

test("with no stated share from the model the text still decides when it names one", () => {
  const reply = splitReply("Add to splits, Joyce's share 1.6", []);
  assert.deepEqual(figures(reply), [["Tim", 630, 80], ["Joyce", 160, 20]]);
  // No share in the words at all stays an even split.
  assert.deepEqual(figures(splitReply("put this on splits", [])), [["Tim", 395, 50], ["Joyce", 395, 50]]);
});

test("a bare number over the entry's total is a percentage, under it dollars (the total decides)", () => {
  assert.deepEqual(interpretShareNumber(30, ["Joyce 30"], 790), { unit: "percent", guessed: true });
  assert.deepEqual(interpretShareNumber(30, ["Joyce 30"], 4_250), { unit: "amount", guessed: true });
  assert.deepEqual(interpretShareNumber(7.9, ["Joyce 7.9"], 790), { unit: "amount", guessed: true });
  assert.deepEqual(interpretShareNumber(30, ["Joyce $30"], 790), { unit: "amount", guessed: false });
  assert.deepEqual(interpretShareNumber(30, ["Joyce 30 dollars"], 790), { unit: "amount", guessed: false });
  assert.deepEqual(interpretShareNumber(30, ["Joyce 30%"], 4_250), { unit: "percent", guessed: false });
  assert.deepEqual(interpretShareNumber(30, ["Joyce 30 percent"], 4_250), { unit: "percent", guessed: false });
  assert.equal(interpretShareNumber(30, ["split it half"], 790), null);
  assert.deepEqual(readShareMentions("split 50/50"), []);
});

// --- Shares that cannot be right ---------------------------------------------

test("negative: more than the total, negative, or zero is asked back in plain words, never drafted", () => {
  const more = splitReply("Joyce's share is $10", [{ person: "Joyce", amount: "10" }]);
  assert.deepEqual(more, { kind: "clarify", question: "Joyce's share can't be more than $7.90.", options: [], error: { code: "share_out_of_range", field: "split.shares" } });
  const pct = splitReply("Joyce 140%", [{ person: "Joyce", percent: 140 }]);
  assert.deepEqual(pct, { kind: "clarify", question: "Joyce's share can't be more than 100%.", options: [], error: { code: "share_out_of_range", field: "split.shares" } });
  const negative = splitReply("Joyce -5%", [{ person: "Joyce", percent: -5 }]);
  assert.deepEqual(negative, { kind: "clarify", question: "Joyce's share can't be negative.", options: [], error: { code: "share_out_of_range", field: "split.shares" } });
  const negativeAmount = splitReply("Joyce owes -2", [{ person: "Joyce", amount: "-2" }]);
  assert.deepEqual(negativeAmount, { kind: "clarify", question: "Joyce's share can't be negative.", options: [], error: { code: "share_out_of_range", field: "split.shares" } });
  const zero = splitReply("Joyce's share is $0", [{ person: "Joyce", amount: "0" }]);
  assert.deepEqual(zero, { kind: "clarify", question: "Joyce's share has to be more than $0. For none of it, say all Tim's.", options: [], error: { code: "share_out_of_range", field: "split.shares" } });
});

test("negative: two stated shares that do not add up are still asked, and an unknown person too", () => {
  const off = splitReply("Joyce 60% Tim 60%", [{ person: "Joyce", percent: 60 }, { person: "Tim", percent: 60 }]);
  assert.equal(off.kind, "clarify");
  assert.match(off.question, /add up/);
  const stranger = splitReply("Serene 30%", [{ person: "Serene", percent: 30 }]);
  assert.equal(stranger.kind, "clarify");
  assert.match(stranger.question, /Whose share/);
  // An amount nowhere in the person's words is still refused.
  const invented = splitReply("Joyce pays some", [{ person: "Joyce", amount: "3" }]);
  assert.equal(invented.kind, "clarify");
});

// --- The rules' own reader (AI off) -----------------------------------------

test("the rules read the same phrasings into the same shares", () => {
  const read = (text) => readSharesByRules(text, people, "person-tim");
  assert.deepEqual(read("Add to splits, Joyce's share 1.6"), { shares: [{ person: "Joyce", amount: "1.6" }] });
  assert.deepEqual(read("Joyce pays 2"), { shares: [{ person: "Joyce", amount: "2" }] });
  assert.deepEqual(read("Joyce owes me 1.60"), { shares: [{ person: "Joyce", amount: "1.60" }] });
  assert.deepEqual(read("Joyce 30%"), { shares: [{ person: "Joyce", percent: 30 }] });
  assert.deepEqual(read("Tim 70%"), { shares: [{ person: "Tim", percent: 70 }] });
  assert.deepEqual(read("all Joyce"), { shares: [{ person: "Joyce", all: true }] });
  assert.deepEqual(read("Joyce's share is 100"), { shares: [{ person: "Joyce", amount: "100" }] });
  assert.deepEqual(read("split 50/50"), { shares: [] });
  assert.deepEqual(read("my share is $3"), { shares: [{ person: "Tim", amount: "3" }] });
  assert.deepEqual(read("Tim $5 and Joyce $2.90"), { shares: [{ person: "Tim", amount: "5" }, { person: "Joyce", amount: "2.90" }] });
  // Nothing about shares in the words: not a split request.
  assert.equal(read("add to splits"), null);
  assert.equal(read("what did I spend on food"), null);
});

test("negative: the rules' shares go through the same checks (a bare 100 is a percentage, $10 is too much)", () => {
  const check = (text) => {
    const raw = readSharesByRules(text, people, "person-tim");
    return splitReply(text, raw.shares);
  };
  assert.deepEqual(figures(check("Joyce's share is 100")), [["Tim", 0, 0], ["Joyce", 790, 100]]);
  assert.deepEqual(figures(check("Joyce's share 1.6")), [["Tim", 630, 80], ["Joyce", 160, 20]]);
  assert.deepEqual(check("Joyce pays $10"), { kind: "clarify", question: "Joyce's share can't be more than $7.90.", options: [], error: { code: "share_out_of_range", field: "split.shares" } });
});
