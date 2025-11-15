const express = require('express');
const { Pool } = require('pg');
const bodyParser = require('body-parser');
const path = require('path');

const app = express();
app.use(bodyParser.json());

// static files (dashboard)
app.use(express.static(path.join(__dirname, 'public')));

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgres://demo:demopw@localhost:5432/demo'
});

// helper to insert honey events
async function logHoneyEvent({ actor, ip, resource, action, details }) {
  const q = `
    INSERT INTO security.honey_alerts(actor, client_ip, resource, action, details)
    VALUES ($1,$2,$3,$4,$5)
  `;
  const vals = [
    actor || 'unknown',
    ip || 'unknown',
    resource || 'unknown',
    action || 'unknown',
    details ? JSON.stringify(details) : null
  ];
  await pool.query(q, vals);
}

// ---------- API ENDPOINTS ----------

// 1) JSON: list of alerts (for dashboard table)
app.get('/api/alerts', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT alert_id, actor, client_ip, resource, action, event_ts
       FROM security.honey_alerts
       ORDER BY alert_id DESC
       LIMIT 200`
    );
    res.json(rows);
  } catch (err) {
    console.error('api/alerts error', err);
    res.status(500).json({ error: 'failed to load alerts' });
  }
});

// 2) JSON: metrics (total count + counts per actor)
app.get('/api/metrics', async (req, res) => {
  try {
    const totalResult = await pool.query(
      'SELECT COUNT(*) AS total FROM security.honey_alerts'
    );
    const perActor = await pool.query(
      `SELECT actor, COUNT(*) AS count
       FROM security.honey_alerts
       GROUP BY actor
       ORDER BY count DESC`
    );
    res.json({
      total: Number(totalResult.rows[0].total),
      byActor: perActor.rows
    });
  } catch (err) {
    console.error('api/metrics error', err);
    res.status(500).json({ error: 'failed to load metrics' });
  }
});

// ---------- HONEYTOKEN ENDPOINTS (same as before) ----------

// hidden endpoint (never used by legit users)
app.get('/admin/maintenance/export_all', async (req, res) => {
  try {
    await logHoneyEvent({
      actor: req.get('x-actor') || 'unknown',
      ip: req.ip,
      resource: '/admin/maintenance/export_all',
      action: 'HTTP_GET',
      details: { headers: req.headers }
    });
  } catch (e) {
    console.error('logHoneyEvent error', e);
  }
  res.status(404).send('Not found');
});

// simulate decoy SELECT via app
app.get('/simulate/decoy-read', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM decoy.sensitive_backup ORDER BY id'
    );
    await logHoneyEvent({
      actor: req.get('x-actor') || 'curious_attacker',
      ip: req.ip,
      resource: 'decoy.sensitive_backup',
      action: 'SELECT',
      details: { row_count: result.rowCount }
    });
    res.json({ rows: result.rows });
  } catch (err) {
    console.error(err);
    res.status(500).send('error');
  }
});

// simulate decoy INSERT (DB trigger will also log)
app.post('/simulate/decoy-write', async (req, res) => {
  try {
    const { full_name, ssn_dummy, salary_dummy } = req.body;
    const q = `
      INSERT INTO decoy.sensitive_backup(full_name, ssn_dummy, salary_dummy)
      VALUES($1,$2,$3)
      RETURNING *
    `;
    const r = await pool.query(q, [
      full_name || 'Evil User',
      ssn_dummy || '999-99-9999',
      salary_dummy || 12345
    ]);
    res.json({ row: r.rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).send('error');
  }
});

// ---------- ROUTES FOR BROWSER ----------

// dashboard (root)
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`App listening on ${port}`));
