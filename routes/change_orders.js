const router = require('express').Router();
const { pool } = require('../db');
const { authMiddleware, requireRole } = require('../middleware/auth');
const { triggerWebhooks } = require('./integrations');

// ── GET /api/change-orders/:project ──
router.get('/:project', authMiddleware, async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM change_orders WHERE project_id=$1 ORDER BY id DESC', [req.params.project]);
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── POST /api/change-orders/:project ──
router.post('/:project', authMiddleware, requireRole('admin', 'pm', 'lead'), async (req, res) => {
  const { title, description, reason, requested_by, cost_impact, schedule_impact_days } = req.body;
  if (!title) return res.status(400).json({ error: 'عنوان التغيير مطلوب' });
  try {
    const { rows: cnt } = await pool.query('SELECT COUNT(*)+1 AS next_no FROM change_orders WHERE project_id=$1', [req.params.project]);
    const co_number = `CO-${req.params.project}-${String(cnt[0].next_no).padStart(3, '0')}`;
    const { rows } = await pool.query(
      `INSERT INTO change_orders (project_id, co_number, title, description, reason, requested_by, cost_impact, schedule_impact_days, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [req.params.project, co_number, title, description || null, reason || null, requested_by || req.user.name,
        cost_impact || 0, schedule_impact_days || 0, req.user.id]
    );
    res.status(201).json(rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── PUT /api/change-orders/item/:id — edit or change approval status ──
// When status flips to 'approved', the cost_impact is added onto the project's budget automatically
// (a change order is scope the client/project owner has accepted, so it should extend the budget, not eat into it).
router.put('/item/:id', authMiddleware, requireRole('admin', 'pm'), async (req, res) => {
  const { title, description, reason, cost_impact, schedule_impact_days, status, approved_by } = req.body;
  try {
    const { rows: before } = await pool.query('SELECT * FROM change_orders WHERE id=$1', [req.params.id]);
    if (!before.length) return res.status(404).json({ error: 'التغيير غير موجود' });
    const wasApproved = before[0].status === 'approved';

    const autoApprovalDate = status === 'approved' && !wasApproved ? new Date().toISOString().slice(0, 10) : before[0].approval_date;
    const { rows } = await pool.query(
      `UPDATE change_orders SET
        title=COALESCE($1,title), description=COALESCE($2,description), reason=COALESCE($3,reason),
        cost_impact=COALESCE($4,cost_impact), schedule_impact_days=COALESCE($5,schedule_impact_days),
        status=COALESCE($6,status), approved_by=COALESCE($7,approved_by), approval_date=$8, updated_at=NOW()
       WHERE id=$9 RETURNING *`,
      [title, description, reason, cost_impact, schedule_impact_days, status, approved_by, autoApprovalDate, req.params.id]
    );
    const co = rows[0];

    // Newly approved (wasn't approved before, now is) — extend the project budget by the cost impact
    if (co.status === 'approved' && !wasApproved && co.cost_impact) {
      await pool.query('UPDATE projects SET budget = budget + $1, updated_at = NOW() WHERE id = $2', [co.cost_impact, co.project_id]);
      triggerWebhooks('change_order.approved', co);
    }
    // Un-approving a previously approved CO — reverse the budget adjustment
    if (co.status !== 'approved' && wasApproved && before[0].cost_impact) {
      await pool.query('UPDATE projects SET budget = budget - $1, updated_at = NOW() WHERE id = $2', [before[0].cost_impact, co.project_id]);
    }

    res.json(co);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete('/item/:id', authMiddleware, requireRole('admin', 'pm'), async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM change_orders WHERE id=$1', [req.params.id]);
  if (rows.length && rows[0].status === 'approved' && rows[0].cost_impact) {
    await pool.query('UPDATE projects SET budget = budget - $1 WHERE id = $2', [rows[0].cost_impact, rows[0].project_id]);
  }
  await pool.query('DELETE FROM change_orders WHERE id=$1', [req.params.id]);
  res.json({ success: true });
});

module.exports = router;
