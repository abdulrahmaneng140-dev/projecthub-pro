const router = require('express').Router();
const { pool } = require('../db');
const { authMiddleware, requireRole } = require('../middleware/auth');

// ══════════════════════════════════════════════════════════════
// 1. PORTFOLIO DASHBOARD — side-by-side comparison across all projects
// ══════════════════════════════════════════════════════════════
router.get('/dashboard', authMiddleware, async (req, res) => {
  try {
    const [projects, tasks, docs] = await Promise.all([
      pool.query('SELECT * FROM projects ORDER BY created_at'),
      pool.query('SELECT project_id, col, due_date FROM tasks'),
      pool.query("SELECT project_id, status FROM project_documents"),
    ]);

    const today = new Date().toISOString().slice(0, 10);
    const enriched = projects.rows.map(p => {
      const pTasks = tasks.rows.filter(t => t.project_id === p.id);
      const pDocs = docs.rows.filter(d => d.project_id === p.id);
      const overdueTasks = pTasks.filter(t => t.col !== 'done' && t.due_date && t.due_date < today).length;
      const missingDocs = pDocs.filter(d => d.status === 'missing').length;

      let planned = p.pct, spi = 1, cpi = 1;
      if (p.start_date && p.end_date) {
        const start = new Date(p.start_date), end = new Date(p.end_date), now = new Date();
        const totalDays = (end - start) / 86400000;
        const elapsed = Math.max(0, (now - start) / 86400000);
        planned = totalDays > 0 ? Math.min(100, Math.round(elapsed / totalDays * 100)) : p.pct;
        spi = planned > 0 ? +(p.pct / planned).toFixed(2) : 1;
      }
      if (p.budget > 0) cpi = +((p.pct / 100 * p.budget) / Math.max(1, p.spent)).toFixed(2);

      const riskScore = (spi < 0.8 ? 2 : spi < 0.95 ? 1 : 0) + (cpi < 0.8 ? 2 : cpi < 0.95 ? 1 : 0)
        + (overdueTasks > 0 ? 1 : 0) + (missingDocs > 0 ? 1 : 0);

      return { ...p, planned, spi, cpi, overdueTasks, missingDocs, taskCount: pTasks.length, riskScore };
    }).sort((a, b) => b.riskScore - a.riskScore);

    const totals = {
      projects: enriched.length,
      totalBudget: enriched.reduce((a, p) => a + (+p.budget || 0), 0),
      totalSpent: enriched.reduce((a, p) => a + (+p.spent || 0), 0),
      avgProgress: enriched.length ? Math.round(enriched.reduce((a, p) => a + p.pct, 0) / enriched.length) : 0,
      atRisk: enriched.filter(p => p.riskScore >= 3).length,
      totalOverdueTasks: enriched.reduce((a, p) => a + p.overdueTasks, 0),
      totalMissingDocs: enriched.reduce((a, p) => a + p.missingDocs, 0),
    };

    res.json({ totals, projects: enriched });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ══════════════════════════════════════════════════════════════
// 2. RESOURCE ALLOCATION — team load across ALL projects combined
// ══════════════════════════════════════════════════════════════
router.get('/resources', authMiddleware, async (req, res) => {
  try {
    const { rows: tasks } = await pool.query(
      `SELECT assigned_to, project_id, hours_estimated, col, due_date FROM tasks
       WHERE assigned_to IS NOT NULL AND assigned_to != '' AND col != 'done'`
    );
    const byPerson = {};
    for (const t of tasks) {
      if (!byPerson[t.assigned_to]) byPerson[t.assigned_to] = { name: t.assigned_to, totalHours: 0, activeTasks: 0, projects: {}, overdue: 0 };
      const person = byPerson[t.assigned_to];
      person.totalHours += t.hours_estimated || 0;
      person.activeTasks += 1;
      person.projects[t.project_id] = (person.projects[t.project_id] || 0) + (t.hours_estimated || 0);
      const today = new Date().toISOString().slice(0, 10);
      if (t.due_date && t.due_date < today) person.overdue += 1;
    }
    const CAPACITY_HOURS_PER_WEEK = 40;
    const list = Object.values(byPerson).map(p => ({
      ...p,
      projectCount: Object.keys(p.projects).length,
      utilizationPct: Math.round((p.totalHours / CAPACITY_HOURS_PER_WEEK) * 100),
      overallocated: p.totalHours > CAPACITY_HOURS_PER_WEEK,
    })).sort((a, b) => b.totalHours - a.totalHours);

    res.json({ capacityHoursPerWeek: CAPACITY_HOURS_PER_WEEK, team: list });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ══════════════════════════════════════════════════════════════
// 3. PROJECT DEPENDENCIES — cross-project links
// ══════════════════════════════════════════════════════════════
router.get('/dependencies', authMiddleware, async (req, res) => {
  const { project } = req.query;
  try {
    const filter = project ? 'WHERE from_project = $1 OR to_project = $1' : '';
    const args = project ? [project] : [];
    const { rows } = await pool.query(
      `SELECT d.*, pf.name AS from_name, pt.name AS to_name
       FROM project_dependencies d
       JOIN projects pf ON pf.id = d.from_project
       JOIN projects pt ON pt.id = d.to_project
       ${filter} ORDER BY d.created_at DESC`, args
    );
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/dependencies', authMiddleware, requireRole('admin', 'pm', 'lead'), async (req, res) => {
  const { from_project, to_project, type, description } = req.body;
  if (!from_project || !to_project) return res.status(400).json({ error: 'from_project و to_project مطلوبين' });
  if (from_project === to_project) return res.status(400).json({ error: 'المشروع لا يمكن أن يعتمد على نفسه' });
  try {
    const { rows } = await pool.query(
      `INSERT INTO project_dependencies (from_project, to_project, type, description, created_by)
       VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [from_project, to_project, type || 'blocks', description || null, req.user.id]
    );
    res.status(201).json(rows[0]);
  } catch (e) {
    if (e.code === '23505') return res.status(409).json({ error: 'هذا الربط موجود بالفعل' });
    res.status(500).json({ error: e.message });
  }
});

router.delete('/dependencies/:id', authMiddleware, requireRole('admin', 'pm', 'lead'), async (req, res) => {
  await pool.query('DELETE FROM project_dependencies WHERE id=$1', [req.params.id]);
  res.json({ success: true });
});

// ══════════════════════════════════════════════════════════════
// 4. PROJECT TEMPLATES — reusable starting points for new projects
// ══════════════════════════════════════════════════════════════
router.get('/templates', authMiddleware, async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM project_templates ORDER BY name');
  res.json(rows);
});

router.post('/templates', authMiddleware, requireRole('admin', 'pm'), async (req, res) => {
  const { name, description, default_tasks, default_milestones, document_template_key } = req.body;
  if (!name) return res.status(400).json({ error: 'اسم القالب مطلوب' });
  try {
    const { rows } = await pool.query(
      `INSERT INTO project_templates (name, description, default_tasks, default_milestones, document_template_key, created_by)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [name, description || null, JSON.stringify(default_tasks || []), JSON.stringify(default_milestones || []), document_template_key || null, req.user.id]
    );
    res.status(201).json(rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete('/templates/:id', authMiddleware, requireRole('admin', 'pm'), async (req, res) => {
  await pool.query('DELETE FROM project_templates WHERE id=$1', [req.params.id]);
  res.json({ success: true });
});

// POST /api/portfolio/templates/:id/apply  { project_id }
// Applies a template's default tasks/milestones/documents to an EXISTING project
router.post('/templates/:id/apply', authMiddleware, requireRole('admin', 'pm', 'lead'), async (req, res) => {
  const { project_id } = req.body;
  if (!project_id) return res.status(400).json({ error: 'project_id مطلوب' });
  try {
    const { rows: tRows } = await pool.query('SELECT * FROM project_templates WHERE id=$1', [req.params.id]);
    if (!tRows.length) return res.status(404).json({ error: 'القالب غير موجود' });
    const tmpl = tRows[0];
    const projCheck = await pool.query('SELECT id FROM projects WHERE id=$1', [project_id]);
    if (!projCheck.rows.length) return res.status(404).json({ error: 'المشروع غير موجود' });

    let tasksAdded = 0, msAdded = 0, docsAdded = 0;

    for (const t of (tmpl.default_tasks || [])) {
      await pool.query(
        'INSERT INTO tasks (title, project_id, priority, hours_estimated, notes, created_by) VALUES ($1,$2,$3,$4,$5,$6)',
        [t.title, project_id, t.priority || 'med', t.hours_estimated || 0, `من قالب: ${tmpl.name}`, req.user.id]
      );
      tasksAdded++;
    }
    for (const m of (tmpl.default_milestones || [])) {
      await pool.query(
        'INSERT INTO milestones (title, project_id, type, status, pct, notes, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7)',
        [m.title, project_id, 'milestone', 'upcoming', 0, `من قالب: ${tmpl.name}`, req.user.id]
      );
      msAdded++;
    }
    if (tmpl.document_template_key) {
      const { applyDocumentTemplate } = require('./documents');
      if (applyDocumentTemplate) docsAdded = await applyDocumentTemplate(project_id, tmpl.document_template_key, req.user.id);
    }

    res.json({ tasksAdded, msAdded, docsAdded });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
