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
        due_date DATE,
        hours_estimated INTEGER DEFAULT 0,
        notes TEXT,
        created_by INTEGER REFERENCES users(id),
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
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

      -- INDEXES
      CREATE INDEX IF NOT EXISTS idx_tasks_project ON tasks(project_id);
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
