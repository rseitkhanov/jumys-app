const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

const init = async () => {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      tg_id BIGINT UNIQUE NOT NULL,
      first_name VARCHAR(100),
      role VARCHAR(20) DEFAULT 'seeker',
      city VARCHAR(50),
      created_at TIMESTAMP DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS cities (
      id SERIAL PRIMARY KEY,
      name VARCHAR(50) UNIQUE NOT NULL,
      active BOOLEAN DEFAULT true
    );

    CREATE TABLE IF NOT EXISTS vacancies (
      id SERIAL PRIMARY KEY,
      user_id BIGINT REFERENCES users(tg_id),
      title VARCHAR(100) NOT NULL,
      company VARCHAR(100),
      description TEXT,
      category VARCHAR(50),
      city VARCHAR(50),
      district VARCHAR(50),
      salary VARCHAR(50),
      schedule VARCHAR(50),
      payment_frequency VARCHAR(50),
      employment_type VARCHAR(20),
      food BOOLEAN DEFAULT false,
      transport BOOLEAN DEFAULT false,
      status VARCHAR(20) DEFAULT 'pending',
      is_urgent BOOLEAN DEFAULT false,
      created_at TIMESTAMP DEFAULT NOW(),
      expires_at TIMESTAMP DEFAULT NOW() + INTERVAL '7 days'
    );

    INSERT INTO cities (name) VALUES
      ('Семей'), ('Алматы'), ('Астана'), ('Шымкент')
    ON CONFLICT DO NOTHING;
  `);

  console.log('✅ База данных готова');
};

module.exports = { pool, init };