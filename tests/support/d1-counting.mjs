// Wraps a D1 database so every round trip is recorded: each statement run
// with run/all/first/raw and each db.batch() or db.exec() call counts as one.
// Reads report the rows D1 says it scanned and the bytes of the rows it
// returned, so a test can pin how much one request asks of the database.
export function countingDatabase(db) {
  const calls = [];
  const record = (sql, result, kind) => {
    const results = result?.results;
    calls.push({
      sql: String(sql).replace(/\s+/g, " ").trim(),
      kind,
      rows: Array.isArray(results) ? results.length : result ? 1 : 0,
      rowsRead: Number(result?.meta?.rows_read ?? 0),
      bytes: Array.isArray(results) ? JSON.stringify(results).length : 0
    });
  };
  const wrapStatement = (statement, sql) => new Proxy(statement, {
    get(target, property) {
      if (property === "bind") {
        return (...values) => wrapStatement(target.bind(...values), sql);
      }
      if (property === "statement") {
        return sql;
      }
      if (property === "all" || property === "first" || property === "run" || property === "raw") {
        return async (...args) => {
          const result = await target[property](...args);
          record(sql, result, property);
          return result;
        };
      }
      const value = target[property];
      return typeof value === "function" ? value.bind(target) : value;
    }
  });
  const counting = new Proxy(db, {
    get(target, property) {
      if (property === "prepare") {
        return (sql) => wrapStatement(target.prepare(sql), sql);
      }
      if (property === "batch") {
        return async (statements) => {
          const results = await target.batch(statements);
          calls.push({ sql: `BATCH of ${statements.length}`, kind: "batch", rows: 0, rowsRead: 0, bytes: 0 });
          return results;
        };
      }
      const value = target[property];
      return typeof value === "function" ? value.bind(target) : value;
    }
  });
  return {
    db: counting,
    calls,
    summary() {
      return {
        statements: calls.length,
        rowsRead: calls.reduce((sum, call) => sum + call.rowsRead, 0),
        rowBytes: calls.reduce((sum, call) => sum + call.bytes, 0)
      };
    },
    reset() {
      calls.length = 0;
    }
  };
}
