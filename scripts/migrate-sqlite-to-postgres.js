const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const { Pool } = require('pg');

function loadEnvFile() {
  const envPath = path.join(__dirname, '..', '.env');
  if (!fs.existsSync(envPath)) return;

  const lines = fs.readFileSync(envPath, 'utf8').split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const separator = trimmed.indexOf('=');
    if (separator === -1) continue;
    const key = trimmed.slice(0, separator).trim();
    const value = trimmed.slice(separator + 1).trim();
    if (key && process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

loadEnvFile();

const sqlitePath = process.env.SQLITE_PATH || path.join(__dirname, '..', 'ashford.db');
const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error('Falta DATABASE_URL para importar datos a Neon.');
}

if (!fs.existsSync(sqlitePath)) {
  throw new Error(`No existe la base SQLite en ${sqlitePath}`);
}

const sqlite = new Database(sqlitePath, { readonly: true });
const pool = new Pool({
  connectionString: databaseUrl,
  ssl: /localhost|127\.0\.0\.1/i.test(databaseUrl) ? false : { rejectUnauthorized: false },
});

const TABLES = [
  { name: 'clients', columns: ['id', 'name', 'phone', 'email', 'notes', 'source', 'created_at', 'updated_at'] },
  { name: 'services', columns: ['id', 'name', 'description', 'price', 'duration_minutes', 'active', 'created_at'] },
  { name: 'staff', columns: ['id', 'name', 'role', 'phone', 'email', 'active', 'created_at'] },
  { name: 'business_config', columns: ['key', 'value', 'updated_at'] },
  { name: 'faqs', columns: ['id', 'question', 'answer', 'category', 'active', 'sort_order', 'created_at'] },
  { name: 'appointments', columns: ['id', 'client_id', 'name', 'phone', 'date', 'time', 'service', 'price', 'status', 'channel', 'notes', 'notification_sent', 'confirmation_sent', 'created_at', 'updated_at'] },
  { name: 'change_logs', columns: ['id', 'entity_type', 'entity_id', 'field_changed', 'old_value', 'new_value', 'changed_by', 'created_at'] },
  { name: 'notification_queue', columns: ['id', 'appointment_id', 'type', 'channel', 'recipient', 'payload', 'status', 'attempts', 'last_attempt', 'created_at'] },
];

async function main() {
  const schemaPath = path.join(__dirname, '..', 'db', 'schema.sql');
  const schemaSql = fs.readFileSync(schemaPath, 'utf8');
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    await client.query(schemaSql);

    await client.query(`
      TRUNCATE TABLE
        notification_queue,
        change_logs,
        appointments,
        clients,
        faqs,
        staff,
        services,
        business_config
      CASCADE
    `);

    for (const table of TABLES) {
      const rows = sqlite.prepare(`SELECT ${table.columns.join(', ')} FROM ${table.name}`).all();
      if (rows.length === 0) continue;

      const placeholders = table.columns.map((_, index) => `$${index + 1}`).join(', ');
      const sql = `INSERT INTO ${table.name} (${table.columns.join(', ')}) VALUES (${placeholders})`;

      for (const row of rows) {
        const values = table.columns.map((column) => row[column]);
        await client.query(sql, values);
      }
    }

    await client.query('COMMIT');
    console.log(`Migracion completada desde ${sqlitePath}`);
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
    sqlite.close();
    await pool.end();
  }
}

main().catch((error) => {
  console.error('Error migrando SQLite a Postgres:', error);
  process.exit(1);
});
