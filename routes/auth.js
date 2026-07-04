const router = require('express').Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { pool } = require('../db');
const { authMiddleware } = require('../middleware/auth');

// POST /api/auth/login
router.post('/login', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password)
    return res.status(400).json({ error: 'اسم المستخدم وكلمة المرور مطلوبان' });
  try {
    const { rows } = await pool.query(
      'SELECT * FROM users WHERE username=$1 AND is_active=true', [username.trim()]
    );
    if (!rows.length) return res.status(401).json({ error: 'اسم المستخدم أو كلمة المرور غلط' });
    const user = rows[0];
    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) return res.status(401).json({ error: 'اسم المستخدم أو كلمة المرور غلط' });

    await pool.query('UPDATE users SET last_login=NOW() WHERE id=$1', [user.id]);

    // Log activity
    await pool.query(
      'INSERT INTO activity_log (type,message,icon,color,user_id,user_name) VALUES ($1,$2,$3,$4,$5,$6)',
      ['auth', `تسجيل دخول: ${user.full_name}`, 'ti-login', '#22c87a', user.id, user.full_name]
    );

    const token = jwt.sign(
      { id: user.id, username: user.username, name: user.full_name, role: user.role, color: user.color },
      process.env.JWT_SECRET,
      { expiresIn: '8h' }
    );
    res.json({ token, user: { id: user.id, username: user.username, name: user.full_name, role: user.role, color: user.color } });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'خطأ في الخادم' });
  }
});

// GET /api/auth/me
router.get('/me', authMiddleware, async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT id,username,full_name,role,color,last_login FROM users WHERE id=$1', [req.user.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'المستخدم غير موجود' });
    res.json(rows[0]);
  } catch (e) {
    res.status(500).json({ error: 'خطأ في الخادم' });
  }
});

// GET /api/auth/users  (admin only)
router.get('/users', authMiddleware, async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'غير مصرح' });
  const { rows } = await pool.query(
    'SELECT id,username,full_name,role,color,is_active,last_login,created_at FROM users ORDER BY created_at'
  );
  res.json(rows);
});

// POST /api/auth/users  (admin only)
router.post('/users', authMiddleware, async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'غير مصرح' });
  const { username, password, full_name, role, color } = req.body;
  if (!username || !password || !full_name) return res.status(400).json({ error: 'بيانات ناقصة' });
  try {
    const hash = await bcrypt.hash(password, 10);
    const { rows } = await pool.query(
      'INSERT INTO users (username,password_hash,full_name,role,color) VALUES ($1,$2,$3,$4,$5) RETURNING id,username,full_name,role,color',
      [username, hash, full_name, role || 'engineer', color || '#4f8ef7']
    );
    await pool.query(
      'INSERT INTO activity_log (type,message,icon,color,user_id,user_name) VALUES ($1,$2,$3,$4,$5,$6)',
      ['user', `إضافة مستخدم: ${username}`, 'ti-user-plus', '#22c87a', req.user.id, req.user.name]
    );
    res.status(201).json(rows[0]);
  } catch (e) {
    if (e.code === '23505') return res.status(409).json({ error: 'اسم المستخدم موجود مسبقاً' });
    res.status(500).json({ error: 'خطأ في الخادم' });
  }
});

// PUT /api/auth/users/:id  (admin or self)
router.put('/users/:id', authMiddleware, async (req, res) => {
  const targetId = parseInt(req.params.id);
  if (req.user.role !== 'admin' && req.user.id !== targetId)
    return res.status(403).json({ error: 'غير مصرح' });
  const { full_name, role, color, password, is_active } = req.body;
  try {
    if (password) {
      const hash = await bcrypt.hash(password, 10);
      await pool.query('UPDATE users SET password_hash=$1 WHERE id=$2', [hash, targetId]);
    }
    const { rows } = await pool.query(
      `UPDATE users SET
        full_name=COALESCE($1,full_name),
        role=COALESCE($2,role),
        color=COALESCE($3,color),
        is_active=COALESCE($4,is_active)
       WHERE id=$5 RETURNING id,username,full_name,role,color,is_active`,
      [full_name, role, color, is_active, targetId]
    );
    res.json(rows[0]);
  } catch (e) {
    res.status(500).json({ error: 'خطأ في الخادم' });
  }
});

// DELETE /api/auth/users/:id  (admin only)
router.delete('/users/:id', authMiddleware, async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'غير مصرح' });
  if (parseInt(req.params.id) === req.user.id)
    return res.status(400).json({ error: 'لا يمكنك حذف حسابك الحالي' });
  await pool.query('UPDATE users SET is_active=false WHERE id=$1', [req.params.id]);
  res.json({ success: true });
});

module.exports = router;
