# ProjectHub Pro — دليل الـ Deploy (Render + Neon)

بدل Railway (تجربته انتهت)، الإعداد ده بيفصل الـ app عن الـ database — لو احتجت تغيّر منصة الاستضافة تاني المستقبل، بياناتك في Neon متعزولة ومحفوظة.

## 1. قاعدة البيانات — Neon (مجاني، دائم)
- اذهب إلى: https://neon.tech وسجّل بـ GitHub
- New Project → اختر أقرب Region (Frankfurt/AWS eu-central أنسب للسعودية)
- من الـ Dashboard انسخ الـ **Connection String** (Pooled connection) — شكله:
  `postgresql://user:pass@ep-xxx.eu-central-1.aws.neon.tech/dbname?sslmode=require`

> بديل: Supabase (https://supabase.com) — نفس الفكرة، Postgres مجاني دائم.

## 2. رفع الكود على GitHub
```bash
cd projecthub
git init
git add .
git commit -m "Initial ProjectHub Pro"
git branch -M main
git remote add origin https://github.com/YOUR_USER/projecthub-pro.git
git push -u origin main
```

## 3. الاستضافة — Render (مجاني)
- اذهب إلى: https://render.com وسجّل بـ GitHub
- New → Web Service → اختر الـ repo
- Render هيكتشف `render.yaml` تلقائياً ويجهّز الإعدادات

### إضافة المتغيرات (Environment)
في Settings → Environment أضف:
```
DATABASE_URL=<الـ connection string من Neon>
ANTHROPIC_API_KEY=sk-ant-api03-...   (اختياري للـ AI)
ALLOWED_ORIGINS=https://your-app.onrender.com
```
`JWT_SECRET` بيتولّد تلقائياً من `render.yaml` — مش محتاج تكتبه.

### ملاحظة عن الخطة المجانية
الخدمة المجانية في Render بتنام بعد 15 دقيقة عدم استخدام، وتاخد 30-60 ثانية تصحى تاني أول طلب. لو الأداة هتُستخدم يومياً بشكل مستمر (وده متوقع كأداة إدارة مشاريع أساسية)، فكّر لاحقاً في الترقية لخطة Starter المدفوعة ($7/شهر) عشان الاستجابة تكون فورية دايماً.

## 4. دخول أول مرة
```
Username: abdelrahman
Password: admin123
```
**⚠️ غيّر كلمة المرور فوراً من الإعدادات — الباسورد الافتراضي معروف لأي حد شاف الكود.**

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

## التقارير (PDF / Excel)
من صفحة KPI Center: اختر نوع التقرير (تقدم / مالي / مخاطر) واضغط PDF أو Excel للتحميل المباشر.

## التكلفة
- Render (app): مجاني، بيبقى مدفوع ($7/شهر) لو احتجت الخدمة تفضل صاحية دايماً
- Neon (database): مجاني دائم للاستخدام المتوسط (0.5 GB storage)

## التكاملات الخارجية (Outlook / Power Automate / MS Project)

### 1. Outlook + Calendar + OneDrive (عبر Microsoft Graph)
1. اذهب إلى https://portal.azure.com → Azure Active Directory → App registrations → New registration
2. Redirect URI (Web): `https://your-app.onrender.com/api/integrations/msgraph/callback`
3. من API permissions أضف: `Mail.Send`, `Calendars.ReadWrite`, `Files.ReadWrite`, `User.Read`, `offline_access`
4. من Certificates & secrets أنشئ Client Secret جديد
5. انسخ Client ID و Client Secret و Tenant ID في متغيرات البيئة (`MS_CLIENT_ID`, `MS_CLIENT_SECRET`, `MS_TENANT_ID`)
6. من الإعدادات → التكاملات داخل التطبيق، اضغط "ربط الحساب"

### 2. Power Automate
- **Outbound (ProjectHub يبلّغ Power Automate):** من الإعدادات → التكاملات → Webhooks → أضف رابط الـ "When an HTTP request is received" trigger من Power Automate
- **Inbound (Power Automate يتصل بـ ProjectHub):** أنشئ API Key من نفس الصفحة، واستخدمه في Power Automate كـ header `X-API-Key` عند استدعاء `/api/integrations/inbound/tasks` أو `/api/integrations/inbound/projects`

### 3. MS Project
تصدير/استيراد ملفات XML متاح من صفحة Timeline لكل مشروع — مفيش اتصال مباشر live (يحتاج Project Online license مدفوع)، فالطريقة المجانية هي تبادل ملفات XML.
