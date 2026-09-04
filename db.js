const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
  connectionTimeoutMillis: 10000,
});

pool.on('error', (err) => console.error('Unexpected DB pool error:', err.message));

// ── INITIALIZE ALL TABLES ──────────────────────────────────────────────────
async function initDB() {
  const client = await pool.connect();
  try {
    await client.query(`
      -- USERS
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        username VARCHAR(50) UNIQUE NOT NULL,
        password_hash VARCHAR(255) NOT NULL,
        full_name VARCHAR(100) NOT NULL,
        role VARCHAR(20) NOT NULL DEFAULT 'engineer'
          CHECK (role IN ('admin','pm','lead','engineer','viewer')),
        color VARCHAR(7) DEFAULT '#4f8ef7',
        is_active BOOLEAN DEFAULT true,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        last_login TIMESTAMPTZ
      );

      -- PROJECTS
      CREATE TABLE IF NOT EXISTS projects (
        id VARCHAR(20) PRIMARY KEY,
        name VARCHAR(200) NOT NULL,
        color VARCHAR(7) DEFAULT '#4f8ef7',
        pct INTEGER DEFAULT 0 CHECK (pct BETWEEN 0 AND 100),
        status VARCHAR(20) DEFAULT 'on-track'
          CHECK (status IN ('on-track','at-risk','delayed','done')),
        budget BIGINT DEFAULT 0,
        spent BIGINT DEFAULT 0,
        lead VARCHAR(100),
        start_date DATE,
        end_date DATE,
        description TEXT,
        created_by INTEGER REFERENCES users(id),
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );

      -- TASKS
      CREATE TABLE IF NOT EXISTS tasks (
        id SERIAL PRIMARY KEY,
        title VARCHAR(300) NOT NULL,
        project_id VARCHAR(20) REFERENCES projects(id) ON DELETE CASCADE,
        priority VARCHAR(10) DEFAULT 'med'
          CHECK (priority IN ('high','med','low')),
        col VARCHAR(20) DEFAULT 'todo'
          CHECK (col IN ('backlog','todo','doing','review','done')),
        assigned_to VARCHAR(100),
        start_date DATE,
        due_date DATE,
        duration_days INTEGER DEFAULT 1,
        hours_estimated INTEGER DEFAULT 0,
        notes TEXT,
        created_by INTEGER REFERENCES users(id),
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );
      -- existing installs: add CPM columns if the table predates this feature
      ALTER TABLE tasks ADD COLUMN IF NOT EXISTS start_date DATE;
      ALTER TABLE tasks ADD COLUMN IF NOT EXISTS duration_days INTEGER DEFAULT 1;

      -- TASK DEPENDENCIES — for Critical Path Method (CPM) scheduling
      CREATE TABLE IF NOT EXISTS task_dependencies (
        id SERIAL PRIMARY KEY,
        predecessor_id INTEGER REFERENCES tasks(id) ON DELETE CASCADE,
        successor_id INTEGER REFERENCES tasks(id) ON DELETE CASCADE,
        type VARCHAR(2) DEFAULT 'FS' CHECK (type IN ('FS','SS','FF','SF')),
        lag_days INTEGER DEFAULT 0,
        created_by INTEGER REFERENCES users(id),
        created_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(predecessor_id, successor_id)
      );

      -- TEAM MEMBERS
      CREATE TABLE IF NOT EXISTS team_members (
        id SERIAL PRIMARY KEY,
        name VARCHAR(100) NOT NULL,
        role VARCHAR(150),
        email VARCHAR(200),
        is_online BOOLEAN DEFAULT false,
        color VARCHAR(7) DEFAULT '#4f8ef7',
        user_id INTEGER REFERENCES users(id),
        created_at TIMESTAMPTZ DEFAULT NOW()
      );

      -- MILESTONES
      CREATE TABLE IF NOT EXISTS milestones (
        id SERIAL PRIMARY KEY,
        title VARCHAR(200) NOT NULL,
        project_id VARCHAR(20) REFERENCES projects(id) ON DELETE CASCADE,
        type VARCHAR(20) DEFAULT 'milestone'
          CHECK (type IN ('milestone','phase','delivery','review')),
        start_date DATE,
        end_date DATE,
        status VARCHAR(20) DEFAULT 'upcoming'
          CHECK (status IN ('upcoming','in-progress','done','delayed')),
        pct INTEGER DEFAULT 0,
        notes TEXT,
        created_by INTEGER REFERENCES users(id),
        created_at TIMESTAMPTZ DEFAULT NOW()
      );

      -- SITE REPORTS
      CREATE TABLE IF NOT EXISTS site_reports (
        id SERIAL PRIMARY KEY,
        report_date DATE NOT NULL,
        project_id VARCHAR(20) REFERENCES projects(id),
        supervisor VARCHAR(100),
        weather VARCHAR(50),
        temperature VARCHAR(20),
        workforce INTEGER DEFAULT 0,
        safety_incidents INTEGER DEFAULT 0,
        progress_pct INTEGER DEFAULT 0,
        completed_tasks JSONB DEFAULT '[]',
        pending_tasks JSONB DEFAULT '[]',
        issues JSONB DEFAULT '[]',
        notes TEXT,
        created_by INTEGER REFERENCES users(id),
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(report_date, project_id)
      );

      -- ACTIVITY LOG
      CREATE TABLE IF NOT EXISTS activity_log (
        id SERIAL PRIMARY KEY,
        type VARCHAR(30),
        message TEXT,
        icon VARCHAR(50),
        color VARCHAR(7),
        user_id INTEGER REFERENCES users(id),
        user_name VARCHAR(100),
        created_at TIMESTAMPTZ DEFAULT NOW()
      );

      -- ALERT RULES (KPI alert engine configuration)
      CREATE TABLE IF NOT EXISTS alert_rules (
        id SERIAL PRIMARY KEY,
        name VARCHAR(200) NOT NULL,
        type VARCHAR(50),
        condition VARCHAR(50),
        threshold NUMERIC,
        enabled BOOLEAN DEFAULT true,
        notify_email BOOLEAN DEFAULT false,
        email_to TEXT,
        created_by INTEGER REFERENCES users(id),
        created_at TIMESTAMPTZ DEFAULT NOW()
      );

      -- NOTIFICATIONS (KPI alerts, document alerts, etc.)
      CREATE TABLE IF NOT EXISTS notifications (
        id SERIAL PRIMARY KEY,
        type VARCHAR(30),
        level VARCHAR(20) DEFAULT 'info',
        message TEXT,
        project_id VARCHAR(20),
        icon VARCHAR(50),
        color VARCHAR(7),
        is_read BOOLEAN DEFAULT false,
        user_id INTEGER REFERENCES users(id),
        created_at TIMESTAMPTZ DEFAULT NOW()
      );

      -- INTEGRATIONS: Microsoft Graph account (Outlook/Calendar/OneDrive)
      CREATE TABLE IF NOT EXISTS ms_graph_accounts (
        id SERIAL PRIMARY KEY,
        connected_by INTEGER REFERENCES users(id),
        account_email VARCHAR(200),
        access_token TEXT NOT NULL,
        refresh_token TEXT NOT NULL,
        expires_at TIMESTAMPTZ NOT NULL,
        scope TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );

      -- INTEGRATIONS: outbound webhooks (for Power Automate / Zapier / etc.)
      CREATE TABLE IF NOT EXISTS webhook_subscriptions (
        id SERIAL PRIMARY KEY,
        name VARCHAR(100) NOT NULL,
        target_url TEXT NOT NULL,
        events TEXT[] NOT NULL DEFAULT '{}',
        enabled BOOLEAN DEFAULT true,
        secret VARCHAR(64),
        created_by INTEGER REFERENCES users(id),
        created_at TIMESTAMPTZ DEFAULT NOW(),
        last_triggered_at TIMESTAMPTZ,
        last_status INTEGER
      );

      -- INTEGRATIONS: API keys for inbound calls (Power Automate HTTP actions)
      CREATE TABLE IF NOT EXISTS api_keys (
        id SERIAL PRIMARY KEY,
        name VARCHAR(100) NOT NULL,
        key_hash VARCHAR(255) NOT NULL,
        key_prefix VARCHAR(12) NOT NULL,
        created_by INTEGER REFERENCES users(id),
        created_at TIMESTAMPTZ DEFAULT NOW(),
        last_used_at TIMESTAMPTZ,
        revoked BOOLEAN DEFAULT false
      );

      -- DOCUMENT TRACKING — required project documents (GMP protocols, drawings, etc.)
      CREATE TABLE IF NOT EXISTS project_documents (
        id SERIAL PRIMARY KEY,
        project_id VARCHAR(20) REFERENCES projects(id) ON DELETE CASCADE,
        name VARCHAR(200) NOT NULL,
        category VARCHAR(50) DEFAULT 'general',
        status VARCHAR(20) DEFAULT 'missing'
          CHECK (status IN ('missing','uploaded','under_review','approved')),
        file_url TEXT,
        due_date DATE,
        notes TEXT,
        uploaded_by INTEGER REFERENCES users(id),
        uploaded_at TIMESTAMPTZ,
        created_by INTEGER REFERENCES users(id),
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );

      -- PROJECT DEPENDENCIES — cross-project links (e.g. GPI waiting on a BMS deliverable)
      CREATE TABLE IF NOT EXISTS project_dependencies (
        id SERIAL PRIMARY KEY,
        from_project VARCHAR(20) REFERENCES projects(id) ON DELETE CASCADE,
        to_project VARCHAR(20) REFERENCES projects(id) ON DELETE CASCADE,
        type VARCHAR(20) DEFAULT 'blocks'
          CHECK (type IN ('blocks','depends_on','related')),
        description TEXT,
        created_by INTEGER REFERENCES users(id),
        created_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(from_project, to_project, type)
      );

      -- PROJECT TEMPLATES — reusable starting points for new projects
      CREATE TABLE IF NOT EXISTS project_templates (
        id SERIAL PRIMARY KEY,
        name VARCHAR(150) NOT NULL,
        description TEXT,
        default_tasks JSONB DEFAULT '[]',
        default_milestones JSONB DEFAULT '[]',
        document_template_key VARCHAR(50),
        created_by INTEGER REFERENCES users(id),
        created_at TIMESTAMPTZ DEFAULT NOW()
      );

      -- COMMISSIONING MATRIX — detailed panel/loop checklist across
      -- Communication/Programming/Commissioning/Validation/Handover stages
      CREATE TABLE IF NOT EXISTS commissioning_items (
        id SERIAL PRIMARY KEY,
        project_id VARCHAR(20) REFERENCES projects(id) ON DELETE CASCADE,
        item_no INTEGER,
        panel_name VARCHAR(200) NOT NULL,
        serving_equipment VARCHAR(200),
        stages JSONB DEFAULT '{}',
        notes TEXT,
        created_by INTEGER REFERENCES users(id),
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );

      -- ISSUES LOG — site/commissioning issues tracking
      CREATE TABLE IF NOT EXISTS project_issues (
        id SERIAL PRIMARY KEY,
        project_id VARCHAR(20) REFERENCES projects(id) ON DELETE CASCADE,
        sn INTEGER,
        phase VARCHAR(100),
        system_name VARCHAR(150),
        issue TEXT NOT NULL,
        reasons TEXT,
        responsible VARCHAR(150),
        corrective_action TEXT,
        status VARCHAR(50) DEFAULT 'Open',
        open_date DATE,
        closed_date DATE,
        remark TEXT,
        created_by INTEGER REFERENCES users(id),
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );

      -- RISK REGISTER — formal probability x impact risk tracking (distinct from Issues Log, which tracks things that already happened)
      CREATE TABLE IF NOT EXISTS risk_register (
        id SERIAL PRIMARY KEY,
        project_id VARCHAR(20) REFERENCES projects(id) ON DELETE CASCADE,
        rn INTEGER,
        description TEXT NOT NULL,
        category VARCHAR(50) DEFAULT 'technical'
          CHECK (category IN ('technical','schedule','cost','quality','safety','external')),
        probability INTEGER DEFAULT 3 CHECK (probability BETWEEN 1 AND 5),
        impact INTEGER DEFAULT 3 CHECK (impact BETWEEN 1 AND 5),
        owner VARCHAR(150),
        mitigation_plan TEXT,
        contingency_plan TEXT,
        status VARCHAR(20) DEFAULT 'open'
          CHECK (status IN ('open','mitigated','closed','occurred')),
        identified_date DATE DEFAULT CURRENT_DATE,
        review_date DATE,
        created_by INTEGER REFERENCES users(id),
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );

      -- CHANGE ORDERS — formal scope/cost/schedule variation tracking with approval workflow
      CREATE TABLE IF NOT EXISTS change_orders (
        id SERIAL PRIMARY KEY,
        project_id VARCHAR(20) REFERENCES projects(id) ON DELETE CASCADE,
        co_number VARCHAR(30),
        title VARCHAR(300) NOT NULL,
        description TEXT,
        reason TEXT,
        requested_by VARCHAR(150),
        cost_impact NUMERIC DEFAULT 0,
        schedule_impact_days INTEGER DEFAULT 0,
        status VARCHAR(20) DEFAULT 'proposed'
          CHECK (status IN ('proposed','under_review','approved','rejected','implemented')),
        approved_by VARCHAR(150),
        approval_date DATE,
        created_by INTEGER REFERENCES users(id),
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );

      -- INDEXES
      CREATE INDEX IF NOT EXISTS idx_risks_project ON risk_register(project_id);
      CREATE INDEX IF NOT EXISTS idx_co_project ON change_orders(project_id);
      CREATE INDEX IF NOT EXISTS idx_issues_project ON project_issues(project_id);
      CREATE INDEX IF NOT EXISTS idx_commissioning_project ON commissioning_items(project_id);
      CREATE INDEX IF NOT EXISTS idx_documents_project ON project_documents(project_id);
      CREATE INDEX IF NOT EXISTS idx_documents_status ON project_documents(status);
      CREATE INDEX IF NOT EXISTS idx_deps_from ON project_dependencies(from_project);
      CREATE INDEX IF NOT EXISTS idx_deps_to ON project_dependencies(to_project);
      CREATE INDEX IF NOT EXISTS idx_tasks_project ON tasks(project_id);
      CREATE INDEX IF NOT EXISTS idx_taskdeps_pred ON task_dependencies(predecessor_id);
      CREATE INDEX IF NOT EXISTS idx_taskdeps_succ ON task_dependencies(successor_id);
      CREATE INDEX IF NOT EXISTS idx_tasks_col ON tasks(col);
      CREATE INDEX IF NOT EXISTS idx_milestones_project ON milestones(project_id);
      CREATE INDEX IF NOT EXISTS idx_reports_date ON site_reports(report_date);
      CREATE INDEX IF NOT EXISTS idx_log_created ON activity_log(created_at DESC);
    `);

    // Seed default admin if no users exist
    const { rows } = await client.query('SELECT COUNT(*) FROM users');
    if (parseInt(rows[0].count) === 0) {
      const bcrypt = require('bcryptjs');
      const hash = await bcrypt.hash('admin123', 10);
      await client.query(`
        INSERT INTO users (username, password_hash, full_name, role, color)
        VALUES ('abdelrahman', $1, 'عبدالرحمن', 'admin', '#4f8ef7')
      `, [hash]);

      // Seed sample projects
      await client.query(`
        INSERT INTO projects (id, name, color, pct, status, budget, spent, lead, start_date, end_date)
        VALUES
          ('SVAX','SVAX – SaudiVAX','#4f8ef7',65,'on-track',350000,210000,'عبدالرحمن','2025-02-01','2025-07-31'),
          ('GPI','GPI – EMS System','#22c87a',40,'on-track',200000,75000,'أحمد','2025-01-15','2025-09-30'),
          ('BMS','BMS Bridge v3','#f0a030',80,'at-risk',120000,98000,'عبدالرحمن','2025-01-01','2025-04-30'),
          ('ATECH','ATECH Admin','#9b72f4',30,'delayed',80000,28000,'سارة','2025-03-01','2025-07-30'),
          ('GMP','توثيق GMP','#f472b6',55,'on-track',100000,52000,'محمد','2025-04-01','2025-09-30')
        ON CONFLICT (id) DO NOTHING
      `);

      console.log('✅ Database seeded with default admin and sample data');
    }

    console.log('✅ Database initialized successfully');
  } finally {
    client.release();
  }
}

module.exports = { pool, initDB };
