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

// Commissioning matrix — panel/loop checklist (Communication/Programming/Commissioning/Validation/Handover)
app.use('/api/commissioning', require('./routes/commissioning'));

// Issues Log — site/commissioning issue tracking
app.use('/api/issues', require('./routes/issues'));

// AI — project chat assistant + automatic risk analysis
app.use('/api/ai', require('./routes/ai'));

// Risk Register — formal probability x impact risk tracking
app.use('/api/risks', require('./routes/risks'));

// Change Orders — scope/cost/schedule variation tracking with approval workflow
app.use('/api/change-orders', require('./routes/change_orders'));

// Task Dependencies + Critical Path Method (CPM) scheduling
app.use('/api/dependencies', require('./routes/dependencies'));

// Punch List / Snag List — handover-phase defect tracking
app.use('/api/punchlist', require('./routes/punchlist'));

// SPA fallback — MUST be registered after every /api/* route above,
// otherwise it intercepts API requests and returns the HTML page instead of JSON.
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Weekly PDF snapshot — every Saturday at 8am, saves updated progress/
// financial/risk PDFs for every project to a local folder on disk.
// Shared with routes/reports.js so it can also be triggered manually.
const { generateWeeklyPDFSnapshots } = require('./lib/weeklySnapshot');

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

// Check if it's Sunday 8am (email report) or Saturday 8am (PDF snapshots) every hour
setInterval(() => {
  const now = new Date();
  if (now.getDay() === 0 && now.getHours() === 8 && now.getMinutes() < 5) {
    runWeeklyReport();
  }
  if (now.getDay() === 6 && now.getHours() === 8 && now.getMinutes() < 5) {
    generateWeeklyPDFSnapshots();
  }
  // Also run alert check every hour
  require('node-fetch')(`http://localhost:${process.env.PORT || 3000}/api/kpi/check-alerts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer system' }
  }).catch(() => {});
  // Also run missing-documents check every hour
  require('./routes/documents').runDocumentCheck().catch(e => console.error('Document check failed:', e.message));
}, 60 * 60 * 1000);
