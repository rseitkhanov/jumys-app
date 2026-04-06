const express = require('express');
const cors = require('cors');
const { pool } = require('../db/index');

const app = express();
app.use(cors());
app.use(express.json());

// Получить все города
app.get('/cities', async (req, res) => {
  try {
    const { rows } = await pool.query(`SELECT * FROM cities WHERE active = true`);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Получить вакансии с фильтрами
app.get('/vacancies', async (req, res) => {
  try {
    const { city, category, limit = 10, offset = 0 } = req.query;
    let query = `SELECT * FROM vacancies WHERE status = 'active'`;
    const params = [];

    if (city) {
      params.push(city);
      query += ` AND city = $${params.length}`;
    }
    if (category) {
      params.push(category);
      query += ` AND category = $${params.length}`;
    }

    query += ` ORDER BY is_urgent DESC, created_at DESC`;
    params.push(limit);
    query += ` LIMIT $${params.length}`;
    params.push(offset);
    query += ` OFFSET $${params.length}`;

    const { rows } = await pool.query(query, params);
    const count = await pool.query(`SELECT COUNT(*) FROM vacancies WHERE status = 'active'`);

    res.json({ vacancies: rows, total: parseInt(count.rows[0].count) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Получить одну вакансию
app.get('/vacancies/:id', async (req, res) => {
  try {
    const { rows } = await pool.query(`SELECT * FROM vacancies WHERE id = $1`, [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ error: 'Не найдено' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Создать вакансию
app.post('/vacancies', async (req, res) => {
  try {
    const { user_id, title, company, category, city, district, salary, schedule, payment_frequency, employment_type, food, transport } = req.body;
    const { rows } = await pool.query(`
      INSERT INTO vacancies 
        (user_id, title, company, category, city, district, salary, schedule, payment_frequency, employment_type, food, transport, status)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'active')
      RETURNING *
    `, [user_id, title, company, category, city, district, salary, schedule, payment_frequency, employment_type, food, transport]);
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = app;