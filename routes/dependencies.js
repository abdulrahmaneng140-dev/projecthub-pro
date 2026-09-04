const router = require('express').Router();
const { pool } = require('../db');
const { authMiddleware, requireRole } = require('../middleware/auth');
const { calculateCPM } = require('../lib/cpm');

// ── GET /api/dependencies/:project — all dependency links among a project's tasks ──
router.get('/:project', authMiddleware, async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT d.*, tp.title AS predecessor_title, ts.title AS successor_title
      FROM task_dependencies d
      JOIN tasks tp ON tp.id = d.predecessor_id
      JOIN tasks ts ON ts.id = d.successor_id
      WHERE tp.project_id = $1 OR ts.project_id = $1
      ORDER BY d.id
    `, [req.params.project]);
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── POST /api/dependencies — link two tasks ──
router.post('/', authMiddleware, requireRole('admin', 'pm', 'lead'), async (req, res) => {
  const { predecessor_id, successor_id, type, lag_days } = req.body;
  if (!predecessor_id || !successor_id) return res.status(400).json({ error: 'المهمة السابقة والمهمة اللاحقة مطلوبتين' });
  if (predecessor_id === successor_id) return res.status(400).json({ error: 'مفيش مهمة تقدر تعتمد على نفسها' });
  try {
    const { rows } = await pool.query(
      `INSERT INTO task_dependencies (predecessor_id, successor_id, type, lag_days, created_by)
       VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [predecessor_id, successor_id, type || 'FS', lag_days || 0, req.user.id]
    );
    res.status(201).json(rows[0]);
  } catch (e) {
    if (e.code === '23505') return res.status(409).json({ error: 'الربط ده موجود بالفعل' });
    res.status(500).json({ error: e.message });
  }
});

router.delete('/:id', authMiddleware, requireRole('admin', 'pm', 'lead'), async (req, res) => {
  await pool.query('DELETE FROM task_dependencies WHERE id=$1', [req.params.id]);
  res.json({ success: true });
});

// ══════════════════════════════════════════════════════════════
// GET /api/dependencies/:project/critical-path
// Runs the CPM forward/backward pass over the project's tasks and
// their dependency links, returning ES/EF/LS/LF/float per task and
// which tasks lie on the critical path.
// ══════════════════════════════════════════════════════════════
router.get('/:project/critical-path', authMiddleware, async (req, res) => {
  try {
    const { rows: tasks } = await pool.query(
      'SELECT id, title, duration_days, start_date, due_date, col FROM tasks WHERE project_id=$1', [req.params.project]
    );
    if (!tasks.length) return res.json({ tasks: [], criticalPath: [], projectDurationDays: 0 });

    const { rows: deps } = await pool.query(`
      SELECT d.* FROM task_dependencies d
      JOIN tasks t ON t.id = d.predecessor_id
      WHERE t.project_id = $1
    `, [req.params.project]);

    const cpm = calculateCPM(tasks, deps);
    if (cpm.error === 'circular_dependency') {
      return res.status(400).json({ error: 'فيه دائرة اعتمادية بين المهام (مهمة بتعتمد على نفسها بشكل غير مباشر) — راجعي الروابط' });
    }

    const byId = new Map(tasks.map(t => [t.id, t]));
    const merged = cpm.results.map(r => ({ ...byId.get(r.id), ...r }));
    const criticalPath = merged.filter(t => t.is_critical).sort((a, b) => a.es - b.es);

    res.json({ tasks: merged, criticalPath, projectDurationDays: cpm.projectDuration });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
