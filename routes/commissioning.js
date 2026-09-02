const router = require('express').Router();
const multer = require('multer');
const ExcelJS = require('exceljs');
const { pool } = require('../db');
const { authMiddleware, requireRole } = require('../middleware/auth');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

// ══════════════════════════════════════════════════════════════
// STAGE TEMPLATE — matches the real "Progress" matrix layout used at ATECH:
// category → ordered stage keys. Column order here is also the column
// order used when importing/exporting Excel.
// ══════════════════════════════════════════════════════════════
const STAGE_TEMPLATE = [
  { key: 'communication', label: 'Communication', category: 'Communication' },
  { key: 'configuration', label: 'Configuration', category: 'Programming' },
  { key: 'fbd', label: 'FBD', category: 'Programming' },
  { key: 'graphic', label: 'Graphic', category: 'Programming' },
  { key: 'alarms', label: 'Alarms', category: 'Programming' },
  { key: 'trends', label: 'Trends', category: 'Programming' },
  { key: 'dashboard', label: 'Dashboard', category: 'Programming' },
  { key: 'reports', label: 'Reports', category: 'Programming' },
  { key: 'programming_review', label: 'Programing Review', category: 'Programming' },
  { key: 'hardware_commissioning', label: 'Hardware Commissioning', category: 'Commissioning' },
  { key: 'software_commissioning', label: 'Software Commissioning', category: 'Commissioning' },
  { key: 'installation_qualification', label: 'Installation Qualification', category: 'Validation' },
  { key: 'operation_qualification', label: 'Operation Qualification', category: 'Validation' },
  { key: 'as_built_documents', label: 'As Built Documents', category: 'Handover' },
  { key: 'iq_protocol', label: 'IQ Protocol', category: 'Handover' },
  { key: 'iq_annex', label: 'IQ Annex', category: 'Handover' },
  { key: 'oq_protocol', label: 'OQ Protocol', category: 'Handover' },
  { key: 'oq_annex', label: 'OQ Annex', category: 'Handover' },
  { key: 'closing', label: 'Closing', category: 'Handover' },
];
const STAGE_KEYS = STAGE_TEMPLATE.map(s => s.key);

function computePct(stages) {
  const total = STAGE_KEYS.length;
  const done = STAGE_KEYS.filter(k => stages?.[k] === 'done').length;
  return total ? Math.round((done / total) * 100) : 0;
}

router.get('/template', authMiddleware, (req, res) => {
  res.json({ stages: STAGE_TEMPLATE });
});

// ── GET /api/commissioning/:project — matrix for a project ──
router.get('/:project', authMiddleware, async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT * FROM commissioning_items WHERE project_id=$1 ORDER BY item_no NULLS LAST, id', [req.params.project]
    );
    res.json(rows.map(r => ({ ...r, pct: computePct(r.stages) })));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── POST /api/commissioning/:project — add a panel/loop manually ──
