/**
 * Weekly D1 → R2 backup cron worker.
 * Exports all tables as JSON to R2 with rolling 8-week retention.
 *
 * Configure in wrangler.toml:
 * [triggers]
 * crons = ["0 3 * * 0"]  # Every Sunday at 03:00 UTC
 *
 * Validates: REQ-073
 */

interface Env {
  DB: D1Database;
  R2: R2Bucket;
}

const TABLES = ['comments', 'trusted_emails', 'subscribers', 'dispatches'];
const RETENTION_WEEKS = 8;

export default {
  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
    const timestamp = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
    const backupKey = `backups/${timestamp}/`;

    console.log(`[backup] Starting D1 → R2 backup: ${timestamp}`);

    // Export each table
    for (const table of TABLES) {
      try {
        const result = await env.DB.prepare(`SELECT * FROM ${table}`).all();
        const rows = result.results || [];
        const json = JSON.stringify(rows, null, 2);

        await env.R2.put(`${backupKey}${table}.json`, json, {
          httpMetadata: { contentType: 'application/json' },
          customMetadata: { table, rowCount: String(rows.length), timestamp },
        });

        console.log(`[backup] ${table}: ${rows.length} rows exported`);
      } catch (e) {
        console.error(`[backup] Failed to export ${table}:`, e);
      }
    }

    // Write manifest
    const manifest = {
      timestamp,
      tables: TABLES,
      createdAt: new Date().toISOString(),
    };
    await env.R2.put(`${backupKey}_manifest.json`, JSON.stringify(manifest, null, 2), {
      httpMetadata: { contentType: 'application/json' },
    });

    // Cleanup old backups (keep last RETENTION_WEEKS)
    try {
      const listed = await env.R2.list({ prefix: 'backups/' });
      const folders = new Set<string>();
      for (const obj of listed.objects) {
        const parts = obj.key.split('/');
        if (parts.length >= 2) folders.add(parts[1]); // date folder
      }

      const sortedDates = [...folders].sort().reverse();
      const toDelete = sortedDates.slice(RETENTION_WEEKS);

      for (const date of toDelete) {
        const oldObjects = await env.R2.list({ prefix: `backups/${date}/` });
        for (const obj of oldObjects.objects) {
          await env.R2.delete(obj.key);
        }
        console.log(`[backup] Deleted old backup: ${date}`);
      }
    } catch (e) {
      console.error('[backup] Cleanup failed:', e);
    }

    console.log(`[backup] Complete: ${timestamp}`);
  },
};
