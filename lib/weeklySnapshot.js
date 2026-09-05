const path = require('path');

// Every Saturday at 8am (via server.js's hourly scheduler), or on-demand
// via POST /api/reports/weekly-snapshot/run, saves updated progress/
// financial/risk PDFs for every project to weekly-reports/<date>/ on disk.
async function generateWeeklyPDFSnapshots() {
  const fs = require('fs');
  const { pool } = require('../db');
  const jwt = require('jsonwebtoken');
  const fetch = require('node-fetch');

  const token = jwt.sign({ id: 1, name: 'System', role: 'admin' }, process.env.JWT_SECRET, { expiresIn: '1h' });
  const { rows: projects } = await pool.query('SELECT id, name FROM projects');
  if (!projects.length) return { saved: 0, dir: null };

  const dateStr = new Date().toISOString().slice(0, 10);
  const dir = path.join(__dirname, '..', 'weekly-reports', dateStr);
  fs.mkdirSync(dir, { recursive: true });

  const types = ['progress', 'financial', 'risk'];
  let saved = 0;
  for (const p of projects) {
    for (const type of types) {
      try {
        const url = `http://localhost:${process.env.PORT || 3000}/api/reports/${type}/pdf?project=${encodeURIComponent(p.id)}`;
        const r = await fetch(url, { headers: { Authorization: 'Bearer ' + token } });
        if (r.ok) {
          const buffer = await r.buffer();
          fs.writeFileSync(path.join(dir, `${p.id}-${type}.pdf`), buffer);
          saved++;
        }
      } catch { /* skip this one file, keep going */ }
    }
  }
  console.log(`✅ Weekly PDF snapshots saved (${saved} files) to ${dir}`);
  return { saved, dir };
}

module.exports = { generateWeeklyPDFSnapshots };
