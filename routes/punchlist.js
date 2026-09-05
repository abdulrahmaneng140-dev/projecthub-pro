const router = require('express').Router();
const { pool } = require('../db');
const { authMiddleware, requireRole } = require('../middleware/auth');

// ── GET /api/punchlist/summary/open — across all projects, for dashboard widget ──
router.get('/summary/open', authMiddleware, async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT pl.*, p.name AS project_name
      FROM punch_list_items pl JOIN projects p ON p.id = pl.project_id
      WHERE pl.status IN ('open','in_progress')
      ORDER BY pl.severity = 'critical' DESC, pl.raised_date
    `);
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── GET /api/punchlist/:project ──
router.get('/:project', authMiddleware, async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM punch_list_items WHERE project_id=$1 ORDER BY item_no NULLS LAST, id', [req.params.project]);
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── POST /api/punchlist/:project ──
router.post('/:project', authMiddleware, requireRole('admin', 'pm', 'lead'), async (req, res) => {
  const { location, description, discipline, severity, responsible, target_date } = req.body;
  if (!description) return res.status(400).json({ error: 'وصف الملاحظة مطلوب' });
  try {
    const { rows: maxRow } = await pool.query('SELECT COALESCE(MAX(item_no),0)+1 AS next_no FROM punch_list_items WHERE project_id=$1', [req.params.project]);
    const { rows } = await pool.query(
      `INSERT INTO punch_list_items (project_id, item_no, location, description, discipline, severity, responsible, target_date, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [req.params.project, maxRow[0].next_no, location || null, description, discipline || null, severity || 'minor', responsible || null, target_date || null, req.user.id]
    );
    res.status(201).json(rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── PUT /api/punchlist/item/:id ──
router.put('/item/:id', authMiddleware, requireRole('admin', 'pm', 'lead'), async (req, res) => {
  const { location, description, discipline, severity, responsible, status, target_date, verified_by, notes } = req.body;
  try {
    const autoCloseDate = status === 'closed' ? new Date().toISOString().slice(0, 10) : undefined;
    const { rows } = await pool.query(
      `UPDATE punch_list_items SET
        location=COALESCE($1,location), description=COALESCE($2,description), discipline=COALESCE($3,discipline),
        severity=COALESCE($4,severity), responsible=COALESCE($5,responsible), status=COALESCE($6,status),
        target_date=COALESCE($7,target_date), closed_date=COALESCE($8,closed_date),
        verified_by=COALESCE($9,verified_by), notes=COALESCE($10,notes), updated_at=NOW()
       WHERE id=$11 RETURNING *`,
      [location, description, discipline, severity, responsible, status, target_date, autoCloseDate, verified_by, notes, req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'العنصر غير موجود' });
    res.json(rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete('/item/:id', authMiddleware, requireRole('admin', 'pm', 'lead'), async (req, res) => {
  await pool.query('DELETE FROM punch_list_items WHERE id=$1', [req.params.id]);
  res.json({ success: true });
});

module.exports = router;
