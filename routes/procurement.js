const router = require('express').Router();
const PDFDocument = require('pdfkit');
const { pool } = require('../db');
const { authMiddleware, requireRole } = require('../middleware/auth');

// ══════════════════════════════════════════════════════════════
// VENDORS — supplier/subcontractor database (global, not per-project)
// ══════════════════════════════════════════════════════════════
router.get('/vendors', authMiddleware, async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM vendors ORDER BY name');
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/vendors', authMiddleware, requireRole('admin', 'pm'), async (req, res) => {
  const { name, category, contact_person, phone, email, rating, notes } = req.body;
  if (!name) return res.status(400).json({ error: 'اسم المورد مطلوب' });
  try {
    const { rows } = await pool.query(
      `INSERT INTO vendors (name, category, contact_person, phone, email, rating, notes, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [name, category || 'materials', contact_person || null, phone || null, email || null, rating || null, notes || null, req.user.id]
    );
    res.status(201).json(rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.put('/vendors/:id', authMiddleware, requireRole('admin', 'pm'), async (req, res) => {
  const { name, category, contact_person, phone, email, rating, notes } = req.body;
  try {
    const { rows } = await pool.query(
      `UPDATE vendors SET name=COALESCE($1,name), category=COALESCE($2,category), contact_person=COALESCE($3,contact_person),
        phone=COALESCE($4,phone), email=COALESCE($5,email), rating=COALESCE($6,rating), notes=COALESCE($7,notes), updated_at=NOW()
       WHERE id=$8 RETURNING *`,
      [name, category, contact_person, phone, email, rating, notes, req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'المورد غير موجود' });
    res.json(rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete('/vendors/:id', authMiddleware, requireRole('admin', 'pm'), async (req, res) => {
  await pool.query('DELETE FROM vendors WHERE id=$1', [req.params.id]);
  res.json({ success: true });
});

// ══════════════════════════════════════════════════════════════
// PURCHASE ORDERS
// ══════════════════════════════════════════════════════════════

// GET /api/procurement/summary/long-lead — across all projects, open long-lead items not yet delivered
router.get('/summary/long-lead', authMiddleware, async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT po.*, p.name AS project_name, v.name AS vendor_name
      FROM purchase_orders po
      JOIN projects p ON p.id = po.project_id
      LEFT JOIN vendors v ON v.id = po.vendor_id
      WHERE po.is_long_lead = true AND po.status != 'delivered' AND po.status != 'cancelled'
      ORDER BY po.expected_delivery_date NULLS LAST
    `);
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/:project/orders', authMiddleware, async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT po.*, v.name AS vendor_name FROM purchase_orders po
      LEFT JOIN vendors v ON v.id = po.vendor_id
      WHERE po.project_id=$1 ORDER BY po.order_date DESC, po.id DESC
    `, [req.params.project]);
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/:project/orders', authMiddleware, requireRole('admin', 'pm'), async (req, res) => {
  const { vendor_id, description, amount, is_long_lead, expected_delivery_date, notes } = req.body;
  if (!description || !amount) return res.status(400).json({ error: 'الوصف والقيمة مطلوبين' });
  try {
    const { rows: countRow } = await pool.query('SELECT COUNT(*) FROM purchase_orders WHERE project_id=$1', [req.params.project]);
    const poNumber = `PO-${req.params.project}-${String(+countRow[0].count + 1).padStart(3, '0')}`;
    const { rows } = await pool.query(
      `INSERT INTO purchase_orders (project_id, vendor_id, po_number, description, amount, is_long_lead, expected_delivery_date, notes, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [req.params.project, vendor_id || null, poNumber, description, amount, !!is_long_lead, expected_delivery_date || null, notes || null, req.user.id]
    );
    res.status(201).json(rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.put('/orders/:id', authMiddleware, requireRole('admin', 'pm'), async (req, res) => {
  const { vendor_id, description, amount, is_long_lead, expected_delivery_date, actual_delivery_date, status, notes } = req.body;
  try {
    const autoActualDelivery = status === 'delivered' && !actual_delivery_date ? new Date().toISOString().slice(0, 10) : actual_delivery_date;
    const { rows } = await pool.query(
      `UPDATE purchase_orders SET
        vendor_id=COALESCE($1,vendor_id), description=COALESCE($2,description), amount=COALESCE($3,amount),
        is_long_lead=COALESCE($4,is_long_lead), expected_delivery_date=COALESCE($5,expected_delivery_date),
        actual_delivery_date=COALESCE($6,actual_delivery_date), status=COALESCE($7,status), notes=COALESCE($8,notes), updated_at=NOW()
       WHERE id=$9 RETURNING *`,
      [vendor_id, description, amount, is_long_lead, expected_delivery_date, autoActualDelivery, status, notes, req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'أمر الشراء غير موجود' });
    res.json(rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete('/orders/:id', authMiddleware, requireRole('admin', 'pm'), async (req, res) => {
  await pool.query('DELETE FROM purchase_orders WHERE id=$1', [req.params.id]);
  res.json({ success: true });
});

// GET /api/procurement/orders/:id/pdf — formal purchase order document
router.get('/orders/:id/pdf', authMiddleware, async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT po.*, p.name AS project_name, v.name AS vendor_name, v.contact_person, v.phone, v.email
      FROM purchase_orders po
      JOIN projects p ON p.id = po.project_id
      LEFT JOIN vendors v ON v.id = po.vendor_id
      WHERE po.id=$1
    `, [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'أمر الشراء غير موجود' });
    const po = rows[0];

    const doc = new PDFDocument({ margin: 50, size: 'A4' });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${po.po_number}.pdf"`);
    doc.pipe(res);

    doc.fontSize(20).fillColor('#111').text('Atech Automation Technology', { align: 'left' });
    doc.fontSize(9).fillColor('#666').text('Building Management & Environmental Monitoring Systems', { align: 'left' });
    doc.moveDown(1.5);

    doc.fontSize(22).fillColor('#9b72f4').text('PURCHASE ORDER', { align: 'right' });
    doc.fontSize(10).fillColor('#333').text(po.po_number, { align: 'right' });
    doc.moveDown(1);
    doc.strokeColor('#ddd').lineWidth(1).moveTo(50, doc.y).lineTo(545, doc.y).stroke();
    doc.moveDown(1);

    const leftX = 50, rightX = 320;
    const topY = doc.y;
    doc.fontSize(10).fillColor('#888').text('Vendor:', leftX, topY);
    doc.fontSize(12).fillColor('#111').text(po.vendor_name || '-', leftX, topY + 15);
    if (po.contact_person) doc.fontSize(9).fillColor('#666').text(po.contact_person, leftX, topY + 32);
    if (po.phone) doc.fontSize(9).fillColor('#666').text(po.phone, leftX, topY + 46);

    doc.fontSize(10).fillColor('#888').text('Project:', rightX, topY);
    doc.fontSize(11).fillColor('#111').text(po.project_name, rightX, topY + 15);
    doc.fontSize(10).fillColor('#888').text('Order Date:', rightX, topY + 35);
    doc.fontSize(11).fillColor('#111').text(po.order_date || '-', rightX, topY + 50);

    doc.y = topY + 90;
    doc.moveDown(1);

    if (po.is_long_lead) {
      doc.fillColor('#f0a030').fontSize(10).text('⚠ LONG-LEAD ITEM', { align: 'left' });
      doc.moveDown(0.3);
    }
    if (po.expected_delivery_date) {
      doc.fillColor('#666').fontSize(10).text(`Expected Delivery: ${po.expected_delivery_date}`);
      doc.moveDown(0.5);
    }

    const tableY = doc.y;
    doc.rect(50, tableY, 495, 24).fill('#333');
    doc.fontSize(10).fillColor('#fff').text('Description', 60, tableY + 7).text('Amount (SAR)', 430, tableY + 7);
    doc.rect(50, tableY + 24, 495, 40).fill('#f8f8f8');
    doc.fontSize(10).fillColor('#222').text(po.description, 60, tableY + 34, { width: 350 })
      .text((+po.amount).toLocaleString('en-US'), 430, tableY + 34);

    let y = tableY + 74;
    doc.strokeColor('#333').lineWidth(1).moveTo(380, y).lineTo(545, y).stroke();
    y += 8;
    doc.fontSize(13).fillColor('#111').text('Total', 380, y).text((+po.amount).toLocaleString('en-US') + ' SAR', 460, y);

    if (po.notes) {
      doc.moveDown(3);
      doc.fontSize(9).fillColor('#888').text('Notes:', 50);
      doc.fontSize(9).fillColor('#444').text(po.notes, 50, doc.y + 2, { width: 495 });
    }

    doc.end();
  } catch (e) {
    if (!res.headersSent) res.status(500).json({ error: e.message });
  }
});

module.exports = router;
