const router = require('express').Router();
const multer = require('multer');
const xml2js = require('xml2js');
const { pool } = require('../db');
const { authMiddleware, requireRole } = require('../middleware/auth');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

// ══════════════════════════════════════════════════════════════
// MS PROJECT XML — this is the schema MS Project itself reads/writes
// (Microsoft.Project ClientProject XML, simplified to what Project
// actually needs to reconstruct a task list on import)
// ══════════════════════════════════════════════════════════════

function xmlEscape(s) {
  return String(s ?? '').replace(/[<>&'"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[c]));
}

// Duration in MS Project's PTnHnMnS format, from estimated hours
function hoursToDuration(hours) {
  const h = Math.max(0, +hours || 0);
  return `PT${h}H0M0S`;
}
function durationToHours(dur) {
  if (!dur) return 0;
  const m = String(dur).match(/PT(?:(\d+)H)?(?:(\d+)M)?/);
  if (!m) return 0;
  return (+(m[1] || 0)) + (+(m[2] || 0)) / 60;
}

function toISODate(d) {
  if (!d) return '';
  const dt = new Date(d);
  if (isNaN(dt)) return '';
  return dt.toISOString().slice(0, 19);
}

const PRIORITY_MAP = { high: 800, med: 500, low: 200 };
function priorityFromNumber(n) {
  n = +n || 500;
  if (n >= 700) return 'high';
  if (n >= 350) return 'med';
  return 'low';
}

// ── EXPORT: GET /api/msproject/export?project=CODE ──────────────────
router.get('/export', authMiddleware, async (req, res) => {
  const { project } = req.query;
  try {
    const taskFilter = project ? 'WHERE project_id = $1' : '';
    const msFilter = project ? 'WHERE project_id = $1' : '';
    const args = project ? [project] : [];

    const [tasksR, msR, projR] = await Promise.all([
      pool.query(`SELECT * FROM tasks ${taskFilter} ORDER BY created_at`, args),
      pool.query(`SELECT * FROM milestones ${msFilter} ORDER BY start_date`, args),
      project ? pool.query('SELECT * FROM projects WHERE id = $1', [project]) : pool.query('SELECT * FROM projects ORDER BY created_at'),
    ]);

    const projName = project ? (projR.rows[0]?.name || project) : 'ProjectHub Pro — All Projects';
    const now = toISODate(new Date());

    let uid = 1;
    const taskXml = tasksR.rows.map(t => {
      const isDone = t.col === 'done';
      const pct = isDone ? 100 : (t.col === 'review' ? 80 : t.col === 'doing' ? 40 : 0);
      return `
    <Task>
      <UID>${uid++}</UID>
      <ID>${uid - 1}</ID>
      <Name>${xmlEscape(t.title)}</Name>
      <Type>1</Type>
      <IsMilestone>0</IsMilestone>
      <Active>1</Active>
      <Manual>0</Manual>
      <Start>${toISODate(t.created_at)}</Start>
      <Finish>${toISODate(t.due_date) || now}</Finish>
      <Duration>${hoursToDuration(t.hours_estimated)}</Duration>
      <PercentComplete>${pct}</PercentComplete>
      <Priority>${PRIORITY_MAP[t.priority] || 500}</Priority>
      <Notes>${xmlEscape(t.notes || '')}</Notes>
      <ExtendedAttribute>
        <FieldID>188743731</FieldID>
        <FieldName>ProjectHubProjectID</FieldName>
        <Value>${xmlEscape(t.project_id || '')}</Value>
      </ExtendedAttribute>
      <ExtendedAttribute>
        <FieldID>188743732</FieldID>
        <FieldName>ProjectHubAssignedTo</FieldName>
        <Value>${xmlEscape(t.assigned_to || '')}</Value>
      </ExtendedAttribute>
    </Task>`;
    }).join('');

    const msXml = msR.rows.map(m => `
    <Task>
      <UID>${uid++}</UID>
      <ID>${uid - 1}</ID>
      <Name>${xmlEscape(m.title)}</Name>
      <Type>1</Type>
      <IsMilestone>1</IsMilestone>
      <Active>1</Active>
      <Start>${toISODate(m.start_date)}</Start>
      <Finish>${toISODate(m.end_date)}</Finish>
      <Duration>PT0H0M0S</Duration>
      <PercentComplete>${m.pct || 0}</PercentComplete>
      <Notes>${xmlEscape(m.notes || '')}</Notes>
      <ExtendedAttribute>
        <FieldID>188743731</FieldID>
        <FieldName>ProjectHubProjectID</FieldName>
        <Value>${xmlEscape(m.project_id || '')}</Value>
      </ExtendedAttribute>
    </Task>`).join('');

    const xml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Project xmlns="http://schemas.microsoft.com/project">
  <Name>${xmlEscape(projName)}</Name>
  <Title>${xmlEscape(projName)}</Title>
  <SaveVersion>14</SaveVersion>
  <CurrentDate>${now}</CurrentDate>
  <Tasks>${taskXml}${msXml}
  </Tasks>
</Project>`;

    res.setHeader('Content-Type', 'application/xml');
    res.setHeader('Content-Disposition', `attachment; filename="${(project || 'all-projects')}.xml"`);
    res.send(xml);

    pool.query(
      'INSERT INTO activity_log (type,message,icon,color,user_id,user_name) VALUES ($1,$2,$3,$4,$5,$6)',
      ['reports', `تصدير MS Project XML${project ? ' — ' + project : ' (كل المشاريع)'}`, 'ti-file-export', '#4f8ef7', req.user.id, req.user.name]
    ).catch(() => {});
  } catch (e) {
    if (!res.headersSent) res.status(500).json({ error: e.message });
  }
});

// ── IMPORT: POST /api/msproject/import  (multipart: file, project_id) ──
router.post('/import', authMiddleware, requireRole('admin', 'pm', 'lead'), upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'ملف XML مطلوب' });
  const targetProjectId = req.body.project_id;
  if (!targetProjectId) return res.status(400).json({ error: 'project_id مطلوب لربط المهام المستوردة' });

  try {
    const projCheck = await pool.query('SELECT id FROM projects WHERE id = $1', [targetProjectId]);
    if (!projCheck.rows.length) return res.status(404).json({ error: 'المشروع غير موجود في ProjectHub' });

    const parsed = await xml2js.parseStringPromise(req.file.buffer.toString('utf8'), { explicitArray: false, ignoreAttrs: true });
    const root = parsed.Project || parsed;
    let tasks = root?.Tasks?.Task || [];
    if (!Array.isArray(tasks)) tasks = [tasks];

    let created = 0, updated = 0, skipped = 0;

    for (const t of tasks) {
      if (!t || !t.Name) { skipped++; continue; }
      const isMilestone = t.IsMilestone === '1' || t.IsMilestone === 1;
      const title = String(t.Name).trim();
      const finish = t.Finish ? t.Finish.slice(0, 10) : null;
      const pct = t.PercentComplete ? +t.PercentComplete : 0;

      if (isMilestone) {
        const existing = await pool.query('SELECT id FROM milestones WHERE project_id = $1 AND title = $2', [targetProjectId, title]);
        const status = pct >= 100 ? 'done' : (finish && finish < new Date().toISOString().slice(0, 10) ? 'delayed' : 'upcoming');
        if (existing.rows.length) {
          await pool.query('UPDATE milestones SET end_date=$1, pct=$2, status=$3 WHERE id=$4',
            [finish, pct, status, existing.rows[0].id]);
          updated++;
        } else {
          await pool.query(
            'INSERT INTO milestones (title, project_id, type, start_date, end_date, status, pct, notes, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)',
            [title, targetProjectId, 'milestone', t.Start ? t.Start.slice(0, 10) : finish, finish, status, pct, t.Notes || null, req.user.id]
          );
          created++;
        }
      } else {
        const hours = durationToHours(t.Duration);
        const priority = priorityFromNumber(t.Priority);
        const col = pct >= 100 ? 'done' : pct >= 80 ? 'review' : pct >= 40 ? 'doing' : 'todo';
        const existing = await pool.query('SELECT id FROM tasks WHERE project_id = $1 AND title = $2', [targetProjectId, title]);
        if (existing.rows.length) {
          await pool.query('UPDATE tasks SET due_date=$1, hours_estimated=$2, priority=$3, col=$4, notes=$5, updated_at=NOW() WHERE id=$6',
            [finish, Math.round(hours), priority, col, t.Notes || null, existing.rows[0].id]);
          updated++;
        } else {
          await pool.query(
            'INSERT INTO tasks (title, project_id, priority, col, due_date, hours_estimated, notes, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
            [title, targetProjectId, priority, col, finish, Math.round(hours), t.Notes || null, req.user.id]
          );
          created++;
        }
      }
    }

    await pool.query(
      'INSERT INTO activity_log (type,message,icon,color,user_id,user_name) VALUES ($1,$2,$3,$4,$5,$6)',
      ['reports', `استيراد MS Project XML إلى ${targetProjectId} — ${created} جديد، ${updated} تحديث`, 'ti-file-import', '#22c87a', req.user.id, req.user.name]
    );

    res.json({ success: true, created, updated, skipped, total: tasks.length });
  } catch (e) {
    res.status(400).json({ error: 'فشل قراءة ملف XML — تأكد إنه ملف MS Project XML صحيح: ' + e.message });
  }
});

module.exports = router;
