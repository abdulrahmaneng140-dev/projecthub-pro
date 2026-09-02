const router = require('express').Router();
const multer = require('multer');
const ExcelJS = require('exceljs');
const { pool } = require('../db');
const { authMiddleware, requireRole } = require('../middleware/auth');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

function parseDateCell(val) {
  if (!val) return null;
  if (val instanceof Date) return val.toISOString().slice(0, 10);
  const s = String(val).trim();
  if (!s || s === '-') return null;
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) {
    const d = new Date(+m[3], +m[2] - 1, +m[1]);
    if (!isNaN(d)) return d.toISOString().slice(0, 10);
  }
  return null;
}

// ── GET /api/issues/summary/open — across all projects, for dashboard widget ──
// (must be registered before the /:project wildcard route below)
router.get('/summary/open', authMiddleware, async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT i.*, p.name AS project_name
      FROM project_issues i JOIN projects p ON p.id = i.project_id
      WHERE i.status = 'Open'
      ORDER BY i.open_date DESC
    `);
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── GET /api/issues/:project ──
router.get('/:project', authMiddleware, async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM project_issues WHERE project_id=$1 ORDER BY sn NULLS LAST, id', [req.params.project]);
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── POST /api/issues/:project — add manually ──
router.post('/:project', authMiddleware, requireRole('admin', 'pm', 'lead'), async (req, res) => {
  const { phase, system_name, issue, reasons, responsible, corrective_action, status, open_date, remark } = req.body;
  if (!issue) return res.status(400).json({ error: 'وصف المشكلة مطلوب' });
  try {
    const { rows: maxRow } = await pool.query('SELECT COALESCE(MAX(sn),0)+1 AS next_sn FROM project_issues WHERE project_id=$1', [req.params.project]);
    const { rows } = await pool.query(
      `INSERT INTO project_issues (project_id, sn, phase, system_name, issue, reasons, responsible, corrective_action, status, open_date, remark, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
      [req.params.project, maxRow[0].next_sn, phase || null, system_name || null, issue, reasons || null, responsible || null,
        corrective_action || null, status || 'Open', open_date || new Date().toISOString().slice(0, 10), remark || null, req.user.id]
    );
    res.status(201).json(rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── PUT /api/issues/item/:id ──
router.put('/item/:id', authMiddleware, requireRole('admin', 'pm', 'lead'), async (req, res) => {
  const { phase, system_name, issue, reasons, responsible, corrective_action, status, open_date, closed_date, remark } = req.body;
  try {
    const autoCloseDate = status === 'Closed' && !closed_date ? new Date().toISOString().slice(0, 10) : closed_date;
    const { rows } = await pool.query(
      `UPDATE project_issues SET
        phase=COALESCE($1,phase), system_name=COALESCE($2,system_name), issue=COALESCE($3,issue),
        reasons=COALESCE($4,reasons), responsible=COALESCE($5,responsible), corrective_action=COALESCE($6,corrective_action),
        status=COALESCE($7,status), open_date=COALESCE($8,open_date), closed_date=COALESCE($9,closed_date),
        remark=COALESCE($10,remark), updated_at=NOW()
       WHERE id=$11 RETURNING *`,
      [phase, system_name, issue, reasons, responsible, corrective_action, status, open_date, autoCloseDate, remark, req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'المشكلة غير موجودة' });
    res.json(rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete('/item/:id', authMiddleware, requireRole('admin', 'pm', 'lead'), async (req, res) => {
  await pool.query('DELETE FROM project_issues WHERE id=$1', [req.params.id]);
  res.json({ success: true });
});

// ══════════════════════════════════════════════════════════════
// EXCEL IMPORT — matches the real "Issues" sheet layout:
// header row has 'S.N.' in col A, data starts the row after.
// Columns: S.N., Phase, System, Issue, Reasons, Responsible,
// Suggested Corrective Action, Status, Open Date, Closed Date, Remark
// ══════════════════════════════════════════════════════════════
router.post('/:project/import', authMiddleware, requireRole('admin', 'pm', 'lead'), upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'ملف Excel مطلوب' });
  try {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(req.file.buffer);
    const ws = wb.getWorksheet('Issues') || wb.worksheets[0];
    if (!ws) return res.status(400).json({ error: 'مفيش شيت اسمه Issues في الملف' });

    let headerRow = null;
    for (let r = 1; r <= 15; r++) {
      if (String(ws.getCell(r, 1).value || '').trim() === 'S.N.') { headerRow = r; break; }
    }
    if (!headerRow) return res.status(400).json({ error: 'مقدرتش ألاقي صف العناوين (S.N.) في أول 15 صف' });

    let created = 0, updated = 0;
    for (let r = headerRow + 1; r <= ws.rowCount; r++) {
      const sn = ws.getCell(r, 1).value;
      const issue = String(ws.getCell(r, 4).value || '').trim();
      if (!issue) continue;

      const phase = String(ws.getCell(r, 2).value || '').trim() || null;
      const system_name = String(ws.getCell(r, 3).value || '').trim() || null;
      const reasons = String(ws.getCell(r, 5).value || '').trim() || null;
      const responsible = String(ws.getCell(r, 6).value || '').trim() || null;
      const corrective_action = String(ws.getCell(r, 7).value || '').trim() || null;
      const status = String(ws.getCell(r, 8).value || 'Open').trim();
      const open_date = parseDateCell(ws.getCell(r, 9).value);
      const closed_date = parseDateCell(ws.getCell(r, 10).value);
      const remark = String(ws.getCell(r, 11).value || '').trim() || null;

      const existing = typeof sn === 'number'
        ? await pool.query('SELECT id FROM project_issues WHERE project_id=$1 AND sn=$2', [req.params.project, sn])
        : { rows: [] };

      if (existing.rows.length) {
        await pool.query(
          `UPDATE project_issues SET phase=$1, system_name=$2, issue=$3, reasons=$4, responsible=$5,
           corrective_action=$6, status=$7, open_date=$8, closed_date=$9, remark=$10, updated_at=NOW() WHERE id=$11`,
          [phase, system_name, issue, reasons, responsible, corrective_action, status, open_date, closed_date, remark, existing.rows[0].id]
        );
        updated++;
      } else {
        await pool.query(
          `INSERT INTO project_issues (project_id, sn, phase, system_name, issue, reasons, responsible, corrective_action, status, open_date, closed_date, remark, created_by)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
          [req.params.project, typeof sn === 'number' ? sn : null, phase, system_name, issue, reasons, responsible,
            corrective_action, status, open_date, closed_date, remark, req.user.id]
        );
        created++;
      }
    }

    await pool.query(
      'INSERT INTO activity_log (type,message,icon,color,user_id,user_name) VALUES ($1,$2,$3,$4,$5,$6)',
      ['documents', `استيراد Issues Log — ${created} جديد، ${updated} تحديث`, 'ti-alert-triangle', '#f0a030', req.user.id, req.user.name]
    );

    res.json({ created, updated });
  } catch (e) { res.status(400).json({ error: 'فشل قراءة ملف Excel: ' + e.message }); }
});

module.exports = router;
