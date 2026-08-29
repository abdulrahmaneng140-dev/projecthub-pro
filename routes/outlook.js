const router = require('express').Router();
const { pool } = require('../db');
const { authMiddleware, requireRole } = require('../middleware/auth');
const { getValidAccessToken } = require('./msgraph');

// ══════════════════════════════════════════════════════════════
// OUTLOOK — send mail via Graph API (no SMTP credentials needed)
// ══════════════════════════════════════════════════════════════
// POST /api/integrations/outlook/send-report  { to, subject, html }
router.post('/send-report', authMiddleware, requireRole('admin', 'pm'), async (req, res) => {
  const { to, subject, html } = req.body;
  if (!to || !html) return res.status(400).json({ error: 'to و html مطلوبين' });
  try {
    const token = await getValidAccessToken();
    const toList = String(to).split(',').map(e => ({ emailAddress: { address: e.trim() } }));

    const r = await fetch('https://graph.microsoft.com/v1.0/me/sendMail', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: {
          subject: subject || 'تقرير ProjectHub Pro',
          body: { contentType: 'HTML', content: html },
          toRecipients: toList,
        },
        saveToSentItems: true,
      }),
    });
    if (r.status !== 202) {
      const err = await r.json().catch(() => ({}));
      throw new Error(err.error?.message || 'فشل إرسال الإيميل عبر Outlook');
    }
    await pool.query(
      'INSERT INTO activity_log (type,message,icon,color,user_id,user_name) VALUES ($1,$2,$3,$4,$5,$6)',
      ['reports', `إرسال تقرير عبر Outlook إلى: ${to}`, 'ti-mail', '#0078d4', req.user.id, req.user.name]
    );
    res.json({ success: true, message: `تم الإرسال عبر Outlook إلى ${to}` });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ══════════════════════════════════════════════════════════════
// OUTLOOK CALENDAR — sync milestones as calendar events
// ══════════════════════════════════════════════════════════════
// POST /api/integrations/outlook/sync-calendar  { project_id? }
router.post('/sync-calendar', authMiddleware, requireRole('admin', 'pm', 'lead'), async (req, res) => {
  const { project_id } = req.body;
  try {
    const token = await getValidAccessToken();
    const filter = project_id ? 'WHERE project_id = $1' : '';
    const args = project_id ? [project_id] : [];
    const { rows: milestones } = await pool.query(`SELECT * FROM milestones ${filter} ORDER BY start_date`, args);

    let synced = 0, failed = 0;
    for (const m of milestones) {
      if (!m.start_date) continue;
      const start = new Date(m.start_date);
      const end = m.end_date ? new Date(m.end_date) : new Date(start.getTime() + 3600000);
      const body = {
        subject: `[ProjectHub] ${m.title}`,
        body: { contentType: 'Text', content: `${m.notes || ''}\nمشروع: ${m.project_id}\nالحالة: ${m.status}` },
        start: { dateTime: start.toISOString(), timeZone: 'Arab Standard Time' },
        end: { dateTime: end.toISOString(), timeZone: 'Arab Standard Time' },
        isAllDay: true,
        categories: ['ProjectHub Pro'],
      };
      const r = await fetch('https://graph.microsoft.com/v1.0/me/events', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (r.ok) synced++; else failed++;
    }

    await pool.query(
      'INSERT INTO activity_log (type,message,icon,color,user_id,user_name) VALUES ($1,$2,$3,$4,$5,$6)',
      ['reports', `مزامنة ${synced} milestone مع Outlook Calendar`, 'ti-calendar', '#0078d4', req.user.id, req.user.name]
    );
    res.json({ synced, failed, total: milestones.length });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ══════════════════════════════════════════════════════════════
// ONEDRIVE — upload a generated report file
// ══════════════════════════════════════════════════════════════
// POST /api/integrations/outlook/upload-onedrive  (multipart: file, folder?)
const multer = require('multer');
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

router.post('/upload-onedrive', authMiddleware, requireRole('admin', 'pm'), upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'ملف مطلوب' });
  const folder = req.body.folder || 'ProjectHub Reports';
  try {
    const token = await getValidAccessToken();
    const path = `${folder}/${Date.now()}-${req.file.originalname}`;
    const r = await fetch(`https://graph.microsoft.com/v1.0/me/drive/root:/${encodeURIComponent(path)}:/content`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/octet-stream' },
      body: req.file.buffer,
    });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error?.message || 'فشل الرفع على OneDrive');
    res.json({ success: true, webUrl: data.webUrl, name: data.name });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
