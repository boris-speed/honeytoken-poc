const express = require('express');
const { Pool } = require('pg');
const bodyParser = require('body-parser');
const path = require('path');

const app = express();
app.use(bodyParser.json());

app.use(express.static(path.join(__dirname, 'public')));

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgres://demo:demopw@localhost:5432/demo'
});

// This essentially allows logs which option is being chosen. 
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

// This is used for the dashboard table. It gives us a list of our alerts. 
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

// Gives us the number, basically telling us which # of attack this is. 
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

// admin, insert, and select code will be below. 

// 
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

// This allows us to simulate the 'select' decoy. 
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

// This allows us to simulate the 'insert' decoy. 
app.post('/simulate/decoy-write', async (req, res) => {
  try {
    const { full_name, ssn_dummy, salary_dummy } = req.body;

    const q = `
      INSERT INTO decoy.sensitive_backup(full_name, ssn_dummy, salary_dummy)
      VALUES($1,$2,$3)
      RETURNING *
    `;
    
    // inserts a fake record
    const result = await pool.query(q, [
      full_name || 'Evil User',
      ssn_dummy || '999-99-9999',
      salary_dummy || 12345
    ]);

    const row = result.rows[0];

    // logs the insert
    await logHoneyEvent({
      actor: req.get('x-actor') || 'evil_actor',
      ip: req.ip,
      resource: 'decoy.sensitive_backup',
      action: 'INSERT',
      details: {
        id: row.id,
        full_name: row.full_name,
        ssn_dummy: row.ssn_dummy,
        salary_dummy: row.salary_dummy
      }
    });

    res.json({ row });

    // simulate decoy UPDATE (change an existing fake row)
app.put('/simulate/decoy-update', async (req, res) => {
  try {
    // pick a row to update (first one)
    const existing = await pool.query(
      'SELECT * FROM decoy.sensitive_backup ORDER BY id LIMIT 1'
    );

    if (existing.rowCount === 0) {
      return res.status(400).json({ error: 'no decoy rows to update' });
    }

    const row = existing.rows[0];
    const newSalary = (row.salary_dummy || 0) + 5000;

    const q = `
      UPDATE decoy.sensitive_backup
      SET salary_dummy = $1
      WHERE id = $2
      RETURNING *
    `;
    const result = await pool.query(q, [newSalary, row.id]);
    const updated = result.rows[0];

    // log UPDATE honey event
    await logHoneyEvent({
      actor: req.get('x-actor') || 'evil_actor',
      ip: req.ip,
      resource: 'decoy.sensitive_backup',
      action: 'UPDATE',
      details: {
        id: row.id,
        old_salary: row.salary_dummy,
        new_salary: updated.salary_dummy
      }
    });

    res.json({ row: updated });

  } catch (err) {
    console.error('decoy-update error', err);
    res.status(500).send('error');
  }
});

// simulate decoy DELETE (remove a fake row)
app.delete('/simulate/decoy-delete', async (req, res) => {
  try {
    // pick a row to delete (latest)
    const existing = await pool.query(
      'SELECT * FROM decoy.sensitive_backup ORDER BY id DESC LIMIT 1'
    );

    if (existing.rowCount === 0) {
      return res.status(400).json({ error: 'no decoy rows to delete' });
    }

    const row = existing.rows[0];

    await pool.query(
      'DELETE FROM decoy.sensitive_backup WHERE id = $1',
      [row.id]
    );

    // log DELETE honey event
    await logHoneyEvent({
      actor: req.get('x-actor') || 'evil_actor',
      ip: req.ip,
      resource: 'decoy.sensitive_backup',
      action: 'DELETE',
      details: {
        id: row.id,
        full_name: row.full_name,
        ssn_dummy: row.ssn_dummy,
        salary_dummy: row.salary_dummy
      }
    });

    res.json({ deletedId: row.id });

  } catch (err) {
    console.error('decoy-delete error', err);
    res.status(500).send('error');
  }
});


  } catch (err) {
    console.error('decoy-write error', err);
    res.status(500).send('error');
  }
});


// This allows our dashboard to function as it should!
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`App listening on ${port}`));
