// Claude's structured output (output_config.format json_schema) compiles the
// schema into a grammar and refuses a large one: more than 24 optional
// properties or 16 union types ("too many optional parameters"), or a
// grammar that is "too large". The Ask turn schema (one action out of about
// twenty, every field "a value or null") is far over both, and Anthropic
// answered every Ask turn with a 400.
//
// For such a schema the Claude call is not grammar-constrained: the schema is
// given in the prompt instead and the answer is parsed and validated by the
// same parser as before (parseAskTurnAction still checks every field). A
// schema within the limits stays constrained.

const MAX_OPTIONAL = 24;
const MAX_UNIONS = 16;
const MAX_SCHEMA_CHARS = 6000;

type Schema = Record<string, unknown>;

const isSchema = (value: unknown): value is Schema => typeof value === "object" && value !== null && !Array.isArray(value);

function children(node: Schema): Schema[] {
  const out: Schema[] = [];
  if (isSchema(node.properties)) out.push(...Object.values(node.properties).filter(isSchema));
  if (isSchema(node.items)) out.push(node.items);
  if (Array.isArray(node.anyOf)) out.push(...node.anyOf.filter(isSchema));
  return out;
}

// [optional properties, union types] in the schema.
export function measureClaudeSchema(node: Schema): { optional: number; unions: number } {
  let optional = 0;
  let unions = 0;
  if (isSchema(node.properties)) {
    const required = new Set(Array.isArray(node.required) ? node.required : []);
    optional += Object.keys(node.properties).filter((key) => !required.has(key)).length;
  }
  if (Array.isArray(node.anyOf) || Array.isArray(node.type)) unions += 1;
  for (const child of children(node)) {
    const inner = measureClaudeSchema(child);
    optional += inner.optional;
    unions += inner.unions;
  }
  return { optional, unions };
}

export function canConstrainClaudeAnswer(schema: unknown): boolean {
  if (!isSchema(schema)) {
    return true;
  }
  const { optional, unions } = measureClaudeSchema(schema);
  return optional <= MAX_OPTIONAL && unions <= MAX_UNIONS && JSON.stringify(schema).length <= MAX_SCHEMA_CHARS;
}

// The prompt line that stands in for the constraint.
export function describeClaudeAnswerShape(schema: unknown): string {
  return `Answer with one JSON object and nothing else (no code fence). It must match this JSON Schema; use null for a value that does not apply:\n${JSON.stringify(schema)}`;
}
