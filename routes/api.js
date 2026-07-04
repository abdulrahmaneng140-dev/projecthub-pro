const router = require('express').Router();
const { pool } = require('../db');
const { authMiddleware, requireRole } = require('../middleware/auth');

const log = async (type, msg, icon, color, userId, userName) =>
  pool.query('INSERT INTO activity_log (type,message,icon,color,user_id,user_name) VALUES ($1,$2,$3,$4,$5,$6)',
    [type, msg, icon, color, userId, userName]).catch(() => {});

// ══ TEAM ══════════════════════════════════════════════════════════════
router.get('/team', authMiddleware, async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM team_members ORDER BY id');
  res.json(rows);
});

router.post('/team', authMiddleware, requireRole('admin', 'pm'), async (req, res) => {
  const { name, role, email, color } = req.body;
  if (!name) return res.status(400).json({ error: 'الاسم مطلوب' });
  const { rows } = await pool.query(
    'INSERT INTO team_members (name,role,email,color) VALUES ($1,$2,$3,$4) RETURNING *',
    [name, role || '', email || '', color || '#4f8ef7']
  );
  await log('user', `إضافة عضو: ${name}`, 'ti-user-plus', '#22c87a', req.user.id, req.user.name);
  res.status(201).json(rows[0]);
});

router.put('/team/:id', authMiddleware, requireRole('admin', 'pm'), async (req, res) => {
  const { name, role, email, color, is_online } = req.body;
  const { rows } = await pool.query(
    `UPDATE team_members SET
      name=COALESCE($1,name), role=COALESCE($2,role),
      email=COALESCE($3,email), color=COALESCE($4,color),
      is_online=COALESCE($5,is_online)
     WHERE id=$6 RETURNING *`,
    [name, role, email, color, is_online, req.params.id]
  );
  if (!rows.length) return res.status(404).json({ error: 'العضو غير موجود' });
  res.json(rows[0]);
});

router.delete('/team/:id', authMiddleware, requireRole('admin'), async (req, res) => {
  const { rows } = await pool.query('DELETE FROM team_members WHERE id=$1 RETURNING name', [req.params.id]);
  if (!rows.length) return res.status(404).json({ error: 'العضو غير موجود' });
  await log('user', `حذف عضو: ${rows[0].name}`, 'ti-user-minus', '#f05a5a', req.user.id, req.user.name);
  res.json({ success: true });
});

// ══ MILESTONES ════════════════════════════════════════════════════════
router.get('/milestones', authMiddleware, async (req, res) => {
  let q = 'SELECT * FROM milestones';
  const params = [];
  if (req.query.project) { q += ' WHERE project_id=$1'; params.push(req.query.project); }
  q += ' ORDER BY start_date';
  const { rows } = await pool.query(q, params);
  res.json(rows);
});

