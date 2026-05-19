/**
 * D1 database helpers for Cerita Basim.
 * All queries go through these wrappers for consistent error handling.
 */

export function getDB(locals: App.Locals): D1Database {
  const env = (locals as any).runtime?.env;
  const db = env?.DB;
  if (!db) throw new Error('D1 database binding not available — check wrangler.toml bindings');
  return db;
}

export async function queryAll<T = Record<string, unknown>>(
  db: D1Database,
  sql: string,
  params: unknown[] = []
): Promise<T[]> {
  const stmt = db.prepare(sql).bind(...params);
  const result = await stmt.all<T>();
  return result.results ?? [];
}

export async function queryFirst<T = Record<string, unknown>>(
  db: D1Database,
  sql: string,
  params: unknown[] = []
): Promise<T | null> {
  const stmt = db.prepare(sql).bind(...params);
  const result = await stmt.first<T>();
  return result ?? null;
}

export async function execute(
  db: D1Database,
  sql: string,
  params: unknown[] = []
): Promise<D1Result> {
  const stmt = db.prepare(sql).bind(...params);
  return stmt.run();
}
