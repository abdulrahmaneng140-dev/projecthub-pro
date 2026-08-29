const router = require('express').Router();
const { pool } = require('../db');
const { authMiddleware, requireRole } = require('../middleware/auth');

// ══════════════════════════════════════════════════════════════
// KPI ENGINE
// ══════════════════════════════════════════════════════════════

// GET /api/kpi/overview — full KPI dashboard data
router.get('/overview', authMiddleware, async (req, res) => {
  try {
    const [projects, tasks, team, reports, milestones] = await Promise.all([
      pool.query('SELECT * FROM projects ORDER BY created_at'),
      pool.query('SELECT * FROM tasks ORDER BY created_at'),
      pool.query('SELECT * FROM team_members ORDER BY id'),
      pool.query('SELECT * FROM site_reports ORDER BY report_date DESC LIMIT 30'),
      pool.query('SELECT * FROM milestones ORDER BY start_date'),
    ]);

    const P = projects.rows;
    const T = tasks.rows;
    const TM = team.rows;
    const R = reports.rows;
    const MS = milestones.rows;
    const today = new Date().toISOString().slice(0, 10);

    // ── PROJECT KPIs ──────────────────────────────────────────
    const totalBudget = P.reduce((a, p) => a + (+p.budget || 0), 0);
    const totalSpent  = P.reduce((a, p) => a + (+p.spent  || 0), 0);
    const avgProgress = P.length ? Math.round(P.reduce((a, p) => a + (+p.pct || 0), 0) / P.length) : 0;
    const onTrack     = P.filter(p => p.status === 'on-track').length;
    const atRisk      = P.filter(p => p.status === 'at-risk').length;
    const delayed     = P.filter(p => p.status === 'delayed').length;
    const overBudget  = P.filter(p => p.budget > 0 && p.spent / p.budget > 1).length;
    const nearBudget  = P.filter(p => p.budget > 0 && p.spent / p.budget > 0.85 && p.spent / p.budget <= 1).length;

    // Schedule Performance Index (SPI) — progress vs time elapsed
    const projectSPI = P.map(p => {
      if (!p.start_date || !p.end_date) return { id: p.id, name: p.name, spi: 1, cpi: 1 };
      const start = new Date(p.start_date), end = new Date(p.end_date), now = new Date();
      const totalDays = (end - start) / 86400000;
      const elapsed   = Math.max(0, (now - start) / 86400000);
      const planned   = totalDays > 0 ? Math.min(100, Math.round(elapsed / totalDays * 100)) : p.pct;
      const spi = planned > 0 ? (p.pct / planned).toFixed(2) : 1;
      const cpi = p.budget > 0 ? ((p.pct / 100 * p.budget) / Math.max(1, p.spent)).toFixed(2) : 1;
      return { id: p.id, name: p.name, color: p.color, pct: p.pct, planned, spi: +spi, cpi: +cpi, budget: p.budget, spent: p.spent };
    });

    // ── TASK KPIs ─────────────────────────────────────────────
    const totalTasks  = T.length;
    const doneTasks   = T.filter(t => t.col === 'done').length;
    const openTasks   = T.filter(t => t.col !== 'done').length;
    const highPrio    = T.filter(t => t.priority === 'high' && t.col !== 'done').length;
    const overdueTasks = T.filter(t => t.col !== 'done' && t.due_date && t.due_date < today).length;
    const completionRate = totalTasks > 0 ? Math.round(doneTasks / totalTasks * 100) : 0;
    const onTimeRate     = doneTasks > 0 ? Math.round(T.filter(t => t.col === 'done' && (!t.due_date || t.due_date >= today)).length / doneTasks * 100) : 0;

    // Tasks per col
    const tasksByCol = {};
    ['backlog','todo','doing','review','done'].forEach(c => {
      tasksByCol[c] = T.filter(t => t.col === c).length;
    });

    // ── TEAM KPIs ─────────────────────────────────────────────
    const teamKPI = TM.map(m => {
      const assigned = T.filter(t => t.assigned_to === m.name);
      const done     = assigned.filter(t => t.col === 'done').length;
      const overdue  = assigned.filter(t => t.col !== 'done' && t.due_date && t.due_date < today).length;
      const high     = assigned.filter(t => t.priority === 'high' && t.col !== 'done').length;
      const hours    = assigned.reduce((a, t) => a + (+t.hours_estimated || 0), 0);
      const score    = assigned.length > 0 ? Math.round((done / assigned.length) * 100 - overdue * 10) : 0;
      return { id: m.id, name: m.name, color: m.color, role: m.role,
               total: assigned.length, done, open: assigned.length - done,
               overdue, high, hours, score: Math.max(0, Math.min(100, score)) };
    }).sort((a, b) => b.score - a.score);

    // ── FINANCIAL KPIs ────────────────────────────────────────
    const budgetUtilization = totalBudget > 0 ? Math.round(totalSpent / totalBudget * 100) : 0;
    const budgetVariance    = totalBudget - totalSpent;
    const earnedValue       = P.reduce((a, p) => a + (p.pct / 100 * (+p.budget || 0)), 0);
    const roi               = totalSpent > 0 ? ((earnedValue - totalSpent) / totalSpent * 100).toFixed(1) : 0;

    const finByProject = P.map(p => ({
      id: p.id, name: p.name, color: p.color,
      budget: +p.budget || 0, spent: +p.spent || 0,
      variance: (+p.budget || 0) - (+p.spent || 0),
      utilization: p.budget > 0 ? Math.round(p.spent / p.budget * 100) : 0,
      earnedValue: Math.round(p.pct / 100 * (+p.budget || 0)),
    }));

    // ── ALERTS ────────────────────────────────────────────────
    const alerts = [];
    P.forEach(p => {
      if (p.status === 'delayed') alerts.push({ level: 'critical', type: 'schedule', proj: p.id, msg: `مشروع ${p.name} متأخر عن الجدول`, icon: 'ti-alert-triangle', color: '#f05a5a' });
      if (p.budget > 0 && p.spent / p.budget > 1) alerts.push({ level: 'critical', type: 'budget', proj: p.id, msg: `${p.name} تجاوز الميزانية ${Math.round(p.spent/p.budget*100)}%`, icon: 'ti-currency-dollar', color: '#f05a5a' });
      if (p.budget > 0 && p.spent / p.budget > 0.85 && p.spent / p.budget <= 1) alerts.push({ level: 'warning', type: 'budget', proj: p.id, msg: `${p.name} وصل ${Math.round(p.spent/p.budget*100)}% من الميزانية`, icon: 'ti-currency-dollar', color: '#f0a030' });
      if (p.status === 'at-risk') alerts.push({ level: 'warning', type: 'schedule', proj: p.id, msg: `مشروع ${p.name} في خطر`, icon: 'ti-alert-circle', color: '#f0a030' });
    });
    T.filter(t => t.col !== 'done' && t.due_date && t.due_date < today).forEach(t => {
      alerts.push({ level: 'warning', type: 'task', proj: t.project_id, msg: `مهمة متأخرة: ${t.title}`, icon: 'ti-clock', color: '#f0a030' });
    });
    const spiAlerts = projectSPI.filter(p => p.spi < 0.8);
    spiAlerts.forEach(p => alerts.push({ level: 'critical', type: 'spi', proj: p.id, msg: `SPI منخفض ${p.spi} للمشروع ${p.name}`, icon: 'ti-trending-down', color: '#f05a5a' }));

    // ── TREND DATA (weekly progress simulation) ───────────────
    const weeks = ['الأسبوع 1','الأسبوع 2','الأسبوع 3','الأسبوع 4','الأسبوع 5','الأسبوع 6'];
    const progressTrend = P.slice(0, 4).map(p => ({
      name: p.id, color: p.color,
      data: weeks.map((_, i) => Math.min(100, Math.round(Math.max(0, p.pct - 25 + (i * 5) + Math.random() * 3)))
      )
    }));
    progressTrend.forEach(d => { d.data[d.data.length - 1] = P.find(p => p.id === d.name)?.pct || 0; });

    res.json({
      projects: { total: P.length, onTrack, atRisk, delayed, overBudget, nearBudget, avgProgress, spi: projectSPI },
      tasks: { total: totalTasks, done: doneTasks, open: openTasks, highPrio, overdue: overdueTasks, completionRate, onTimeRate, byCol: tasksByCol },
      team: teamKPI,
      financial: { totalBudget, totalSpent, budgetVariance, budgetUtilization, earnedValue: Math.round(earnedValue), roi, byProject: finByProject },
      alerts: alerts.sort((a, b) => (a.level === 'critical' ? 0 : 1) - (b.level === 'critical' ? 0 : 1)),
      trend: { weeks, progress: progressTrend },
      milestones: { total: MS.length, done: MS.filter(m => m.status === 'done').length, upcoming: MS.filter(m => m.status === 'upcoming').length, delayed: MS.filter(m => m.status === 'delayed').length },
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ══════════════════════════════════════════════════════════════
// ALERT RULES (stored in DB as JSON)
// ══════════════════════════════════════════════════════════════

// GET /api/kpi/rules
router.get('/rules', authMiddleware, async (req, res) => {
  try {
    // Store rules in a simple config table (create if not exists)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS alert_rules (
        id SERIAL PRIMARY KEY,
        name VARCHAR(200) NOT NULL,
        type VARCHAR(50),
        condition VARCHAR(50),
        threshold NUMERIC,
        enabled BOOLEAN DEFAULT true,
        notify_email BOOLEAN DEFAULT false,
        email_to TEXT,
        created_by INTEGER REFERENCES users(id),
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    const { rows } = await pool.query('SELECT * FROM alert_rules ORDER BY id');
    // Seed defaults if empty
    if (rows.length === 0) {
      await pool.query(`
        INSERT INTO alert_rules (name, type, condition, threshold, enabled, notify_email)
        VALUES
          ('تجاوز الميزانية 85%', 'budget', 'gt', 85, true, false),
          ('مشروع متأخر', 'status', 'eq_delayed', 0, true, false),
          ('مهمة متأخرة', 'task_overdue', 'any', 0, true, false),
          ('SPI أقل من 0.8', 'spi', 'lt', 0.8, true, false),
          ('نسبة إنجاز أقل من 30%', 'progress', 'lt', 30, true, false)
      `);
      const { rows: seeded } = await pool.query('SELECT * FROM alert_rules ORDER BY id');
      return res.json(seeded);
    }
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/kpi/rules
router.post('/rules', authMiddleware, requireRole('admin', 'pm'), async (req, res) => {
  const { name, type, condition, threshold, enabled, notify_email, email_to } = req.body;
  if (!name) return res.status(400).json({ error: 'اسم القاعدة مطلوب' });
  try {
    const { rows } = await pool.query(
      'INSERT INTO alert_rules (name,type,condition,threshold,enabled,notify_email,email_to,created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *',
      [name, type, condition, threshold || 0, enabled !== false, notify_email || false, email_to || null, req.user.id]
    );
    res.status(201).json(rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// PUT /api/kpi/rules/:id
router.put('/rules/:id', authMiddleware, requireRole('admin', 'pm'), async (req, res) => {
  const { name, type, condition, threshold, enabled, notify_email, email_to } = req.body;
  const { rows } = await pool.query(
    'UPDATE alert_rules SET name=COALESCE($1,name),type=COALESCE($2,type),condition=COALESCE($3,condition),threshold=COALESCE($4,threshold),enabled=COALESCE($5,enabled),notify_email=COALESCE($6,notify_email),email_to=COALESCE($7,email_to) WHERE id=$8 RETURNING *',
    [name, type, condition, threshold, enabled, notify_email, email_to, req.params.id]
  );
  res.json(rows[0]);
});

// DELETE /api/kpi/rules/:id
router.delete('/rules/:id', authMiddleware, requireRole('admin', 'pm'), async (req, res) => {
  await pool.query('DELETE FROM alert_rules WHERE id=$1', [req.params.id]);
  res.json({ success: true });
});

// ══════════════════════════════════════════════════════════════
// NOTIFICATIONS (persistent in DB)
// ══════════════════════════════════════════════════════════════
router.get('/notifications', authMiddleware, async (req, res) => {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS notifications (
        id SERIAL PRIMARY KEY,
        type VARCHAR(30),
        level VARCHAR(20) DEFAULT 'info',
        message TEXT,
        project_id VARCHAR(20),
        icon VARCHAR(50),
        color VARCHAR(7),
        is_read BOOLEAN DEFAULT false,
        user_id INTEGER REFERENCES users(id),
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    const limit = Math.min(parseInt(req.query.limit) || 50, 200);
    const { rows } = await pool.query(
      'SELECT * FROM notifications WHERE user_id=$1 OR user_id IS NULL ORDER BY created_at DESC LIMIT $2',
      [req.user.id, limit]
    );
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.put('/notifications/:id/read', authMiddleware, async (req, res) => {
  await pool.query('UPDATE notifications SET is_read=true WHERE id=$1', [req.params.id]);
  res.json({ success: true });
});

router.put('/notifications/read-all', authMiddleware, async (req, res) => {
  await pool.query('UPDATE notifications SET is_read=true WHERE user_id=$1 OR user_id IS NULL', [req.user.id]);
  res.json({ success: true });
});

// POST /api/kpi/check-alerts — run alert engine and save new notifications
router.post('/check-alerts', authMiddleware, async (req, res) => {
  try {
    const [projects, tasks, rules] = await Promise.all([
      pool.query('SELECT * FROM projects'),
      pool.query("SELECT * FROM tasks WHERE col != 'done'"),
      pool.query('SELECT * FROM alert_rules WHERE enabled=true'),
    ]);
    const today = new Date().toISOString().slice(0, 10);
    const triggered = [];

    for (const rule of rules.rows) {
      if (rule.type === 'budget') {
        projects.rows.filter(p => p.budget > 0 && (p.spent / p.budget * 100) > rule.threshold).forEach(p => {
          triggered.push({ type: 'budget', level: 'warning', message: `${p.name}: استخدم ${Math.round(p.spent/p.budget*100)}% من الميزانية (القاعدة: ${rule.threshold}%)`, project_id: p.id, icon: 'ti-currency-dollar', color: '#f0a030' });
        });
      }
      if (rule.type === 'status') {
        projects.rows.filter(p => p.status === 'delayed').forEach(p => {
          triggered.push({ type: 'schedule', level: 'critical', message: `مشروع متأخر: ${p.name}`, project_id: p.id, icon: 'ti-alert-triangle', color: '#f05a5a' });
        });
      }
      if (rule.type === 'task_overdue') {
        tasks.rows.filter(t => t.due_date && t.due_date < today).forEach(t => {
          triggered.push({ type: 'task', level: 'warning', message: `مهمة متأخرة: ${t.title} (${t.project_id})`, project_id: t.project_id, icon: 'ti-clock', color: '#f0a030' });
        });
      }
      if (rule.type === 'progress') {
        projects.rows.filter(p => p.pct < rule.threshold).forEach(p => {
          triggered.push({ type: 'progress', level: 'info', message: `إنجاز منخفض: ${p.name} ${p.pct}%`, project_id: p.id, icon: 'ti-trending-down', color: '#9b72f4' });
        });
      }
    }

    // Insert unique notifications (avoid duplicates in last 24h)
    let added = 0;
    for (const n of triggered.slice(0, 50)) {
      const existing = await pool.query(
        "SELECT id FROM notifications WHERE message=$1 AND created_at > NOW() - INTERVAL '24 hours'",
        [n.message]
      );
      if (!existing.rows.length) {
        await pool.query(
          'INSERT INTO notifications (type,level,message,project_id,icon,color) VALUES ($1,$2,$3,$4,$5,$6)',
          [n.type, n.level, n.message, n.project_id || null, n.icon, n.color]
        );
        added++;
      }
    }

    res.json({ checked: triggered.length, added });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ══════════════════════════════════════════════════════════════
// EMAIL NOTIFICATIONS (via Nodemailer if configured)
// ══════════════════════════════════════════════════════════════
router.post('/send-report', authMiddleware, requireRole('admin', 'pm'), async (req, res) => {
  const { to, subject, type } = req.body;
  if (!to) return res.status(400).json({ error: 'البريد الإلكتروني مطلوب' });

  if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) {
    return res.status(503).json({
      error: 'البريد الإلكتروني غير مضبوط — أضف EMAIL_USER و EMAIL_PASS في الـ .env',
      hint: 'استخدم Gmail: EMAIL_USER=your@gmail.com و EMAIL_PASS=app_password'
    });
  }

  try {
    const nodemailer = require('nodemailer');
    const [projects, tasks] = await Promise.all([
      pool.query('SELECT * FROM projects'),
      pool.query('SELECT * FROM tasks'),
    ]);
    const P = projects.rows, T = tasks.rows;
    const today = new Date().toLocaleDateString('ar-SA', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
    const avgPct = P.length ? Math.round(P.reduce((a, p) => a + (+p.pct || 0), 0) / P.length) : 0;
    const fmt = n => n >= 1000 ? (n / 1000).toFixed(0) + 'K' : n;

    const html = `
<!DOCTYPE html><html dir="rtl" lang="ar"><head><meta charset="UTF-8">
<style>body{font-family:Arial,sans-serif;background:#f5f5f5;margin:0;padding:20px;direction:rtl}
.card{background:#fff;border-radius:12px;padding:20px;margin-bottom:14px;box-shadow:0 2px 8px rgba(0,0,0,.1)}
.header{background:linear-gradient(135deg,#4f8ef7,#9b72f4);color:#fff;border-radius:12px;padding:24px;margin-bottom:14px;text-align:center}
h1{margin:0;font-size:22px}p{margin:4px 0;opacity:.85;font-size:13px}
.kpi-row{display:grid;grid-template-columns:repeat(4,1fr);gap:10px}
.kpi{background:#f8f8f8;border-radius:8px;padding:14px;text-align:center}
.kpi-val{font-size:24px;font-weight:700;color:#333}
.kpi-lbl{font-size:11px;color:#888;margin-top:3px}
table{width:100%;border-collapse:collapse}th,td{padding:9px 12px;border-bottom:1px solid #eee;text-align:right;font-size:13px}th{background:#f5f5f5;font-weight:600}
.badge{display:inline-block;padding:2px 8px;border-radius:10px;font-size:11px;font-weight:600}
.ok{background:#e8f5e9;color:#2e7d32}.warn{background:#fff8e1;color:#f57f17}.danger{background:#ffebee;color:#c62828}
.footer{text-align:center;color:#aaa;font-size:11px;margin-top:16px}
</style></head><body>
<div class="header"><h1>ProjectHub Pro — تقرير الأداء</h1><p>${today}</p><p>Atech Automation Technology</p></div>
<div class="card">
  <h3 style="margin:0 0 14px;color:#333">ملخص المشاريع</h3>
  <div class="kpi-row">
    <div class="kpi"><div class="kpi-val">${P.length}</div><div class="kpi-lbl">مشاريع نشطة</div></div>
    <div class="kpi"><div class="kpi-val" style="color:#22c87a">${avgPct}%</div><div class="kpi-lbl">متوسط الإنجاز</div></div>
    <div class="kpi"><div class="kpi-val" style="color:#f0a030">${T.filter(t=>t.col!=='done').length}</div><div class="kpi-lbl">مهام مفتوحة</div></div>
    <div class="kpi"><div class="kpi-val" style="color:#f05a5a">${T.filter(t=>t.col!=='done'&&t.due_date&&t.due_date<new Date().toISOString().slice(0,10)).length}</div><div class="kpi-lbl">متأخرة</div></div>
  </div>
</div>
<div class="card">
  <h3 style="margin:0 0 14px;color:#333">تفاصيل المشاريع</h3>
  <table>
    <thead><tr><th>المشروع</th><th>الإنجاز</th><th>الميزانية</th><th>المنفق</th><th>الحالة</th></tr></thead>
    <tbody>
      ${P.map(p => {
        const statusMap = {'on-track':['على المسار','ok'],'at-risk':['في خطر','warn'],'delayed':['متأخر','danger']};
        const [sl, sc] = statusMap[p.status] || ['—','ok'];
        const pct = p.budget > 0 ? Math.round(p.spent/p.budget*100) : 0;
        return `<tr>
          <td><strong>${p.name}</strong></td>
          <td>${p.pct}%</td>
          <td>SAR ${fmt(p.budget||0)}</td>
          <td style="color:${pct>90?'#c62828':pct>70?'#f57f17':'#333'}">SAR ${fmt(p.spent||0)} (${pct}%)</td>
          <td><span class="badge ${sc}">${sl}</span></td>
        </tr>`;
      }).join('')}
    </tbody>
  </table>
</div>
${P.filter(p=>p.status==='delayed'||p.status==='at-risk').length > 0 ? `
<div class="card" style="border-right:4px solid #f05a5a">
  <h3 style="margin:0 0 10px;color:#c62828">⚠️ تنبيهات تحتاج تدخل</h3>
  ${P.filter(p=>p.status==='delayed').map(p=>`<div style="margin-bottom:6px;font-size:13px">🔴 <strong>${p.name}</strong> — مشروع متأخر</div>`).join('')}
  ${P.filter(p=>p.status==='at-risk').map(p=>`<div style="margin-bottom:6px;font-size:13px">🟡 <strong>${p.name}</strong> — في خطر</div>`).join('')}
  ${P.filter(p=>p.budget>0&&p.spent/p.budget>0.85).map(p=>`<div style="margin-bottom:6px;font-size:13px">💰 <strong>${p.name}</strong> — ${Math.round(p.spent/p.budget*100)}% من الميزانية مستخدم</div>`).join('')}
</div>` : ''}
<div class="footer">تم الإرسال تلقائياً من ProjectHub Pro — Atech Automation Technology</div>
</body></html>`;

    const transporter = nodemailer.createTransporter({
      service: 'gmail',
      auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS }
    });

    await transporter.sendMail({
      from: `"ProjectHub Pro" <${process.env.EMAIL_USER}>`,
      to,
      subject: subject || `تقرير الأداء — ${today}`,
      html,
    });

    await pool.query(
      'INSERT INTO activity_log (type,message,icon,color,user_id,user_name) VALUES ($1,$2,$3,$4,$5,$6)',
      ['reports', `إرسال تقرير بريد إلى: ${to}`, 'ti-mail', '#22c87a', req.user.id, req.user.name]
    );

    res.json({ success: true, message: `تم إرسال التقرير إلى ${to}` });
  } catch (e) {
    res.status(500).json({ error: 'فشل إرسال البريد: ' + e.message });
  }
});

// ══════════════════════════════════════════════════════════════
// WEEKLY REPORT SCHEDULER (cron-like via endpoint)
// ══════════════════════════════════════════════════════════════
router.get('/schedule-status', authMiddleware, requireRole('admin', 'pm'), async (req, res) => {
  res.json({
    emailConfigured: !!(process.env.EMAIL_USER && process.env.EMAIL_PASS),
    weeklyReportTo: process.env.WEEKLY_REPORT_EMAIL || null,
    nextReport: getNextSunday(),
    hint: 'أضف WEEKLY_REPORT_EMAIL في الـ .env لتفعيل التقرير الأسبوعي التلقائي'
  });
});

function getNextSunday() {
  const d = new Date();
  const day = d.getDay();
  const diff = (7 - day) % 7 || 7;
  d.setDate(d.getDate() + diff);
  d.setHours(8, 0, 0, 0);
  return d.toISOString();
}

module.exports = router;
