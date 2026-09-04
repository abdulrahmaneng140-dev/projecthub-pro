const router = require('express').Router();
const { pool } = require('../db');
const { authMiddleware, requireRole } = require('../middleware/auth');
const { triggerWebhooks } = require('./integrations');

function riskScore(p, i) { return p * i; }
function riskLevel(score) {
  if (score >= 15) return 'high';
  if (score >= 8) return 'medium';
  return 'low';
}

// ── GET /api/risks/summary/high — across all projects, for dashboard widget ──
// (registered before /:project so it isn't swallowed by the wildcard)
router.get('/summary/high', authMiddleware, async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT r.*, p.name AS project_name
      FROM risk_register r JOIN projects p ON p.id = r.project_id
      WHERE r.status IN ('open','occurred')
      ORDER BY (r.probability * r.impact) DESC
    `);
    const high = rows.filter(r => riskScore(r.probability, r.impact) >= 15);
    res.json(high);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── GET /api/risks/:project ──
router.get('/:project', authMiddleware, async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM risk_register WHERE project_id=$1 ORDER BY rn NULLS LAST, id', [req.params.project]);
    res.json(rows.map(r => ({ ...r, score: riskScore(r.probability, r.impact), level: riskLevel(riskScore(r.probability, r.impact)) })));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── POST /api/risks/:project ──
router.post('/:project', authMiddleware, requireRole('admin', 'pm', 'lead'), async (req, res) => {
  const { description, category, probability, impact, owner, mitigation_plan, contingency_plan, review_date } = req.body;
  if (!description) return res.status(400).json({ error: 'وصف الخطر مطلوب' });
  try {
    const { rows: maxRow } = await pool.query('SELECT COALESCE(MAX(rn),0)+1 AS next_rn FROM risk_register WHERE project_id=$1', [req.params.project]);
    const { rows } = await pool.query(
      `INSERT INTO risk_register (project_id, rn, description, category, probability, impact, owner, mitigation_plan, contingency_plan, review_date, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
      [req.params.project, maxRow[0].next_rn, description, category || 'technical', probability || 3, impact || 3,
        owner || null, mitigation_plan || null, contingency_plan || null, review_date || null, req.user.id]
    );
    const r = rows[0];
    const score = riskScore(r.probability, r.impact);
    if (score >= 15) triggerWebhooks('risk.high', r);
    res.status(201).json({ ...r, score, level: riskLevel(score) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── PUT /api/risks/item/:id ──
router.put('/item/:id', authMiddleware, requireRole('admin', 'pm', 'lead'), async (req, res) => {
  const { description, category, probability, impact, owner, mitigation_plan, contingency_plan, status, review_date } = req.body;
  try {
    const { rows } = await pool.query(
      `UPDATE risk_register SET
        description=COALESCE($1,description), category=COALESCE($2,category), probability=COALESCE($3,probability),
        impact=COALESCE($4,impact), owner=COALESCE($5,owner), mitigation_plan=COALESCE($6,mitigation_plan),
        contingency_plan=COALESCE($7,contingency_plan), status=COALESCE($8,status), review_date=COALESCE($9,review_date), updated_at=NOW()
       WHERE id=$10 RETURNING *`,
      [description, category, probability, impact, owner, mitigation_plan, contingency_plan, status, review_date, req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'الخطر غير موجود' });
    const r = rows[0];
    const score = riskScore(r.probability, r.impact);
    res.json({ ...r, score, level: riskLevel(score) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete('/item/:id', authMiddleware, requireRole('admin', 'pm', 'lead'), async (req, res) => {
  await pool.query('DELETE FROM risk_register WHERE id=$1', [req.params.id]);
  res.json({ success: true });
});

module.exports = router;
