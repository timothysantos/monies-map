// Claude's structured output accepts only a small number of optional
// properties (24) and union types (16) across a schema; the Ask turn schema
// has far more (every field is "a value or null"), and Anthropic answered
// every Ask turn with a 400 ("too many optional parameters").
//
// prepareClaudeSchema flattens such a schema for the wire: nullable values
// become plain values (empty text, empty list, false, 0 or "" for "not
// given") and every property is required. restore() then turns the model's
// answer back into the original nullable shape, so parsers and the other
// provider are unchanged. A schema within both limits is sent as it is.

const MAX_OPTIONAL = 24;
const MAX_UNIONS = 16;

type Schema = Record<string, unknown>;

const isSchema = (value: unknown): value is Schema => typeof value === "object" && value !== null && !Array.isArray(value);

function nullMember(node: Schema) {
  return Array.isArray(node.anyOf) && node.anyOf.some((member) => isSchema(member) && member.type === "null");
}

function isNullable(node: Schema) {
  return nullMember(node) || (Array.isArray(node.type) && node.type.includes("null"));
}

function children(node: Schema): Schema[] {
  const out: Schema[] = [];
  if (isSchema(node.properties)) out.push(...Object.values(node.properties).filter(isSchema));
  if (isSchema(node.items)) out.push(node.items);
  if (Array.isArray(node.anyOf)) out.push(...node.anyOf.filter(isSchema));
  return out;
}

// [optional properties, union types] in the schema.
function measure(node: Schema): [number, number] {
  let optional = 0;
  let unions = 0;
  if (isSchema(node.properties)) {
    const required = new Set(Array.isArray(node.required) ? node.required : []);
    optional += Object.keys(node.properties).filter((key) => !required.has(key)).length;
  }
  if (Array.isArray(node.anyOf) || Array.isArray(node.type)) unions += 1;
  for (const child of children(node)) {
    const [o, u] = measure(child);
    optional += o;
    unions += u;
  }
  return [optional, unions];
}

// The non-null shape of a nullable node.
function nonNull(node: Schema): Schema {
  if (nullMember(node)) {
    const rest = (node.anyOf as unknown[]).filter((member) => !(isSchema(member) && member.type === "null"));
    return rest.length === 1 && isSchema(rest[0]) ? rest[0] : { ...node, anyOf: rest };
  }
  if (Array.isArray(node.type)) {
    return { ...node, type: node.type.filter((type) => type !== "null") };
  }
  return node;
}

function flatten(node: Schema): Schema {
  const nullable = isNullable(node);
  let out: Schema = nullable ? nonNull(node) : { ...node };
  if (Array.isArray(out.type)) {
    // A remaining multi-type union (text or number) is sent as text.
    out = { ...out, type: out.type.includes("string") ? "string" : out.type[0] };
  }
  if (nullable && Array.isArray(out.enum) && !out.enum.includes("")) {
    out = { ...out, enum: [...out.enum.filter((value) => value !== null), ""] };
  }
  if (isSchema(out.properties)) {
    const properties = Object.fromEntries(Object.entries(out.properties).map(([key, value]) => [key, isSchema(value) ? flatten(value) : value]));
    out = { ...out, properties, required: Object.keys(properties) };
  }
  if (isSchema(out.items)) {
    out = { ...out, items: flatten(out.items) };
  }
  return out;
}

const isEmpty = (value: unknown) => value === null || value === undefined || value === "" || value === false || (Array.isArray(value) && value.length === 0);

// Puts the model's flat answer back into the original nullable shape.
function restoreValue(original: Schema, value: unknown): unknown {
  const nullable = isNullable(original);
  const shape = nullable ? nonNull(original) : original;
  if (isSchema(shape.properties) && isSchema(value)) {
    const restored: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(shape.properties)) {
      if (key in value) {
        restored[key] = isSchema(child) ? restoreValue(child, value[key]) : value[key];
      }
    }
    return nullable && Object.values(restored).every(isEmpty) ? null : restored;
  }
  if (isSchema(shape.items) && Array.isArray(value)) {
    return value.map((item) => restoreValue(shape.items as Schema, item));
  }
  if (nullable && (isEmpty(value) || value === 0)) {
    return null;
  }
  return value;
}

export function prepareClaudeSchema(schema: unknown): { schema: unknown; restore: (value: unknown) => unknown } {
  if (!isSchema(schema)) {
    return { schema, restore: (value) => value };
  }
  const [optional, unions] = measure(schema);
  if (optional <= MAX_OPTIONAL && unions <= MAX_UNIONS) {
    return { schema, restore: (value) => value };
  }
  return {
    schema: {
      ...flatten(schema),
      description: "Where a value does not apply, use \"\" for text, [] for a list, false for a flag and 0 for a number."
    },
    restore: (value) => restoreValue(schema, value)
  };
}
