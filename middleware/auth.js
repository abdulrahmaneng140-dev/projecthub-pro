const jwt = require('jsonwebtoken');

function authMiddleware(req, res, next) {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'غير مصرح — يجب تسجيل الدخول' });
  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({ error: 'الجلسة انتهت — سجل الدخول مرة أخرى' });
  }
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!roles.includes(req.user?.role) && req.user?.role !== 'admin') {
      return res.status(403).json({ error: 'ليس لديك صلاحية لهذا الإجراء' });
    }
    next();
  };
}

module.exports = { authMiddleware, requireRole };
