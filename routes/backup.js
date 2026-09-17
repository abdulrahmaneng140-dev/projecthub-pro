const router = require('express').Router();
const fs = require('fs');
const path = require('path');
const { authMiddleware, requireRole } = require('../middleware/auth');
const { runBackup } = require('../lib/backup');

// GET /api/backup/status — list existing backups (admin only)
router.get('/status', authMiddleware, requireRole('admin'), (req, res) => {
  try {
    const dir = path.join(__dirname, '..', 'backups');
    if (!fs.existsSync(dir)) return res.json({ backups: [] });
    const backups = fs.readdirSync(dir)
      .map(f => {
        const stat = fs.statSync(path.join(dir, f));
        return { name: f, size: stat.size, created: stat.mtime };
      })
      .sort((a, b) => b.created - a.created);
    res.json({ backups });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/backup/run — manual trigger (also runs automatically daily at 2am)
router.post('/run', authMiddleware, requireRole('admin'), async (req, res) => {
  try {
    const file = await runBackup();
    res.json({ success: true, file: path.basename(file) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