router.post('/milestones', authMiddleware, requireRole('admin', 'pm', 'lead'), async (req, res) => {
  const { title, project_id, type, start_date, end_date, status, pct, notes } = req.body;
  if (!title) return res.status(400).json({ error: 'عنوان المرحلة مطلوب' });
  const { rows } = await pool.query(
    `INSERT INTO milestones (title,project_id,type,start_date,end_date,status,pct,notes,created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
    [title, project_id, type || 'milestone', start_date || null, end_date || null,
     status || 'upcoming', pct || 0, notes || '', req.user.id]
  );
  await log('project', `إضافة milestone: ${title}`, 'ti-flag-3', '#22c87a', req.user.id, req.user.name);
  res.status(201).json(rows[0]);
});

router.put('/milestones/:id', authMiddleware, requireRole('admin', 'pm', 'lead'), async (req, res) => {
  const { title, project_id, type, start_date, end_date, status, pct, notes } = req.body;
  const { rows } = await pool.query(
    `UPDATE milestones SET
      title=COALESCE($1,title), project_id=COALESCE($2,project_id),
      type=COALESCE($3,type), start_date=COALESCE($4,start_date),
      end_date=COALESCE($5,end_date), status=COALESCE($6,status),
      pct=COALESCE($7,pct), notes=COALESCE($8,notes)
     WHERE id=$9 RETURNING *`,
    [title, project_id, type, start_date || null, end_date || null, status, pct, notes, req.params.id]
  );
  if (!rows.length) return res.status(404).json({ error: 'الـ Milestone غير موجود' });
  res.json(rows[0]);
});

router.delete('/milestones/:id', authMiddleware, requireRole('admin', 'pm'), async (req, res) => {
  await pool.query('DELETE FROM milestones WHERE id=$1', [req.params.id]);
  res.json({ success: true });
});

// ══ SITE REPORTS ══════════════════════════════════════════════════════
router.get('/reports', authMiddleware, async (req, res) => {
  let q = 'SELECT * FROM site_reports';
  const params = [];
  const conds = [];
  if (req.query.date) { params.push(req.query.date); conds.push(`report_date=$${params.length}`); }
  if (req.query.project) { params.push(req.query.project); conds.push(`project_id=$${params.length}`); }
  if (conds.length) q += ' WHERE ' + conds.join(' AND ');
  q += ' ORDER BY report_date DESC, created_at DESC LIMIT 100';
  const { rows } = await pool.query(q, params);
  res.json(rows);
});

router.post('/reports', authMiddleware, async (req, res) => {
  const { report_date, project_id, supervisor, weather, temperature,
          workforce, safety_incidents, progress_pct,
          completed_tasks, pending_tasks, issues, notes } = req.body;
  try {
    const { rows } = await pool.query(
      `INSERT INTO site_reports
        (report_date,project_id,supervisor,weather,temperature,workforce,
         safety_incidents,progress_pct,completed_tasks,pending_tasks,issues,notes,created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
       ON CONFLICT (report_date,project_id) DO UPDATE SET
         supervisor=EXCLUDED.supervisor, weather=EXCLUDED.weather,
         temperature=EXCLUDED.temperature, workforce=EXCLUDED.workforce,
         safety_incidents=EXCLUDED.safety_incidents, progress_pct=EXCLUDED.progress_pct,
         completed_tasks=EXCLUDED.completed_tasks, pending_tasks=EXCLUDED.pending_tasks,
         issues=EXCLUDED.issues, notes=EXCLUDED.notes, updated_at=NOW()
       RETURNING *`,
      [report_date, project_id || null, supervisor || req.user.name,
       weather || 'صافٍ', temperature || '38°C', workforce || 0,
       safety_incidents || 0, progress_pct || 0,
       JSON.stringify(completed_tasks || []), JSON.stringify(pending_tasks || []),
       JSON.stringify(issues || []), notes || '', req.user.id]
    );
    await log('reports', `حفظ Site Report: ${report_date}`, 'ti-report', '#22c87a', req.user.id, req.user.name);
    res.json(rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ══ ACTIVITY LOG ══════════════════════════════════════════════════════
router.get('/log', authMiddleware, async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 100, 500);
  const type = req.query.type;
  let q = 'SELECT * FROM activity_log';
  const params = [];
  if (type) { q += ' WHERE type=$1'; params.push(type); }
  q += ` ORDER BY created_at DESC LIMIT ${limit}`;
  const { rows } = await pool.query(q, params);
  res.json(rows);
});

// ══ DASHBOARD STATS ═══════════════════════════════════════════════════
router.get('/stats', authMiddleware, async (req, res) => {
  try {
    const [projects, tasks, team, budget] = await Promise.all([
      pool.query('SELECT COUNT(*) as total, COUNT(*) FILTER (WHERE status=\'on-track\') as on_track, COUNT(*) FILTER (WHERE status=\'delayed\') as delayed FROM projects'),
      pool.query(`SELECT COUNT(*) as total,
        COUNT(*) FILTER (WHERE col!='done') as open,
        COUNT(*) FILTER (WHERE col='done') as done,
        COUNT(*) FILTER (WHERE priority='high' AND col!='done') as high_open FROM tasks`),
      pool.query('SELECT COUNT(*) as total, COUNT(*) FILTER (WHERE is_online=true) as online FROM team_members'),
      pool.query('SELECT COALESCE(SUM(budget),0) as total_budget, COALESCE(SUM(spent),0) as total_spent FROM projects'),
    ]);
    res.json({
      projects: projects.rows[0],
      tasks: tasks.rows[0],
      team: team.rows[0],
      budget: budget.rows[0],
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
