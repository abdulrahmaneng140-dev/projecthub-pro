const router = require('express').Router();
const { pool } = require('../db');
const { authMiddleware, requireRole } = require('../middleware/auth');
const { triggerWebhooks } = require('./integrations');

const log = async (pool, type, msg, icon, color, userId, userName) =>
  pool.query('INSERT INTO activity_log (type,message,icon,color,user_id,user_name) VALUES ($1,$2,$3,$4,$5,$6)',
    [type, msg, icon, color, userId, userName]).catch(() => {});

// GET all tasks (engineer sees only own)
router.get('/', authMiddleware, async (req, res) => {
  try {
    let q = 'SELECT * FROM tasks';
    let params = [];
    if (req.user.role === 'engineer') {
      q += ' WHERE assigned_to=$1';
      params = [req.user.name];
    }
    if (req.query.project) {
      q += (params.length ? ' AND' : ' WHERE') + ` project_id=$${params.length + 1}`;
      params.push(req.query.project);
    }
    q += ' ORDER BY created_at DESC';
    const { rows } = await pool.query(q, params);
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST create task
router.post('/', authMiddleware, requireRole('admin', 'pm', 'lead', 'engineer'), async (req, res) => {
  const { title, project_id, priority, col, assigned_to, due_date, hours_estimated, notes } = req.body;
  if (!title) return res.status(400).json({ error: 'عنوان المهمة مطلوب' });
  try {
    const { rows } = await pool.query(
      `INSERT INTO tasks (title,project_id,priority,col,assigned_to,due_date,hours_estimated,notes,created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [title, project_id, priority||'med', col||'todo', assigned_to||'', due_date||null, hours_estimated||0, notes||'', req.user.id]
    );
    await log(pool, 'task', `إضافة مهمة: ${title}`, 'ti-circle-plus', '#22c87a', req.user.id, req.user.name);
    triggerWebhooks('task.created', rows[0]);
    res.status(201).json(rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// PUT update task
router.put('/:id', authMiddleware, async (req, res) => {
  const { title, project_id, priority, col, assigned_to, due_date, hours_estimated, notes } = req.body;
  try {
    // Engineer can only update own tasks
    if (req.user.role === 'engineer') {
      const { rows: check } = await pool.query('SELECT assigned_to FROM tasks WHERE id=$1', [req.params.id]);
      if (check[0]?.assigned_to !== req.user.name)
        return res.status(403).json({ error: 'يمكنك تعديل مهامك فقط' });
    }
    const { rows } = await pool.query(
      `UPDATE tasks SET
        title=COALESCE($1,title), project_id=COALESCE($2,project_id),
        priority=COALESCE($3,priority), col=COALESCE($4,col),
        assigned_to=COALESCE($5,assigned_to), due_date=COALESCE($6,due_date),
        hours_estimated=COALESCE($7,hours_estimated), notes=COALESCE($8,notes),
        updated_at=NOW()
       WHERE id=$9 RETURNING *`,
      [title, project_id, priority, col, assigned_to, due_date||null, hours_estimated, notes, req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'المهمة غير موجودة' });
    await log(pool, 'task', `تعديل مهمة: ${rows[0].title}`, 'ti-edit', '#f0a030', req.user.id, req.user.name);
    triggerWebhooks('task.updated', rows[0]);
    res.json(rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// DELETE task
router.delete('/:id', authMiddleware, requireRole('admin', 'pm', 'lead'), async (req, res) => {
  const { rows } = await pool.query('DELETE FROM tasks WHERE id=$1 RETURNING title', [req.params.id]);
  if (!rows.length) return res.status(404).json({ error: 'المهمة غير موجودة' });
  await log(pool, 'task', `حذف مهمة: ${rows[0].title}`, 'ti-trash', '#f05a5a', req.user.id, req.user.name);
  res.json({ success: true });
});

module.exports = router;
