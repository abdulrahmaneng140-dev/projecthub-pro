const router = require('express').Router();
const PDFDocument = require('pdfkit');
const ExcelJS = require('exceljs');
const { pool } = require('../db');
const { authMiddleware } = require('../middleware/auth');

// ══════════════════════════════════════════════════════════════
// SHARED DATA FETCHER — same source data feeds dashboard + reports
// ══════════════════════════════════════════════════════════════
async function getReportData(projectId) {
  const projFilter = projectId ? 'WHERE id = $1' : '';
  const taskFilter = projectId ? 'WHERE project_id = $1' : '';
  const msFilter = projectId ? 'WHERE project_id = $1' : '';
  const args = projectId ? [projectId] : [];

  const [projects, tasks, milestones] = await Promise.all([
    pool.query(`SELECT * FROM projects ${projFilter} ORDER BY created_at`, args),
    pool.query(`SELECT * FROM tasks ${taskFilter} ORDER BY due_date`, args),
    pool.query(`SELECT * FROM milestones ${msFilter} ORDER BY start_date`, args),
  ]);

  const P = projects.rows, T = tasks.rows, MS = milestones.rows;
  const today = new Date().toISOString().slice(0, 10);

  const withMetrics = P.map(p => {
    let planned = p.pct, spi = 1, cpi = 1;
    if (p.start_date && p.end_date) {
      const start = new Date(p.start_date), end = new Date(p.end_date), now = new Date();
      const totalDays = (end - start) / 86400000;
      const elapsed = Math.max(0, (now - start) / 86400000);
      planned = totalDays > 0 ? Math.min(100, Math.round(elapsed / totalDays * 100)) : p.pct;
      spi = planned > 0 ? +(p.pct / planned).toFixed(2) : 1;
    }
    if (p.budget > 0) cpi = +((p.pct / 100 * p.budget) / Math.max(1, p.spent)).toFixed(2);
    return { ...p, planned, spi, cpi };
  });

  const overdueTasks = T.filter(t => t.col !== 'done' && t.due_date && t.due_date < today);
  const delayedMs = MS.filter(m => m.status === 'delayed');
  const atRiskProjects = withMetrics.filter(p => p.status === 'at-risk' || p.status === 'delayed' || p.spi < 0.8);
  const overBudgetProjects = withMetrics.filter(p => p.budget > 0 && p.spent / p.budget > 0.85);

  return { P: withMetrics, T, MS, overdueTasks, delayedMs, atRiskProjects, overBudgetProjects, today };
}

const STATUS_LABEL = { 'on-track': 'On Track', 'at-risk': 'At Risk', 'delayed': 'Delayed', 'done': 'Done' };
const fmtMoney = n => 'SAR ' + Number(n || 0).toLocaleString('en-US');

// ══════════════════════════════════════════════════════════════
// PDF BUILDERS
// ══════════════════════════════════════════════════════════════
function pdfHeader(doc, title, subtitle) {
  doc.fontSize(18).fillColor('#111').text('Atech Automation Technology', { align: 'right' });
  doc.fontSize(10).fillColor('#666').text('ProjectHub Pro — ' + title, { align: 'right' });
  doc.fontSize(9).fillColor('#999').text(subtitle, { align: 'right' });
  doc.moveDown(1);
  doc.strokeColor('#333').lineWidth(1.5).moveTo(40, doc.y).lineTo(555, doc.y).stroke();
  doc.moveDown(1);
}

function pdfTable(doc, headers, rows, colWidths) {
  const startX = 40;
  let y = doc.y;
  doc.fontSize(9).fillColor('#fff');
  doc.rect(startX, y, colWidths.reduce((a, b) => a + b, 0), 20).fill('#333');
  let x = startX;
  headers.forEach((h, i) => {
    doc.fillColor('#fff').text(h, x + 4, y + 6, { width: colWidths[i] - 8 });
    x += colWidths[i];
  });
  y += 20;
  doc.fillColor('#222');
  rows.forEach((row, ri) => {
    if (y > 760) { doc.addPage(); y = 40; }
    if (ri % 2 === 0) doc.rect(startX, y, colWidths.reduce((a, b) => a + b, 0), 18).fill('#f5f5f5');
    x = startX;
    doc.fontSize(8.5).fillColor('#222');
    row.forEach((cell, i) => {
      doc.text(String(cell), x + 4, y + 4, { width: colWidths[i] - 8 });
      x += colWidths[i];
    });
    y += 18;
  });
  doc.y = y + 10;
}

