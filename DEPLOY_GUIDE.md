# ProjectHub Pro — دليل الـ Deploy على Railway

## الخطوات (15 دقيقة)

### 1. إنشاء حساب على Railway
- اذهب إلى: https://railway.app
- سجّل بـ GitHub account

### 2. رفع الكود على GitHub
```bash
cd projecthub
git init
git add .
git commit -m "Initial ProjectHub Pro"
git branch -M main
git remote add origin https://github.com/YOUR_USER/projecthub-pro.git
git push -u origin main
```

### 3. إنشاء مشروع على Railway
- New Project → Deploy from GitHub repo
- اختر الـ repo اللي رفعته

### 4. إضافة PostgreSQL Database
- في المشروع: + Add → Database → PostgreSQL
- Railway هيضيف DATABASE_URL تلقائياً

### 5. إضافة المتغيرات (Variables)
في Settings → Variables أضف:
```
JWT_SECRET=اكتب_كلمة_سرية_طويلة_هنا_مثلا_atech2025secret
NODE_ENV=production
ANTHROPIC_API_KEY=sk-ant-api03-...  (اختياري للـ AI)
```

### 6. Deploy
- Railway هيعمل deploy تلقائياً
- بعد 2-3 دقايق هيديك رابط زي: https://projecthub-pro.up.railway.app

### 7. دخول أول مرة
```
Username: abdelrahman
Password: admin123
```
**غيّر كلمة المرور فوراً من الإعدادات!**

---

## إضافة أعضاء الفريق
1. دخل بحساب Admin
2. الإعدادات → المستخدمون → إضافة مستخدم
3. حدد الدور (PM / Lead / Engineer / Viewer)
4. شارك الرابط مع الفريق

## الأدوار والصلاحيات
| الدور | الصلاحيات |
|-------|-----------|
| Admin | كل شيء + إدارة المستخدمين |
| PM | مشاريع + مهام + فريق + تقارير |
| Lead | تعديل مهام المشروع + تقارير |
| Engineer | مهامه الشخصية فقط |
| Viewer | عرض فقط — لا تعديل |

## اختصارات لوحة المفاتيح
| مفتاح | الوظيفة |
|-------|---------|
| 1-5 | التنقل بين الصفحات |
| N | مهمة جديدة |
| P | مشروع جديد |
| / | بحث |
| Esc | إغلاق |

## تكلفة Railway
- مجاني: $5 رصيد شهرياً (كافي للبداية)
- بعد ما ينتهي: ~$5-10/شهر للتطبيق + قاعدة البيانات

