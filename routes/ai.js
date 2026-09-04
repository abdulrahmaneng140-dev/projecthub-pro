const router = require('express').Router();
const { pool } = require('../db');
const { authMiddleware } = require('../middleware/auth');
const { askClaude } = require('../lib/claude');

// ── POST /api/ai — project chat assistant (unchanged behavior, moved from server.js) ──
router.post('/', authMiddleware, async (req, res) => {
  const { question, context } = req.body;
  if (!process.env.ANTHROPIC_API_KEY) return res.status(503).json({ error: 'ANTHROPIC_API_KEY غير مضاف في إعدادات الخادم' });
  try {
    const system = `أنت مساعد ذكي لإدارة المشاريع الهندسية — Atech Automation. تتحدث بالعربية المصرية بإيجاز وعملية.\nالمشاريع:\n${context?.projects}\n${context?.tasks}\nالمستخدم: ${context?.user} (${context?.role})\nأجب في 2-4 جمل.`;
    const answer = await askClaude(system, question, 800);
    res.json({ answer: answer || 'لا توجد إجابة' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ══════════════════════════════════════════════════════════════
// RISK ANALYSIS — gathers open issues, low-completion commissioning
// panels, and missing documents, and asks Claude for a structured
// risk analysis. Optional project_id scopes to one project.
// ══════════════════════════════════════════════════════════════
router.post('/risk-analysis', authMiddleware, async (req, res) => {
  if (!process.env.ANTHROPIC_API_KEY) return res.status(503).json({ error: 'ANTHROPIC_API_KEY غير مضاف في إعدادات الخادم' });
  const { project_id } = req.body;
  try {
    const args = project_id ? [project_id] : [];
    const [issuesR, commR, docsR, projR] = await Promise.all([
      pool.query(`SELECT * FROM project_issues WHERE status='Open' ${project_id ? 'AND project_id=$1' : ''} ORDER BY open_date`, args),
      pool.query(`SELECT * FROM commissioning_items ${project_id ? 'WHERE project_id=$1' : ''}`, args),
      pool.query(`SELECT * FROM project_documents WHERE status='missing' ${project_id ? 'AND project_id=$1' : ''}`, args),
      project_id ? pool.query('SELECT * FROM projects WHERE id=$1', [project_id]) : pool.query('SELECT * FROM projects'),
    ]);

    if (!issuesR.rows.length && !commR.rows.length && !docsR.rows.length) {
      return res.json({ analysis: 'لا توجد بيانات كافية للتحليل حالياً — مفيش مشاكل مفتوحة أو مستندات ناقصة أو لوحات مسجّلة لهذا النطاق.', dataPoints: { openIssues: 0, missingDocs: 0, panels: 0 } });
    }

    const STAGE_COUNT = 19;
    const commSummary = commR.rows.map(c => {
      const done = Object.values(c.stages || {}).filter(v => v === 'done').length;
      return `${c.panel_name}: ${Math.round(done / STAGE_COUNT * 100)}%`;
    }).join('، ');

    const context = `
المشاريع: ${projR.rows.map(p => `${p.name} (${p.status}, ${p.pct}% إنجاز)`).join(' | ')}

مشاكل مفتوحة (${issuesR.rows.length}):
${issuesR.rows.map(i => `- [${i.phase || 'عام'}] ${i.issue} (مفتوحة منذ ${i.open_date || 'غير معروف'}, المسؤول: ${i.responsible || 'غير محدد'})`).join('\n') || 'لا يوجد'}

مستندات ناقصة (${docsR.rows.length}): ${docsR.rows.map(d => d.name).join('، ') || 'لا يوجد'}

نسب إنجاز اللوحات/الحلقات: ${commSummary || 'لا توجد بيانات'}
    `.trim();

    const system = `أنت محلل مخاطر مشاريع هندسية خبير في أنظمة BMS/EMS وتوثيق GMP. اقرأ البيانات المعطاة وقدم تحليل مخاطر بالعربية:
1. أهم 3-5 مخاطر مرتبة من الأخطر للأقل خطورة
2. لكل خطر: سبب مختصر وتأثيره المحتمل على الجدول الزمني أو الجودة
3. توصية عملية واحدة لكل خطر
اكتب في نقاط واضحة ومباشرة، بدون مقدمات طويلة.`;

    const analysis = await askClaude(system, context, 900);
    if (!analysis) return res.status(503).json({ error: 'فشل الحصول على تحليل من الذكاء الاصطناعي — حاول مرة أخرى' });

    res.json({ analysis, dataPoints: { openIssues: issuesR.rows.length, missingDocs: docsR.rows.length, panels: commR.rows.length } });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