function buildProgressPDF(res, data, scopeLabel) {
  const doc = new PDFDocument({ margin: 40, size: 'A4' });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', 'attachment; filename="progress-report.pdf"');
  doc.pipe(res);
  pdfHeader(doc, 'Progress Report', scopeLabel + ' — ' + new Date().toLocaleDateString('en-GB'));

  doc.fontSize(11).fillColor('#111').text(`Projects: ${data.P.length}   |   Avg Progress: ${data.P.length ? Math.round(data.P.reduce((a, p) => a + p.pct, 0) / data.P.length) : 0}%   |   Overdue Tasks: ${data.overdueTasks.length}`);
  doc.moveDown(1);

  pdfTable(doc, ['Project', 'Progress', 'Planned', 'SPI', 'Status', 'Lead'],
    data.P.map(p => [p.name, p.pct + '%', p.planned + '%', p.spi, STATUS_LABEL[p.status] || p.status, p.lead || '-']),
    [160, 60, 60, 45, 80, 105]);

  if (data.overdueTasks.length) {
    doc.moveDown(0.5).fontSize(12).fillColor('#c62828').text('Overdue Tasks');
    doc.moveDown(0.3);
    pdfTable(doc, ['Task', 'Project', 'Assigned To', 'Due Date'],
      data.overdueTasks.map(t => [t.title, t.project_id, t.assigned_to || '-', t.due_date]),
      [200, 80, 130, 100]);
  }
  doc.end();
}

function buildFinancialPDF(res, data, scopeLabel) {
  const doc = new PDFDocument({ margin: 40, size: 'A4' });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', 'attachment; filename="financial-report.pdf"');
  doc.pipe(res);
  pdfHeader(doc, 'Financial Report', scopeLabel + ' — ' + new Date().toLocaleDateString('en-GB'));

  const totalBudget = data.P.reduce((a, p) => a + (+p.budget || 0), 0);
  const totalSpent = data.P.reduce((a, p) => a + (+p.spent || 0), 0);
  doc.fontSize(11).fillColor('#111').text(`Total Budget: ${fmtMoney(totalBudget)}   |   Total Spent: ${fmtMoney(totalSpent)}   |   Utilization: ${totalBudget ? Math.round(totalSpent / totalBudget * 100) : 0}%`);
  doc.moveDown(1);

  pdfTable(doc, ['Project', 'Budget', 'Spent', 'Variance', 'Util %', 'CPI'],
    data.P.map(p => [p.name, fmtMoney(p.budget), fmtMoney(p.spent), fmtMoney((p.budget || 0) - (p.spent || 0)), p.budget ? Math.round(p.spent / p.budget * 100) + '%' : '-', p.cpi]),
    [140, 90, 90, 90, 60, 40]);

  if (data.overBudgetProjects.length) {
    doc.moveDown(0.5).fontSize(12).fillColor('#c62828').text('Budget Watch (>85% utilized)');
    doc.moveDown(0.3);
    pdfTable(doc, ['Project', 'Utilization', 'Remaining'],
      data.overBudgetProjects.map(p => [p.name, Math.round(p.spent / p.budget * 100) + '%', fmtMoney(p.budget - p.spent)]),
      [200, 100, 110]);
  }
  doc.end();
}

function buildRiskPDF(res, data, scopeLabel) {
  const doc = new PDFDocument({ margin: 40, size: 'A4' });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', 'attachment; filename="risk-report.pdf"');
  doc.pipe(res);
  pdfHeader(doc, 'Risk Report', scopeLabel + ' — ' + new Date().toLocaleDateString('en-GB'));

  doc.fontSize(11).fillColor('#111').text(`At-Risk / Delayed Projects: ${data.atRiskProjects.length}   |   Overdue Tasks: ${data.overdueTasks.length}   |   Delayed Milestones: ${data.delayedMs.length}`);
  doc.moveDown(1);

  if (data.atRiskProjects.length) {
    doc.fontSize(12).fillColor('#c62828').text('At-Risk / Delayed Projects');
    doc.moveDown(0.3);
    pdfTable(doc, ['Project', 'Status', 'Progress', 'SPI', 'Budget Util'],
      data.atRiskProjects.map(p => [p.name, STATUS_LABEL[p.status] || p.status, p.pct + '%', p.spi, p.budget ? Math.round(p.spent / p.budget * 100) + '%' : '-']),
      [150, 90, 70, 60, 90]);
  } else {
    doc.fontSize(10).fillColor('#2e7d32').text('No projects currently at risk.');
  }

  if (data.delayedMs.length) {
    doc.moveDown(0.5).fontSize(12).fillColor('#c62828').text('Delayed Milestones');
    doc.moveDown(0.3);
    pdfTable(doc, ['Milestone', 'Project', 'End Date', 'Progress'],
      data.delayedMs.map(m => [m.title, m.project_id, m.end_date, m.pct + '%']),
      [180, 80, 100, 100]);
  }
  doc.end();
}

const PDF_BUILDERS = { progress: buildProgressPDF, financial: buildFinancialPDF, risk: buildRiskPDF };

// ══════════════════════════════════════════════════════════════
// EXCEL BUILDERS
// ══════════════════════════════════════════════════════════════
function styleHeaderRow(row) {
  row.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  row.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF333333' } };
  row.alignment = { vertical: 'middle' };
}

