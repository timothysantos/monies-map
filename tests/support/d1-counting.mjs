// Wraps a D1 database so every round trip is recorded: each statement run
// with run/all/first/raw and each db.batch() or db.exec() call counts as one.
// Reads report the rows D1 says it scanned and the bytes of the rows it
// returned, so a test can pin how much one request asks of the database.
//
// `latencyMs` adds that much wait before every round trip, the way a Worker
// waits on the network for production D1 (tens of milliseconds a call), so
// a measurement can show what a chain of sequential reads costs in
// production. `waves` counts the round trips a request waits on one after
// another: calls that overlap (Promise.all) share a wave.
export function countingDatabase(db, { latencyMs = 0 } = {}) {
  const calls = [];
  const delay = () => (latencyMs > 0 ? new Promise((resolve) => setTimeout(resolve, latencyMs)) : null);
  const record = (sql, result, kind, startedAt, params) => {
    const results = result?.results;
    calls.push({
      sql: String(sql).replace(/\s+/g, " ").trim(),
      // Kept for EXPLAIN QUERY PLAN in measurements; never print them.
      params,
      kind,
      rows: Array.isArray(results) ? results.length : result ? 1 : 0,
      rowsRead: Number(result?.meta?.rows_read ?? 0),
      bytes: Array.isArray(results) ? JSON.stringify(results).length : 0,
      startedAt,
      endedAt: performance.now()
    });
  };
  const wrapStatement = (statement, sql, params = []) => new Proxy(statement, {
    get(target, property) {
      if (property === "bind") {
        return (...values) => wrapStatement(target.bind(...values), sql, values);
      }
      if (property === "statement") {
        return sql;
      }
      if (property === "all" || property === "first" || property === "run" || property === "raw") {
        return async (...args) => {
          const startedAt = performance.now();
          await delay();
          const result = await target[property](...args);
          record(sql, result, property, startedAt, params);
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
          const startedAt = performance.now();
          await delay();
          const results = await target.batch(statements);
          // rowsRead and bytes stay 0 so every existing budget counts as before;
          // what the batch's statements read is kept beside them.
          calls.push({
            sql: `BATCH of ${statements.length}`,
            kind: "batch",
            rows: 0,
            rowsRead: 0,
            bytes: 0,
            statements: statements.length,
            batchRowsRead: results.reduce((sum, item) => sum + Number(item?.meta?.rows_read ?? 0), 0),
            batchBytes: results.reduce((sum, item) => sum + (Array.isArray(item?.results) ? JSON.stringify(item.results).length : 0), 0),
            startedAt,
            endedAt: performance.now()
          });
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
        rowBytes: calls.reduce((sum, call) => sum + call.bytes, 0),
        // SQL statements, a batch counting each of its own, and what batches read.
        sqlStatements: calls.reduce((sum, call) => sum + (call.statements ?? 1), 0),
        batchRowsRead: calls.reduce((sum, call) => sum + (call.batchRowsRead ?? 0), 0),
        batchBytes: calls.reduce((sum, call) => sum + (call.batchBytes ?? 0), 0),
        waves: countWaves(calls)
      };
    },
    reset() {
      calls.length = 0;
    }
  };
}

// Round trips waited on one after another (the longest chain): a call's
// depth is one more than the deepest call that had finished when it started.
export function countWaves(calls) {
  const ordered = [...calls].sort((left, right) => left.startedAt - right.startedAt);
  const depths = [];
  for (const call of ordered) {
    let deepest = 0;
    ordered.forEach((earlier, index) => {
      if (index < depths.length && earlier.endedAt <= call.startedAt) {
        deepest = Math.max(deepest, depths[index]);
      }
    });
    depths.push(deepest + 1);
  }
  return depths.length ? Math.max(...depths) : 0;
}