router.post('/:project', authMiddleware, requireRole('admin', 'pm', 'lead'), async (req, res) => {
  const { panel_name, serving_equipment, item_no, notes } = req.body;
  if (!panel_name) return res.status(400).json({ error: 'اسم اللوحة/الحلقة مطلوب' });
  try {
    const { rows } = await pool.query(
      `INSERT INTO commissioning_items (project_id, item_no, panel_name, serving_equipment, stages, notes, created_by)
       VALUES ($1,$2,$3,$4,'{}',$5,$6) RETURNING *`,
      [req.params.project, item_no || null, panel_name, serving_equipment || null, notes || null, req.user.id]
    );
    res.status(201).json({ ...rows[0], pct: 0 });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── PUT /api/commissioning/item/:id — update one stage's status (cycles done/na/pending), or panel info ──
router.put('/item/:id', authMiddleware, requireRole('admin', 'pm', 'lead'), async (req, res) => {
  const { stage_key, stage_status, panel_name, serving_equipment, item_no, notes } = req.body;
  try {
    const { rows: cur } = await pool.query('SELECT * FROM commissioning_items WHERE id=$1', [req.params.id]);
    if (!cur.length) return res.status(404).json({ error: 'العنصر غير موجود' });

    let stages = cur[0].stages || {};
    if (stage_key) {
      if (!STAGE_KEYS.includes(stage_key)) return res.status(400).json({ error: 'مرحلة غير معروفة' });
      if (!['done', 'na', 'pending'].includes(stage_status)) return res.status(400).json({ error: 'حالة غير صالحة' });
      stages = { ...stages, [stage_key]: stage_status };
    }

    const { rows } = await pool.query(
      `UPDATE commissioning_items SET
        stages=$1, panel_name=COALESCE($2,panel_name), serving_equipment=COALESCE($3,serving_equipment),
        item_no=COALESCE($4,item_no), notes=COALESCE($5,notes), updated_at=NOW()
       WHERE id=$6 RETURNING *`,
      [JSON.stringify(stages), panel_name, serving_equipment, item_no, notes, req.params.id]
    );
    res.json({ ...rows[0], pct: computePct(rows[0].stages) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete('/item/:id', authMiddleware, requireRole('admin', 'pm', 'lead'), async (req, res) => {
  await pool.query('DELETE FROM commissioning_items WHERE id=$1', [req.params.id]);
  res.json({ success: true });
});

// ══════════════════════════════════════════════════════════════
// EXCEL IMPORT — matches the real "Progress" sheet layout:
// row 7 = category headers (merged), row 8 = stage sub-headers,
// row 9+ = data (No. | Panel Name | Serving Equipment | 19 stage cells)
// Cell values: '●' = done, '-' = n/a, blank = pending.
// ══════════════════════════════════════════════════════════════
router.post('/:project/import', authMiddleware, requireRole('admin', 'pm', 'lead'), upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'ملف Excel مطلوب' });
  try {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(req.file.buffer);
    const ws = wb.getWorksheet('Progress') || wb.worksheets[0];
    if (!ws) return res.status(400).json({ error: 'مفيش شيت اسمه Progress في الملف' });

    // Locate the header row (contains "No." or "Panel Name") — scan first 15 rows
    let headerRow = null;
    for (let r = 1; r <= 15; r++) {
      const v = String(ws.getCell(r, 1).value || '').trim();
      const v2 = String(ws.getCell(r, 2).value || '').trim();
      if (v === 'No.' || v2 === 'Panel Name') { headerRow = r; break; }
    }
    if (!headerRow) return res.status(400).json({ error: 'مقدرتش ألاقي صف العناوين (No. / Panel Name) في أول 15 صف' });

    const dataStart = headerRow + 2; // skip category row + sub-header row
    let created = 0, updated = 0, skipped = 0;

    for (let r = dataStart; r <= ws.rowCount; r++) {
      const itemNo = ws.getCell(r, 1).value;
      const panelName = String(ws.getCell(r, 2).value || '').trim();
      if (!panelName) { continue; } // blank row — skip, don't stop (some sheets have gaps)

      const servingEquipment = String(ws.getCell(r, 3).value || '').trim() || null;
      const stages = {};
      STAGE_KEYS.forEach((key, i) => {
        const cellVal = String(ws.getCell(r, 4 + i).value || '').trim();
        if (cellVal === '-') stages[key] = 'na';
        else if (cellVal === '') stages[key] = 'pending';
        else stages[key] = 'done';
      });

      const existing = await pool.query(
        'SELECT id FROM commissioning_items WHERE project_id=$1 AND panel_name=$2', [req.params.project, panelName]
      );
      if (existing.rows.length) {
        await pool.query('UPDATE commissioning_items SET stages=$1, serving_equipment=$2, item_no=$3, updated_at=NOW() WHERE id=$4',
          [JSON.stringify(stages), servingEquipment, typeof itemNo === 'number' ? itemNo : null, existing.rows[0].id]);
        updated++;
      } else {
        await pool.query(
          `INSERT INTO commissioning_items (project_id, item_no, panel_name, serving_equipment, stages, created_by)
           VALUES ($1,$2,$3,$4,$5,$6)`,
          [req.params.project, typeof itemNo === 'number' ? itemNo : null, panelName, servingEquipment, JSON.stringify(stages), req.user.id]
        );
        created++;
      }
    }

    await pool.query(
      'INSERT INTO activity_log (type,message,icon,color,user_id,user_name) VALUES ($1,$2,$3,$4,$5,$6)',
      ['documents', `استيراد مصفوفة إنجاز — ${created} جديد، ${updated} تحديث`, 'ti-table-import', '#4f8ef7', req.user.id, req.user.name]
    );

    res.json({ created, updated, skipped });
  } catch (e) { res.status(400).json({ error: 'فشل قراءة ملف Excel: ' + e.message }); }
});

module.exports = router;
