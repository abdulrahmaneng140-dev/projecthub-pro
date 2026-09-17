const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');

// Runs `pg_dump` against DATABASE_URL and saves a timestamped .sql file
// to /backups on disk. Deletes backups older than 30 days automatically.
// pg_dump must be installed (it comes bundled with PostgreSQL) — set
// PG_DUMP_PATH in .env if it's not on your system PATH.
async function runBackup() {
  return new Promise((resolve, reject) => {
    if (!process.env.DATABASE_URL) return reject(new Error('DATABASE_URL غير موجود في .env'));

    const dir = path.join(__dirname, '..', 'backups');
    fs.mkdirSync(dir, { recursive: true });

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const outFile = path.join(dir, `backup-${timestamp}.sql`);
    const pgDumpPath = process.env.PG_DUMP_PATH || 'pg_dump';

    execFile(pgDumpPath, [process.env.DATABASE_URL, '-f', outFile], (err) => {
      if (err) {
        reject(new Error(
          err.code === 'ENOENT'
            ? 'pg_dump مش موجود — ضيفي PG_DUMP_PATH في .env يشاور على مكانه (مثال: C:\\Program Files\\PostgreSQL\\18\\bin\\pg_dump.exe)'
            : err.message
        ));
        return;
      }

      // rotate: delete backups older than 30 days
      try {
        const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
        fs.readdirSync(dir).forEach(f => {
          const fp = path.join(dir, f);
          if (fs.statSync(fp).mtimeMs < cutoff) fs.unlinkSync(fp);
        });
      } catch { /* rotation failure shouldn't fail the backup itself */ }

      resolve(outFile);
    });
  });
}

module.exports = { runBackup };
