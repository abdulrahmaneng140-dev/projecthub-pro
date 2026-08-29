const router = require('express').Router();
const crypto = require('crypto');
const { pool } = require('../db');
const { authMiddleware, requireRole } = require('../middleware/auth');

// ══════════════════════════════════════════════════════════════
// OUTBOUND WEBHOOKS — ProjectHub fires HTTP POST to Power Automate
// (or Zapier/Make/n8n) when events happen. Power Automate side:
// use "When an HTTP request is received" trigger + this URL.
// ══════════════════════════════════════════════════════════════
const VALID_EVENTS = ['task.created', 'task.updated', 'project.status_changed', 'project.over_budget', 'milestone.delayed', 'document.overdue'];

router.get('/webhooks', authMiddleware, requireRole('admin', 'pm'), async (req, res) => {
  const { rows } = await pool.query('SELECT id,name,target_url,events,enabled,created_at,last_triggered_at,last_status FROM webhook_subscriptions ORDER BY id DESC');
  res.json(rows);
});

router.post('/webhooks', authMiddleware, requireRole('admin', 'pm'), async (req, res) => {
  const { name, target_url, events } = req.body;
  if (!name || !target_url || !Array.isArray(events) || !events.length)
    return res.status(400).json({ error: 'name و target_url و events (قائمة) مطلوبين' });
  const invalid = events.filter(e => !VALID_EVENTS.includes(e));
  if (invalid.length) return res.status(400).json({ error: `أحداث غير معروفة: ${invalid.join(', ')}. المتاح: ${VALID_EVENTS.join(', ')}` });

  const secret = crypto.randomBytes(24).toString('hex');
  const { rows } = await pool.query(
    'INSERT INTO webhook_subscriptions (name,target_url,events,secret,created_by) VALUES ($1,$2,$3,$4,$5) RETURNING id,name,target_url,events,secret,enabled',
    [name, target_url, events, secret, req.user.id]
  );
  res.status(201).json(rows[0]);
});

router.delete('/webhooks/:id', authMiddleware, requireRole('admin', 'pm'), async (req, res) => {
  await pool.query('DELETE FROM webhook_subscriptions WHERE id=$1', [req.params.id]);
  res.json({ success: true });
});

router.put('/webhooks/:id/toggle', authMiddleware, requireRole('admin', 'pm'), async (req, res) => {
  const { rows } = await pool.query('UPDATE webhook_subscriptions SET enabled = NOT enabled WHERE id=$1 RETURNING enabled', [req.params.id]);
  res.json(rows[0] || {});
});

// Called from other routes (tasks.js, projects.js, kpi alert engine) to fire subscribed webhooks.
// Fire-and-forget: never blocks or throws into the caller's request.
async function triggerWebhooks(event, payload) {
  try {
    const { rows } = await pool.query(
      'SELECT * FROM webhook_subscriptions WHERE enabled = true AND $1 = ANY(events)', [event]
    );
    for (const wh of rows) {
      const body = JSON.stringify({ event, data: payload, timestamp: new Date().toISOString() });
      const signature = crypto.createHmac('sha256', wh.secret).update(body).digest('hex');
      fetch(wh.target_url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-ProjectHub-Signature': signature },
        body,
      }).then(r => {
        pool.query('UPDATE webhook_subscriptions SET last_triggered_at=NOW(), last_status=$1 WHERE id=$2', [r.status, wh.id]).catch(() => {});
      }).catch(() => {
        pool.query('UPDATE webhook_subscriptions SET last_triggered_at=NOW(), last_status=0 WHERE id=$1', [wh.id]).catch(() => {});
      });
    }
  } catch { /* never break the caller */ }
}

// ══════════════════════════════════════════════════════════════
// INBOUND API KEYS — for Power Automate "HTTP" actions calling INTO
// ProjectHub without needing a user login/JWT.
// ══════════════════════════════════════════════════════════════
router.get('/api-keys', authMiddleware, requireRole('admin'), async (req, res) => {
  const { rows } = await pool.query('SELECT id,name,key_prefix,created_at,last_used_at,revoked FROM api_keys ORDER BY id DESC');
  res.json(rows);
});

router.post('/api-keys', authMiddleware, requireRole('admin'), async (req, res) => {
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: 'اسم المفتاح مطلوب' });
  const raw = 'phk_' + crypto.randomBytes(24).toString('hex');
  const hash = crypto.createHash('sha256').update(raw).digest('hex');
  const prefix = raw.slice(0, 12);
  await pool.query('INSERT INTO api_keys (name,key_hash,key_prefix,created_by) VALUES ($1,$2,$3,$4)', [name, hash, prefix, req.user.id]);
  // raw key shown ONCE — not retrievable again
  res.status(201).json({ key: raw, name, prefix });
});

router.delete('/api-keys/:id', authMiddleware, requireRole('admin'), async (req, res) => {
  await pool.query('UPDATE api_keys SET revoked = true WHERE id=$1', [req.params.id]);
  res.json({ success: true });
});

// Middleware: authenticate inbound calls via X-API-Key header (for Power Automate)
async function apiKeyAuth(req, res, next) {
  const key = req.headers['x-api-key'];
  if (!key) return res.status(401).json({ error: 'X-API-Key header مطلوب' });
  const hash = crypto.createHash('sha256').update(key).digest('hex');
  const { rows } = await pool.query('SELECT * FROM api_keys WHERE key_hash=$1 AND revoked=false', [hash]);
  if (!rows.length) return res.status(401).json({ error: 'مفتاح API غير صالح' });
  pool.query('UPDATE api_keys SET last_used_at=NOW() WHERE id=$1', [rows[0].id]).catch(() => {});
  req.apiKey = rows[0];
  next();
}

// ── Inbound endpoints Power Automate can call directly ──
// POST /api/integrations/inbound/tasks  { title, project_id, priority?, due_date?, assigned_to? }
router.post('/inbound/tasks', apiKeyAuth, async (req, res) => {
  const { title, project_id, priority, due_date, assigned_to, notes } = req.body;
  if (!title || !project_id) return res.status(400).json({ error: 'title و project_id مطلوبين' });
  try {
    const { rows } = await pool.query(
      `INSERT INTO tasks (title,project_id,priority,assigned_to,due_date,notes) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [title, project_id, priority || 'med', assigned_to || '', due_date || null, notes || `أُنشئت عبر Power Automate (${req.apiKey.name})`]
    );
    triggerWebhooks('task.created', rows[0]);
    res.status(201).json(rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/integrations/inbound/projects — simple JSON snapshot for Power Automate polling
router.get('/inbound/projects', apiKeyAuth, async (req, res) => {
  const { rows } = await pool.query('SELECT id,name,status,pct,budget,spent,lead,start_date,end_date FROM projects ORDER BY created_at');
  res.json(rows);
});

module.exports = { router, triggerWebhooks, VALID_EVENTS };
