// Small wording helpers shared by the copy modules.
// "1 row", "2 rows": a count with the matching form of its noun.
export const countOf = (count, singular, plural = `${singular}s`) => `${count} ${count === 1 ? singular : plural}`;
// "A", "A and B", "A, B and C".
export const listOf = (names) => names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}` : names[0] ?? "";
