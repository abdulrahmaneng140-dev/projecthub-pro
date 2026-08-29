require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const rateLimit = require('express-rate-limit');
const { initDB } = require('./db');

const app = express();
app.set('trust proxy', 1);
const PORT = process.env.PORT || 3000;

// ── MIDDLEWARE ─────────────────────────────────────────────────────────────
app.use(cors({
  origin: process.env.ALLOWED_ORIGINS?.split(',') || '*',
  credentials: true
}));
app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// Rate limiting
app.use('/api/auth/login', rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: { error: 'محاولات كثيرة — انتظر 15 دقيقة' }
}));
app.use('/api/', rateLimit({
  windowMs: 60 * 1000,
  max: 300,
  message: { error: 'طلبات كثيرة — انتظر لحظة' }
}));

// ── ROUTES ─────────────────────────────────────────────────────────────────
app.use('/api/auth', require('./routes/auth'));
app.use('/api/projects', require('./routes/projects'));
app.use('/api/tasks', require('./routes/tasks'));
app.use('/api', require('./routes/api'));

// Health check
app.get('/health', (req, res) => res.json({
  status: 'ok',
  version: '2.0.0',
  time: new Date().toISOString()
}));

// SPA fallback
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ── START ──────────────────────────────────────────────────────────────────
async function start() {
  try {
    await initDB();
    app.listen(PORT, () => {
      console.log(`✅ ProjectHub Pro running on port ${PORT}`);
      console.log(`🌐 URL: http://localhost:${PORT}`);
    });
  } catch (e) {
    console.error('❌ Failed to start:', e.message || e.toString() || 'Unknown error');
    console.error('Error code:', e.code);
    console.error('Full error:', JSON.stringify(e, Object.getOwnPropertyNames(e)));
    process.exit(1);
  }
}

start();

// AI route (server-side to protect API key)
app.post('/api/ai', require('./middleware/auth').authMiddleware, async (req, res) => {
  const { question, context } = req.body;
  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(503).json({ error: 'ANTHROPIC_API_KEY غير مضاف في إعدادات الخادم' });
  }
  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 800,
        system: `أنت مساعد ذكي لإدارة المشاريع الهندسية — Atech Automation. تتحدث بالعربية المصرية بإيجاز وعملية.\nالمشاريع:\n${context?.projects}\n${context?.tasks}\nالمستخدم: ${context?.user} (${context?.role})\nأجب في 2-4 جمل.`,
        messages: [{ role: 'user', content: question }]
      })
    });
    const data = await r.json();
    res.json({ answer: data.content?.[0]?.text || 'لا توجد إجابة' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// KPI, Alerts, Notifications, Email
app.use('/api/kpi', require('./routes/kpi'));

// Report generation — PDF & Excel (progress, financial, risk)
app.use('/api/reports', require('./routes/reports'));

// MS Project XML — export/import for interoperability with Microsoft Project
app.use('/api/msproject', require('./routes/msproject'));

// Microsoft Graph OAuth (Outlook/Calendar/OneDrive account connection)
app.use('/api/integrations/msgraph', require('./routes/msgraph').router);

// Outlook — send mail, calendar sync, OneDrive upload
app.use('/api/integrations/outlook', require('./routes/outlook'));

// Power Automate — outbound webhooks + inbound API-key endpoints
app.use('/api/integrations', require('./routes/integrations').router);

// Document tracking — missing/overdue project documents + notifications
app.use('/api/documents', require('./routes/documents').router);

// Portfolio — cross-project dashboard, resource allocation, dependencies, templates
app.use('/api/portfolio', require('./routes/portfolio'));

// Weekly auto-report scheduler (runs every Sunday at 8am)
async function runWeeklyReport() {
  const to = process.env.WEEKLY_REPORT_EMAIL;
  if (!to || !process.env.EMAIL_USER) return;
  try {
    const { pool } = require('./db');
    const token_payload = { id: 1, name: 'System', role: 'admin' };
    const jwt = require('jsonwebtoken');
    const fakeToken = jwt.sign(token_payload, process.env.JWT_SECRET, { expiresIn: '1h' });
    const res = await require('node-fetch')(`http://localhost:${process.env.PORT || 3000}/api/kpi/send-report`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + fakeToken },
      body: JSON.stringify({ to, subject: 'التقرير الأسبوعي — ProjectHub Pro' })
    });
    const data = await res.json();
    console.log('Weekly report:', data.message || data.error);
  } catch (e) { console.error('Weekly report failed:', e.message); }
}

// Check if it's Sunday 8am every hour
setInterval(() => {
  const now = new Date();
  if (now.getDay() === 0 && now.getHours() === 8 && now.getMinutes() < 5) {
    runWeeklyReport();
  }
  // Also run alert check every hour
  require('node-fetch')(`http://localhost:${process.env.PORT || 3000}/api/kpi/check-alerts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer system' }
  }).catch(() => {});
  // Also run missing-documents check every hour
  require('./routes/documents').runDocumentCheck().catch(e => console.error('Document check failed:', e.message));
}, 60 * 60 * 1000);