async function buildProgressExcel(res, data) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'ProjectHub Pro';
  const ws = wb.addWorksheet('Progress');
  ws.columns = [
    { header: 'Project', key: 'name', width: 30 },
    { header: 'Progress %', key: 'pct', width: 12 },
    { header: 'Planned %', key: 'planned', width: 12 },
    { header: 'SPI', key: 'spi', width: 8 },
    { header: 'Status', key: 'status', width: 14 },
    { header: 'Lead', key: 'lead', width: 18 },
    { header: 'Start', key: 'start_date', width: 14 },
    { header: 'End', key: 'end_date', width: 14 },
  ];
  styleHeaderRow(ws.getRow(1));
  data.P.forEach(p => ws.addRow({ name: p.name, pct: p.pct, planned: p.planned, spi: p.spi, status: STATUS_LABEL[p.status] || p.status, lead: p.lead, start_date: p.start_date, end_date: p.end_date }));

  const wt = wb.addWorksheet('Overdue Tasks');
  wt.columns = [
    { header: 'Task', key: 'title', width: 35 },
    { header: 'Project', key: 'project_id', width: 15 },
    { header: 'Assigned To', key: 'assigned_to', width: 20 },
    { header: 'Due Date', key: 'due_date', width: 14 },
    { header: 'Priority', key: 'priority', width: 10 },
  ];
  styleHeaderRow(wt.getRow(1));
  data.overdueTasks.forEach(t => wt.addRow(t));

  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', 'attachment; filename="progress-report.xlsx"');
  await wb.xlsx.write(res);
  res.end();
}

async function buildFinancialExcel(res, data) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Financial');
  ws.columns = [
    { header: 'Project', key: 'name', width: 30 },
    { header: 'Budget', key: 'budget', width: 15 },
    { header: 'Spent', key: 'spent', width: 15 },
    { header: 'Variance', key: 'variance', width: 15 },
    { header: 'Utilization %', key: 'util', width: 14 },
    { header: 'CPI', key: 'cpi', width: 8 },
  ];
  styleHeaderRow(ws.getRow(1));
  data.P.forEach(p => ws.addRow({
    name: p.name, budget: +p.budget || 0, spent: +p.spent || 0,
    variance: (+p.budget || 0) - (+p.spent || 0),
    util: p.budget ? Math.round(p.spent / p.budget * 100) : 0, cpi: p.cpi
  }));
  ws.getColumn('budget').numFmt = '#,##0 "SAR"';
  ws.getColumn('spent').numFmt = '#,##0 "SAR"';
  ws.getColumn('variance').numFmt = '#,##0 "SAR"';

  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', 'attachment; filename="financial-report.xlsx"');
  await wb.xlsx.write(res);
  res.end();
}

async function buildRiskExcel(res, data) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('At-Risk Projects');
  ws.columns = [
    { header: 'Project', key: 'name', width: 30 },
    { header: 'Status', key: 'status', width: 14 },
    { header: 'Progress %', key: 'pct', width: 12 },
    { header: 'SPI', key: 'spi', width: 8 },
    { header: 'Budget Util %', key: 'util', width: 14 },
  ];
  styleHeaderRow(ws.getRow(1));
  data.atRiskProjects.forEach(p => ws.addRow({ name: p.name, status: STATUS_LABEL[p.status] || p.status, pct: p.pct, spi: p.spi, util: p.budget ? Math.round(p.spent / p.budget * 100) : 0 }));

  const wm = wb.addWorksheet('Delayed Milestones');
  wm.columns = [
    { header: 'Milestone', key: 'title', width: 30 },
    { header: 'Project', key: 'project_id', width: 15 },
    { header: 'End Date', key: 'end_date', width: 14 },
    { header: 'Progress %', key: 'pct', width: 12 },
  ];
  styleHeaderRow(wm.getRow(1));
  data.delayedMs.forEach(m => wm.addRow(m));

  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', 'attachment; filename="risk-report.xlsx"');
  await wb.xlsx.write(res);
  res.end();
}

const EXCEL_BUILDERS = { progress: buildProgressExcel, financial: buildFinancialExcel, risk: buildRiskExcel };

// ══════════════════════════════════════════════════════════════
// ROUTES
// ══════════════════════════════════════════════════════════════
// GET /api/reports/:type/:format?project=PC003
// type: progress | financial | risk      format: pdf | xlsx
router.get('/:type/:format', authMiddleware, async (req, res) => {
  const { type, format } = req.params;
  const { project } = req.query;

  if (!PDF_BUILDERS[type]) return res.status(400).json({ error: 'نوع تقرير غير معروف — استخدم progress أو financial أو risk' });
  if (format !== 'pdf' && format !== 'xlsx') return res.status(400).json({ error: 'الصيغة يجب أن تكون pdf أو xlsx' });

  try {
    const data = await getReportData(project || null);
    const scopeLabel = project ? `Project: ${project}` : 'All Projects';

    if (format === 'pdf') {
      PDF_BUILDERS[type](res, data, scopeLabel);
    } else {
      await EXCEL_BUILDERS[type](res, data);
    }

    pool.query(
      'INSERT INTO activity_log (type,message,icon,color,user_id,user_name) VALUES ($1,$2,$3,$4,$5,$6)',
      ['reports', `تصدير تقرير ${type} (${format})${project ? ' — ' + project : ''}`, 'ti-file-export', '#4f8ef7', req.user.id, req.user.name]
    ).catch(() => {});
  } catch (e) {
    if (!res.headersSent) res.status(500).json({ error: e.message });
  }
});

module.exports = router;
