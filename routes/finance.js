const router = require('express').Router();
const PDFDocument = require('pdfkit');
const { pool } = require('../db');
const { authMiddleware, requireRole } = require('../middleware/auth');

// ══════════════════════════════════════════════════════════════
// INVOICES (Accounts Receivable)
// ══════════════════════════════════════════════════════════════

// GET /api/finance/summary/all — across all projects, for a portfolio-level financial widget
router.get('/summary/all', authMiddleware, async (req, res) => {
  try {
    const [invR, billR] = await Promise.all([
      pool.query(`SELECT status, amount, tax_pct FROM invoices`),
      pool.query(`SELECT status, amount FROM vendor_bills`),
    ]);
    const totalInvoiced = invR.rows.reduce((a, i) => a + (+i.amount * (1 + (+i.tax_pct || 0) / 100)), 0);
    const totalPaid = invR.rows.filter(i => i.status === 'paid').reduce((a, i) => a + (+i.amount * (1 + (+i.tax_pct || 0) / 100)), 0);
    const outstandingAR = totalInvoiced - totalPaid;
    const totalBills = billR.rows.reduce((a, b) => a + (+b.amount), 0);
    const paidBills = billR.rows.filter(b => b.status === 'paid').reduce((a, b) => a + (+b.amount), 0);
    const outstandingAP = totalBills - paidBills;
    res.json({ totalInvoiced, totalPaid, outstandingAR, totalBills, paidBills, outstandingAP });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/finance/:project/invoices
router.get('/:project/invoices', authMiddleware, async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM invoices WHERE project_id=$1 ORDER BY issue_date DESC, id DESC', [req.params.project]);
    res.json(rows.map(i => ({ ...i, total: +i.amount * (1 + (+i.tax_pct || 0) / 100) })));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/finance/:project/invoices
router.post('/:project/invoices', authMiddleware, requireRole('admin', 'pm'), async (req, res) => {
  const { client_name, description, amount, tax_pct, issue_date, due_date, notes } = req.body;
  if (!amount) return res.status(400).json({ error: 'قيمة الفاتورة مطلوبة' });
  try {
    const { rows: countRow } = await pool.query('SELECT COUNT(*) FROM invoices WHERE project_id=$1', [req.params.project]);
    const invoiceNumber = `INV-${req.params.project}-${String(+countRow[0].count + 1).padStart(3, '0')}`;
    const { rows } = await pool.query(
      `INSERT INTO invoices (project_id, invoice_number, client_name, description, amount, tax_pct, issue_date, due_date, notes, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
      [req.params.project, invoiceNumber, client_name || null, description || null, amount, tax_pct ?? 15,
        issue_date || new Date().toISOString().slice(0, 10), due_date || null, notes || null, req.user.id]
    );
    res.status(201).json(rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// PUT /api/finance/invoices/:id
router.put('/invoices/:id', authMiddleware, requireRole('admin', 'pm'), async (req, res) => {
  const { client_name, description, amount, tax_pct, due_date, status, notes } = req.body;
  try {
    const paidDate = status === 'paid' ? new Date().toISOString().slice(0, 10) : undefined;
    const paidAmount = status === 'paid' ? amount : undefined;
    const { rows } = await pool.query(
      `UPDATE invoices SET
        client_name=COALESCE($1,client_name), description=COALESCE($2,description), amount=COALESCE($3,amount),
        tax_pct=COALESCE($4,tax_pct), due_date=COALESCE($5,due_date), status=COALESCE($6,status),
        notes=COALESCE($7,notes), paid_date=COALESCE($8,paid_date), paid_amount=COALESCE($9,paid_amount), updated_at=NOW()
       WHERE id=$10 RETURNING *`,
      [client_name, description, amount, tax_pct, due_date, status, notes, paidDate, paidAmount, req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'الفاتورة غير موجودة' });
    res.json(rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete('/invoices/:id', authMiddleware, requireRole('admin', 'pm'), async (req, res) => {
  await pool.query('DELETE FROM invoices WHERE id=$1', [req.params.id]);
  res.json({ success: true });
});

// GET /api/finance/invoices/:id/pdf — professional invoice document
router.get('/invoices/:id/pdf', authMiddleware, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT i.*, p.name AS project_name FROM invoices i JOIN projects p ON p.id = i.project_id WHERE i.id=$1`,
      [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'الفاتورة غير موجودة' });
    const inv = rows[0];
    const tax = +inv.amount * (+inv.tax_pct || 0) / 100;
    const total = +inv.amount + tax;

    const doc = new PDFDocument({ margin: 50, size: 'A4' });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${inv.invoice_number}.pdf"`);
    doc.pipe(res);

    doc.fontSize(20).fillColor('#111').text('Atech Automation Technology', { align: 'left' });
    doc.fontSize(9).fillColor('#666').text('Building Management & Environmental Monitoring Systems', { align: 'left' });
    doc.moveDown(1.5);

    doc.fontSize(22).fillColor('#4f8ef7').text('INVOICE', { align: 'right' });
    doc.fontSize(10).fillColor('#333').text(inv.invoice_number, { align: 'right' });
    doc.moveDown(1);
    doc.strokeColor('#ddd').lineWidth(1).moveTo(50, doc.y).lineTo(545, doc.y).stroke();
    doc.moveDown(1);

    const leftX = 50, rightX = 320;
    const topY = doc.y;
    doc.fontSize(10).fillColor('#888').text('Bill To:', leftX, topY);
    doc.fontSize(12).fillColor('#111').text(inv.client_name || '-', leftX, topY + 15);
    doc.fontSize(10).fillColor('#888').text('Project:', leftX, topY + 35);
    doc.fontSize(11).fillColor('#111').text(inv.project_name, leftX, topY + 50);

    doc.fontSize(10).fillColor('#888').text('Issue Date:', rightX, topY);
    doc.fontSize(11).fillColor('#111').text(inv.issue_date || '-', rightX + 80, topY);
    doc.fontSize(10).fillColor('#888').text('Due Date:', rightX, topY + 20);
    doc.fontSize(11).fillColor('#111').text(inv.due_date || '-', rightX + 80, topY + 20);
    doc.fontSize(10).fillColor('#888').text('Status:', rightX, topY + 40);
    doc.fontSize(11).fillColor(inv.status === 'paid' ? '#22c87a' : '#f0a030').text(inv.status.toUpperCase(), rightX + 80, topY + 40);

    doc.y = topY + 90;
    doc.moveDown(1);

    const tableY = doc.y;
    doc.rect(50, tableY, 495, 24).fill('#333');
    doc.fontSize(10).fillColor('#fff').text('Description', 60, tableY + 7).text('Amount (SAR)', 430, tableY + 7);
    doc.rect(50, tableY + 24, 495, 30).fill('#f8f8f8');
    doc.fontSize(10).fillColor('#222').text(inv.description || 'Professional services rendered', 60, tableY + 34, { width: 350 })
      .text((+inv.amount).toLocaleString('en-US'), 430, tableY + 34);

    let y = tableY + 60;
    doc.fontSize(10).fillColor('#666').text('Subtotal', 380, y).text((+inv.amount).toLocaleString('en-US') + ' SAR', 460, y);
    y += 18;
    doc.text(`VAT (${inv.tax_pct}%)`, 380, y).text(tax.toLocaleString('en-US') + ' SAR', 460, y);
    y += 22;
    doc.strokeColor('#333').lineWidth(1).moveTo(380, y).lineTo(545, y).stroke();
    y += 8;
    doc.fontSize(13).fillColor('#111').text('Total Due', 380, y).text(total.toLocaleString('en-US') + ' SAR', 460, y);

    if (inv.notes) {
      doc.moveDown(3);
      doc.fontSize(9).fillColor('#888').text('Notes:', 50);
      doc.fontSize(9).fillColor('#444').text(inv.notes, 50, doc.y + 2, { width: 495 });
    }

    doc.end();
  } catch (e) {
    if (!res.headersSent) res.status(500).json({ error: e.message });
  }
});

// ══════════════════════════════════════════════════════════════
// VENDOR BILLS (Accounts Payable)
// ══════════════════════════════════════════════════════════════

router.get('/:project/bills', authMiddleware, async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM vendor_bills WHERE project_id=$1 ORDER BY bill_date DESC, id DESC', [req.params.project]);
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/:project/bills', authMiddleware, requireRole('admin', 'pm'), async (req, res) => {
  const { vendor_name, category, description, amount, bill_date, due_date, notes } = req.body;
  if (!vendor_name || !amount) return res.status(400).json({ error: 'اسم المورد والمبلغ مطلوبين' });
  try {
    const { rows: countRow } = await pool.query('SELECT COUNT(*) FROM vendor_bills WHERE project_id=$1', [req.params.project]);
    const billNumber = `BILL-${req.params.project}-${String(+countRow[0].count + 1).padStart(3, '0')}`;
    const { rows } = await pool.query(
      `INSERT INTO vendor_bills (project_id, bill_number, vendor_name, category, description, amount, bill_date, due_date, notes, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
      [req.params.project, billNumber, vendor_name, category || 'materials', description || null, amount,
        bill_date || new Date().toISOString().slice(0, 10), due_date || null, notes || null, req.user.id]
    );
    res.status(201).json(rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.put('/bills/:id', authMiddleware, requireRole('admin', 'pm'), async (req, res) => {
  const { vendor_name, category, description, amount, due_date, status, notes } = req.body;
  try {
    const paidDate = status === 'paid' ? new Date().toISOString().slice(0, 10) : undefined;
    const { rows } = await pool.query(
      `UPDATE vendor_bills SET
        vendor_name=COALESCE($1,vendor_name), category=COALESCE($2,category), description=COALESCE($3,description),
        amount=COALESCE($4,amount), due_date=COALESCE($5,due_date), status=COALESCE($6,status),
        notes=COALESCE($7,notes), paid_date=COALESCE($8,paid_date), updated_at=NOW()
       WHERE id=$9 RETURNING *`,
      [vendor_name, category, description, amount, due_date, status, notes, paidDate, req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'الفاتورة غير موجودة' });
    res.json(rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete('/bills/:id', authMiddleware, requireRole('admin', 'pm'), async (req, res) => {
  await pool.query('DELETE FROM vendor_bills WHERE id=$1', [req.params.id]);
  res.json({ success: true });
});

// GET /api/finance/:project/summary — AR/AP totals for one project
router.get('/:project/summary', authMiddleware, async (req, res) => {
  try {
    const [invR, billR] = await Promise.all([
      pool.query('SELECT status, amount, tax_pct FROM invoices WHERE project_id=$1', [req.params.project]),
      pool.query('SELECT status, amount FROM vendor_bills WHERE project_id=$1', [req.params.project]),
    ]);
    const totalInvoiced = invR.rows.reduce((a, i) => a + (+i.amount * (1 + (+i.tax_pct || 0) / 100)), 0);
    const totalPaid = invR.rows.filter(i => i.status === 'paid').reduce((a, i) => a + (+i.amount * (1 + (+i.tax_pct || 0) / 100)), 0);
    const totalBills = billR.rows.reduce((a, b) => a + (+b.amount), 0);
    const paidBills = billR.rows.filter(b => b.status === 'paid').reduce((a, b) => a + (+b.amount), 0);
    res.json({
      totalInvoiced, totalPaid, outstandingAR: totalInvoiced - totalPaid,
      totalBills, paidBills, outstandingAP: totalBills - paidBills,
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
