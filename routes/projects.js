const router = require('express').Router();
const { pool } = require('../db');
const { authMiddleware, requireRole } = require('../middleware/auth');
const { triggerWebhooks } = require('./integrations');

const log = async (pool, type, msg, icon, color, userId, userName) => {
  await pool.query(
    'INSERT INTO activity_log (type,message,icon,color,user_id,user_name) VALUES ($1,$2,$3,$4,$5,$6)',
    [type, msg, icon, color, userId, userName]
  ).catch(() => {});
};

// GET all projects
router.get('/', authMiddleware, async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT p.*,
        COUNT(t.id) FILTER (WHERE t.col != 'done') AS open_tasks,
        COUNT(t.id) FILTER (WHERE t.col = 'done') AS done_tasks
      FROM projects p
      LEFT JOIN tasks t ON t.project_id = p.id
      GROUP BY p.id ORDER BY p.created_at
    `);
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET single project
router.get('/:id', authMiddleware, async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM projects WHERE id=$1', [req.params.id]);
  if (!rows.length) return res.status(404).json({ error: 'المشروع غير موجود' });
  res.json(rows[0]);
});

// POST create project
router.post('/', authMiddleware, requireRole('admin', 'pm'), async (req, res) => {
  const { id, name, color, pct, status, budget, spent, lead, start_date, end_date, description } = req.body;
  if (!name) return res.status(400).json({ error: 'اسم المشروع مطلوب' });
  try {
    const projId = id || ('P' + Date.now().toString().slice(-6));
    const { rows } = await pool.query(
      `INSERT INTO projects (id,name,color,pct,status,budget,spent,lead,start_date,end_date,description,created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
      [projId, name, color||'#4f8ef7', pct||0, status||'on-track', budget||0, spent||0,
       lead||'', start_date||null, end_date||null, description||'', req.user.id]
    );
    await log(pool, 'project', `إضافة مشروع: ${name}`, 'ti-briefcase', '#22c87a', req.user.id, req.user.name);
    res.status(201).json(rows[0]);
  } catch (e) {
    if (e.code === '23505') return res.status(409).json({ error: 'معرف المشروع موجود مسبقاً' });
    res.status(500).json({ error: e.message });
  }
});

// PUT update project
router.put('/:id', authMiddleware, requireRole('admin', 'pm'), async (req, res) => {
  const { name, color, pct, status, budget, spent, lead, start_date, end_date, description } = req.body;
  try {
    const { rows: before } = await pool.query('SELECT status FROM projects WHERE id=$1', [req.params.id]);
    const { rows } = await pool.query(
      `UPDATE projects SET
        name=COALESCE($1,name), color=COALESCE($2,color), pct=COALESCE($3,pct),
        status=COALESCE($4,status), budget=COALESCE($5,budget), spent=COALESCE($6,spent),
        lead=COALESCE($7,lead), start_date=COALESCE($8,start_date), end_date=COALESCE($9,end_date),
        description=COALESCE($10,description), updated_at=NOW()
       WHERE id=$11 RETURNING *`,
      [name, color, pct, status, budget, spent, lead, start_date||null, end_date||null, description, req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'المشروع غير موجود' });
    await log(pool, 'project', `تعديل مشروع: ${rows[0].name}`, 'ti-edit', '#f0a030', req.user.id, req.user.name);
    if (before[0] && status && before[0].status !== status) triggerWebhooks('project.status_changed', rows[0]);
    if (rows[0].budget > 0 && rows[0].spent / rows[0].budget > 1) triggerWebhooks('project.over_budget', rows[0]);
    res.json(rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// DELETE project
router.delete('/:id', authMiddleware, requireRole('admin', 'pm'), async (req, res) => {
  const { rows } = await pool.query('DELETE FROM projects WHERE id=$1 RETURNING name', [req.params.id]);
  if (!rows.length) return res.status(404).json({ error: 'المشروع غير موجود' });
  await log(pool, 'project', `حذف مشروع: ${rows[0].name}`, 'ti-trash', '#f05a5a', req.user.id, req.user.name);
  res.json({ success: true });
});

module.exports = router;
