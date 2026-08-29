const router = require('express').Router();
const { pool } = require('../db');
const { authMiddleware, requireRole } = require('../middleware/auth');

// ══════════════════════════════════════════════════════════════
// MICROSOFT GRAPH — OAuth2 (Authorization Code flow)
// Requires an Azure AD App Registration:
//   MS_CLIENT_ID, MS_CLIENT_SECRET, MS_TENANT_ID, MS_REDIRECT_URI in .env
//   Redirect URI in Azure must match MS_REDIRECT_URI exactly
//   API permissions needed: Mail.Send, Calendars.ReadWrite, Files.ReadWrite, offline_access, User.Read
// ══════════════════════════════════════════════════════════════

const TENANT = process.env.MS_TENANT_ID || 'common';
const AUTH_BASE = `https://login.microsoftonline.com/${TENANT}/oauth2/v2.0`;
const SCOPES = 'offline_access User.Read Mail.Send Calendars.ReadWrite Files.ReadWrite';

function configured() {
  return !!(process.env.MS_CLIENT_ID && process.env.MS_CLIENT_SECRET && process.env.MS_REDIRECT_URI);
}

// GET /api/integrations/msgraph/status
router.get('/status', authMiddleware, async (req, res) => {
  if (!configured()) return res.json({ configured: false, connected: false });
  const { rows } = await pool.query('SELECT account_email, expires_at, updated_at FROM ms_graph_accounts ORDER BY id DESC LIMIT 1');
  res.json({ configured: true, connected: !!rows.length, account: rows[0] || null });
});

const jwt = require('jsonwebtoken');

// GET /api/integrations/msgraph/connect?token=... — redirects to Microsoft login
// (accepts token via query param since this is a browser navigation, not a fetch call)
router.get('/connect', (req, res) => {
  let user;
  try {
    user = jwt.verify(req.query.token, process.env.JWT_SECRET);
  } catch {
    return res.status(401).send('الجلسة غير صالحة — سجل الدخول وحاول تاني');
  }
  if (!['admin', 'pm'].includes(user.role)) return res.status(403).send('صلاحية Admin أو PM مطلوبة');
  if (!configured()) return res.status(503).send('إعدادات Azure AD غير مضبوطة — أضف MS_CLIENT_ID و MS_CLIENT_SECRET و MS_REDIRECT_URI في .env');
  const params = new URLSearchParams({
    client_id: process.env.MS_CLIENT_ID,
    response_type: 'code',
    redirect_uri: process.env.MS_REDIRECT_URI,
    response_mode: 'query',
    scope: SCOPES,
    state: String(user.id),
  });
  res.redirect(`${AUTH_BASE}/authorize?${params.toString()}`);
});

// GET /api/integrations/msgraph/callback — Azure redirects here after login
router.get('/callback', async (req, res) => {
  const { code, error, error_description } = req.query;
  if (error) return res.status(400).send(`فشل الربط مع Microsoft: ${error_description || error}`);
  if (!code) return res.status(400).send('لا يوجد كود تفويض');

  try {
    const tokenRes = await fetch(`${AUTH_BASE}/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: process.env.MS_CLIENT_ID,
        client_secret: process.env.MS_CLIENT_SECRET,
        code,
        redirect_uri: process.env.MS_REDIRECT_URI,
        grant_type: 'authorization_code',
        scope: SCOPES,
      }),
    });
    const tokenData = await tokenRes.json();
    if (!tokenRes.ok) throw new Error(tokenData.error_description || 'فشل الحصول على Token');

    const meRes = await fetch('https://graph.microsoft.com/v1.0/me', {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });
    const me = await meRes.json();

    const expiresAt = new Date(Date.now() + tokenData.expires_in * 1000);
    await pool.query('DELETE FROM ms_graph_accounts'); // single shared org account
    await pool.query(
      `INSERT INTO ms_graph_accounts (connected_by, account_email, access_token, refresh_token, expires_at, scope)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [req.query.state || null, me.mail || me.userPrincipalName, tokenData.access_token, tokenData.refresh_token, expiresAt, tokenData.scope]
    );

    res.send(`<html dir="rtl"><body style="font-family:Arial;text-align:center;padding:60px">
      <h2 style="color:#22c87a">تم ربط حساب Microsoft بنجاح ✅</h2>
      <p>${me.mail || me.userPrincipalName}</p>
      <p>تقدر تقفل الصفحة دي وترجع لـ ProjectHub Pro</p>
    </body></html>`);
  } catch (e) {
    res.status(500).send('فشل ربط الحساب: ' + e.message);
  }
});

// DELETE /api/integrations/msgraph/disconnect
router.delete('/disconnect', authMiddleware, requireRole('admin', 'pm'), async (req, res) => {
  await pool.query('DELETE FROM ms_graph_accounts');
  res.json({ success: true });
});

// ── Internal helper: get a valid access token, refreshing if needed ──
async function getValidAccessToken() {
  const { rows } = await pool.query('SELECT * FROM ms_graph_accounts ORDER BY id DESC LIMIT 1');
  if (!rows.length) throw new Error('لا يوجد حساب Microsoft مربوط — اذهب لصفحة الإعدادات واربط الحساب أولاً');
  const acc = rows[0];

  if (new Date(acc.expires_at) > new Date(Date.now() + 60000)) {
    return acc.access_token;
  }

  const tokenRes = await fetch(`${AUTH_BASE}/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: process.env.MS_CLIENT_ID,
      client_secret: process.env.MS_CLIENT_SECRET,
      refresh_token: acc.refresh_token,
      grant_type: 'refresh_token',
      scope: SCOPES,
    }),
  });
  const tokenData = await tokenRes.json();
  if (!tokenRes.ok) throw new Error('فشل تجديد الاتصال — أعد ربط حساب Microsoft من الإعدادات');

  const expiresAt = new Date(Date.now() + tokenData.expires_in * 1000);
  await pool.query('UPDATE ms_graph_accounts SET access_token=$1, refresh_token=$2, expires_at=$3, updated_at=NOW() WHERE id=$4',
    [tokenData.access_token, tokenData.refresh_token || acc.refresh_token, expiresAt, acc.id]);

  return tokenData.access_token;
}

module.exports = { router, getValidAccessToken, configured };
