const router = require('express').Router();
const { pool } = require('../db');
const { authMiddleware, requireRole } = require('../middleware/auth');
const { triggerWebhooks } = require('./integrations');

// Quick-start templates — common document sets عبدالرحمن works with.
// These are just convenience presets; any document list can be added manually too.
const TEMPLATES = {
  gmp_validation: [
    { name: 'Feasibility Study', category: 'planning' },
    { name: 'URS (User Requirement Specification)', category: 'planning' },
    { name: 'IQ Protocol', category: 'validation' },
    { name: 'OQ Protocol', category: 'validation' },
    { name: 'PQ Protocol', category: 'validation' },
    { name: 'Thermal Mapping Report', category: 'validation' },
    { name: 'GMP Compliance Certificate', category: 'compliance' },
    { name: 'Risk Assessment', category: 'compliance' },
    { name: 'As-Built Drawings', category: 'handover' },
    { name: 'O&M Manual', category: 'handover' },
  ],
  bms_handover: [
    { name: 'Network Architecture Diagram', category: 'technical' },
    { name: 'Points List / IO Schedule', category: 'technical' },
    { name: 'Panel Wiring Diagrams', category: 'technical' },
    { name: 'FAT Report', category: 'testing' },
    { name: 'SAT Report', category: 'testing' },
    { name: 'As-Built Drawings', category: 'handover' },
    { name: 'O&M Manual', category: 'handover' },
    { name: 'Training Records', category: 'handover' },
  ],
  general: [
    { name: 'Project Charter', category: 'planning' },
    { name: 'Contract / PO', category: 'planning' },
    { name: 'Progress Reports Archive', category: 'reporting' },
    { name: 'Final Handover Document', category: 'handover' },
  ],
};

router.get('/templates', authMiddleware, (req, res) => {
  res.json(Object.entries(TEMPLATES).map(([key, items]) => ({ key, count: items.length, items })));
});

// GET /api/documents/summary/missing — across ALL projects, for dashboard widget
// (must be registered before the /:project wildcard route below)
router.get('/summary/missing', authMiddleware, async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT d.*, p.name AS project_name
      FROM project_documents d JOIN projects p ON p.id = d.project_id
      WHERE d.status = 'missing'
      ORDER BY d.due_date NULLS LAST, p.name
    `);
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/documents/:project — all document rows for a project
router.get('/:project', authMiddleware, async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM project_documents WHERE project_id=$1 ORDER BY category, name', [req.params.project]);
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Shared helper — used by both the route below and portfolio project-templates
async function applyDocumentTemplate(projectId, templateKey, userId) {
  const items = TEMPLATES[templateKey];
  if (!items) return 0;
  let added = 0;
  for (const item of items) {
    const existing = await pool.query('SELECT id FROM project_documents WHERE project_id=$1 AND name=$2', [projectId, item.name]);
    if (!existing.rows.length) {
      await pool.query(
        'INSERT INTO project_documents (project_id, name, category, created_by) VALUES ($1,$2,$3,$4)',
        [projectId, item.name, item.category, userId]
      );
      added++;
    }
  }
  return added;
}

// POST /api/documents/:project/apply-template  { template: 'gmp_validation' }
router.post('/:project/apply-template', authMiddleware, requireRole('admin', 'pm', 'lead'), async (req, res) => {
  const { template } = req.body;
  if (!TEMPLATES[template]) return res.status(400).json({ error: 'قالب غير معروف — المتاح: ' + Object.keys(TEMPLATES).join(', ') });
  try {
    const added = await applyDocumentTemplate(req.params.project, template, req.user.id);
    res.json({ added, total: TEMPLATES[template].length });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/documents/:project — add a single custom required document
router.post('/:project', authMiddleware, requireRole('admin', 'pm', 'lead'), async (req, res) => {
  const { name, category, due_date } = req.body;
  if (!name) return res.status(400).json({ error: 'اسم المستند مطلوب' });
  try {
    const { rows } = await pool.query(
      'INSERT INTO project_documents (project_id, name, category, due_date, created_by) VALUES ($1,$2,$3,$4,$5) RETURNING *',
      [req.params.project, name, category || 'general', due_date || null, req.user.id]
    );
    res.status(201).json(rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// PUT /api/documents/item/:id — update status / attach file link (e.g. OneDrive URL)
router.put('/item/:id', authMiddleware, async (req, res) => {
  const { status, file_url, notes, due_date } = req.body;
  try {
    const setUploaded = status === 'uploaded' || status === 'under_review' || status === 'approved';
    const { rows } = await pool.query(
      `UPDATE project_documents SET
        status=COALESCE($1,status), file_url=COALESCE($2,file_url), notes=COALESCE($3,notes),
        due_date=COALESCE($4,due_date), updated_at=NOW(),
        uploaded_by=CASE WHEN $5 THEN $6 ELSE uploaded_by END,
        uploaded_at=CASE WHEN $5 THEN NOW() ELSE uploaded_at END
       WHERE id=$7 RETURNING *`,
      [status, file_url, notes, due_date || null, setUploaded, req.user.id, req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'المستند غير موجود' });
    await pool.query(
      'INSERT INTO activity_log (type,message,icon,color,user_id,user_name) VALUES ($1,$2,$3,$4,$5,$6)',
      ['documents', `تحديث مستند: ${rows[0].name} → ${rows[0].status}`, 'ti-file-text', '#4f8ef7', req.user.id, req.user.name]
    );
    res.json(rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// DELETE /api/documents/item/:id
router.delete('/item/:id', authMiddleware, requireRole('admin', 'pm', 'lead'), async (req, res) => {
  await pool.query('DELETE FROM project_documents WHERE id=$1', [req.params.id]);
  res.json({ success: true });
});

// POST /api/documents-check/run — scan for missing/overdue docs, create notifications + fire webhooks
// (mirrors the existing KPI alert-check pattern; can be called on the same hourly interval)
async function runDocumentCheck() {
  const today = new Date().toISOString().slice(0, 10);
  const { rows: missing } = await pool.query(`
    SELECT d.*, p.name AS project_name
    FROM project_documents d JOIN projects p ON p.id = d.project_id
    WHERE d.status = 'missing'
  `);

  let added = 0;
  for (const doc of missing) {
    const overdue = doc.due_date && doc.due_date < today;
    const message = overdue
      ? `مستند متأخر: ${doc.name} — مشروع ${doc.project_name}`
      : `مستند ناقص: ${doc.name} — مشروع ${doc.project_name}`;

    const existing = await pool.query(
      "SELECT id FROM notifications WHERE message=$1 AND created_at > NOW() - INTERVAL '24 hours'",
      [message]
    );
    if (existing.rows.length) continue;

    await pool.query(
      'INSERT INTO notifications (type,level,message,project_id,icon,color) VALUES ($1,$2,$3,$4,$5,$6)',
      ['document', overdue ? 'critical' : 'warning', message, doc.project_id, 'ti-file-off', overdue ? '#f05a5a' : '#f0a030']
    );
    added++;
    if (overdue) triggerWebhooks('document.overdue', doc);
  }
  return { checked: missing.length, added };
}

router.post('/check/run', authMiddleware, async (req, res) => {
  try {
    const result = await runDocumentCheck();
    res.json(result);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = { router, runDocumentCheck, applyDocumentTemplate };
