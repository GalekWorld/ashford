const express = require('express');
const cors = require('cors');
const Database = require('better-sqlite3');
const path = require('path');
const crypto = require('crypto');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3001;
const db = new Database('./ashford.db');

function loadEnvFile() {
  const envPath = path.join(__dirname, '.env');
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

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.get('/', (_req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});
app.get('/admin', (_req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

db.exec(`
  PRAGMA journal_mode=WAL;

  CREATE TABLE IF NOT EXISTS clients (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    phone TEXT NOT NULL,
    email TEXT,
    notes TEXT,
    source TEXT DEFAULT 'web',
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS appointments (
    id TEXT PRIMARY KEY,
    client_id TEXT,
    name TEXT NOT NULL,
    phone TEXT NOT NULL,
    date TEXT NOT NULL,
    time TEXT NOT NULL,
    service TEXT NOT NULL,
    price REAL DEFAULT 0,
    status TEXT DEFAULT 'new',
    channel TEXT DEFAULT 'web',
    notes TEXT,
    notification_sent INTEGER DEFAULT 0,
    confirmation_sent INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (client_id) REFERENCES clients(id)
  );

  CREATE TABLE IF NOT EXISTS services (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    price REAL NOT NULL,
    duration_minutes INTEGER DEFAULT 30,
    active INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS staff (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    role TEXT DEFAULT 'barber',
    phone TEXT,
    email TEXT,
    active INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS business_config (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS faqs (
    id TEXT PRIMARY KEY,
    question TEXT NOT NULL,
    answer TEXT NOT NULL,
    category TEXT DEFAULT 'general',
    active INTEGER DEFAULT 1,
    sort_order INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS change_logs (
    id TEXT PRIMARY KEY,
    entity_type TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    field_changed TEXT,
    old_value TEXT,
    new_value TEXT,
    changed_by TEXT DEFAULT 'system',
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS notification_queue (
    id TEXT PRIMARY KEY,
    appointment_id TEXT NOT NULL,
    type TEXT NOT NULL,
    channel TEXT NOT NULL,
    recipient TEXT NOT NULL,
    payload TEXT,
    status TEXT DEFAULT 'pending',
    attempts INTEGER DEFAULT 0,
    last_attempt TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (appointment_id) REFERENCES appointments(id)
  );
`);

function uid() {
  return 'ap_' + crypto.randomBytes(8).toString('hex');
}

function seedData() {
  const serviceCount = db.prepare('SELECT COUNT(*) AS n FROM services').get().n;
  if (serviceCount === 0) {
    const insertService = db.prepare('INSERT INTO services (id, name, description, price, duration_minutes) VALUES (?, ?, ?, ?, ?)');
    [
      [uid(), 'Corte Clasico', 'Corte tradicional con tijera y maquina', 18, 40],
      [uid(), 'Afeitado a Navaja', 'Afeitado clasico con navaja recta', 22, 35],
      [uid(), 'Corte + Afeitado', 'Combinacion completa de corte y afeitado', 35, 70],
      [uid(), 'Arreglo de Barba', 'Perfilado y arreglo de barba', 14, 25],
      [uid(), 'Fade & Degradado', 'Tecnica moderna de degradado', 22, 45],
      [uid(), 'Tratamiento Cuero', 'Tratamiento capilar y cuero cabelludo', 28, 55],
      [uid(), 'Pack Premium', 'Corte + afeitado + tratamiento capilar', 55, 90],
    ].forEach((row) => insertService.run(...row));
  }

  const insertConfig = db.prepare('INSERT OR IGNORE INTO business_config (key, value) VALUES (?, ?)');
  [
    ['business_name', 'Ashford Barberia'],
    ['business_address', 'Calle Mayor 42, 28001 Madrid'],
    ['business_phone', '+34 911 234 567'],
    ['business_email', 'info@ashford.es'],
    ['business_whatsapp', '+34 600 123 456'],
    ['opening_hours_weekday', '09:00-20:00'],
    ['opening_hours_saturday', '09:00-15:00'],
    ['opening_hours_sunday', 'closed'],
    ['lunch_break', '13:30-16:00'],
    ['slot_duration_minutes', '30'],
    ['n8n_webhook_url', ''],
    ['whatsapp_api_key', ''],
    ['email_smtp_host', ''],
    ['email_smtp_user', ''],
    ['email_smtp_pass', ''],
  ].forEach((row) => insertConfig.run(...row));

  const faqCount = db.prepare('SELECT COUNT(*) AS n FROM faqs').get().n;
  if (faqCount === 0) {
    const insertFaq = db.prepare('INSERT INTO faqs (id, question, answer, category, sort_order) VALUES (?, ?, ?, ?, ?)');
    [
      [uid(), 'Necesito reservar con antelacion?', 'Recomendamos reservar con al menos 24 horas para garantizar disponibilidad.', 'general', 1],
      [uid(), 'Aceptais walk-ins?', 'Si, si hay disponibilidad. Siempre es preferible reservar con antelacion.', 'general', 2],
      [uid(), 'Cuanto dura un corte clasico?', 'Entre 30 y 45 minutos, dependiendo del tipo de cabello.', 'servicios', 3],
      [uid(), 'Como puedo cancelar mi cita?', 'Llamenos al +34 911 234 567 con al menos 2 horas de antelacion.', 'citas', 4],
      [uid(), 'Cuales son vuestros horarios?', 'Lunes a viernes de 09:00 a 20:00, sabados de 09:00 a 15:00.', 'general', 5],
    ].forEach((row) => insertFaq.run(...row));
  }

  const staffCount = db.prepare('SELECT COUNT(*) AS n FROM staff').get().n;
  if (staffCount === 0) {
    const insertStaff = db.prepare('INSERT INTO staff (id, name, role, phone, email) VALUES (?, ?, ?, ?, ?)');
    [
      [uid(), 'Carlos Ashford', 'owner', '+34 600 111 222', 'carlos@ashford.es'],
      [uid(), 'Marco Ruiz', 'barber', '+34 600 333 444', 'marco@ashford.es'],
      [uid(), 'Luis Perez', 'barber', '+34 600 555 666', 'luis@ashford.es'],
    ].forEach((row) => insertStaff.run(...row));
  }
}

seedData();

function logChange(entityType, entityId, field, oldValue, newValue, by = 'system') {
  db.prepare(`
    INSERT INTO change_logs (id, entity_type, entity_id, field_changed, old_value, new_value, changed_by)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(uid(), entityType, entityId, field, String(oldValue ?? ''), String(newValue ?? ''), by);
}

function queueNotification(appointmentId, type, channel, recipient, payload) {
  db.prepare(`
    INSERT INTO notification_queue (id, appointment_id, type, channel, recipient, payload)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(uid(), appointmentId, type, channel, recipient, JSON.stringify(payload));
  NotificationService.dispatch({ appointmentId, type, channel, recipient, payload });
}

function normalizePhoneNumber(phone) {
  return String(phone || '').replace(/\D/g, '');
}

function getBusinessNotificationPhone(config = getConfigMap()) {
  return normalizePhoneNumber(process.env.WHATSAPP_NOTIFY_TO || config.business_whatsapp || '');
}

const NotificationService = {
  async dispatch({ appointmentId, type, channel, recipient, payload }) {
    try {
      switch (channel) {
        case 'whatsapp':
          await this.sendWhatsApp(recipient, payload);
          break;
        case 'email':
          console.log(`[notify:email] ${type}`, payload);
          break;
        case 'n8n':
          console.log(`[notify:n8n] ${type}`, payload);
          break;
        default:
          console.log(`[notify:${channel}] ${type}`, payload);
      }
      db.prepare("UPDATE notification_queue SET status='sent', last_attempt=datetime('now') WHERE appointment_id=? AND type=? AND channel=?")
        .run(appointmentId, type, channel);
    } catch (error) {
      console.error(`[notify:${channel}] failed`, error.message);
      db.prepare("UPDATE notification_queue SET status='failed', attempts=attempts+1, last_attempt=datetime('now') WHERE appointment_id=? AND type=? AND channel=?")
        .run(appointmentId, type, channel);
    }
  },

  async sendWhatsApp(recipient, payload) {
    const accessToken = process.env.WHATSAPP_ACCESS_TOKEN;
    const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
    const to = normalizePhoneNumber(recipient);

    if (!accessToken || !phoneNumberId) {
      throw new Error('WhatsApp Cloud API no configurada');
    }
    if (!to) {
      throw new Error('Destinatario de WhatsApp no valido');
    }

    const response = await fetch(`https://graph.facebook.com/v22.0/${phoneNumberId}/messages`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to,
        type: 'text',
        text: {
          body: payload.message || payload.subject || 'Nueva notificacion de Ashford',
        },
      }),
    });

    if (!response.ok) {
      const details = await response.text();
      throw new Error(`WhatsApp API error ${response.status}: ${details}`);
    }

    return response.json();
  },
};

function getConfigMap() {
  return Object.fromEntries(
    db.prepare('SELECT key, value FROM business_config').all().map(({ key, value }) => [key, value])
  );
}

function getServiceRecord(input) {
  if (!input) return null;
  return db.prepare('SELECT * FROM services WHERE id = ? OR name = ? LIMIT 1').get(input, input) || null;
}

function toMinutes(time) {
  const [hours, minutes] = String(time || '').split(':').map(Number);
  if (Number.isNaN(hours) || Number.isNaN(minutes)) return null;
  return hours * 60 + minutes;
}

function toTimeString(totalMinutes) {
  const hours = String(Math.floor(totalMinutes / 60)).padStart(2, '0');
  const minutes = String(totalMinutes % 60).padStart(2, '0');
  return `${hours}:${minutes}`;
}

function parseTimeRange(value) {
  if (!value || String(value).trim() === '' || String(value).toLowerCase() === 'closed') return null;
  const match = String(value).match(/^(\d{2}:\d{2})-(\d{2}:\d{2})$/);
  if (!match) return null;
  const start = toMinutes(match[1]);
  const end = toMinutes(match[2]);
  if (start === null || end === null || end <= start) return null;
  return { start, end };
}

function getOpeningRangeForDate(date, config) {
  const day = new Date(`${date}T12:00:00`).getDay();
  if (day === 0) return parseTimeRange(config.opening_hours_sunday);
  if (day === 6) return parseTimeRange(config.opening_hours_saturday);
  return parseTimeRange(config.opening_hours_weekday);
}

function getActiveWindows(date, config) {
  const opening = getOpeningRangeForDate(date, config);
  if (!opening) return [];

  const lunch = parseTimeRange(config.lunch_break);
  if (!lunch) return [opening];

  const windows = [];
  if (lunch.start > opening.start) {
    windows.push({ start: opening.start, end: Math.min(lunch.start, opening.end) });
  }
  if (lunch.end < opening.end) {
    windows.push({ start: Math.max(lunch.end, opening.start), end: opening.end });
  }
  return windows.filter((window) => window.end > window.start);
}

function getAppointmentDuration(serviceName, config = getConfigMap()) {
  const row = db.prepare('SELECT duration_minutes FROM services WHERE name = ? LIMIT 1').get(serviceName);
  return row?.duration_minutes || Number(config.slot_duration_minutes) || 30;
}

function rangesOverlap(startA, endA, startB, endB) {
  return startA < endB && startB < endA;
}

function listActiveAppointments(date, excludeId = null) {
  if (excludeId) {
    return db.prepare("SELECT id, time, service FROM appointments WHERE date = ? AND status IN ('new','pending','confirmed') AND id != ?")
      .all(date, excludeId);
  }
  return db.prepare("SELECT id, time, service FROM appointments WHERE date = ? AND status IN ('new','pending','confirmed')")
    .all(date);
}

function hasConflict(date, time, durationMinutes, excludeId = null) {
  const start = toMinutes(time);
  if (start === null) return true;
  const end = start + durationMinutes;
  const existing = listActiveAppointments(date, excludeId);
  const config = getConfigMap();

  return existing.some((appointment) => {
    const existingStart = toMinutes(appointment.time);
    const existingDuration = getAppointmentDuration(appointment.service, config);
    return rangesOverlap(start, end, existingStart, existingStart + existingDuration);
  });
}

function getAvailableSlots(date, durationMinutes, excludeId = null) {
  const config = getConfigMap();
  const slotStep = Number(config.slot_duration_minutes) || 30;
  const windows = getActiveWindows(date, config);
  const existing = listActiveAppointments(date, excludeId).map((appointment) => {
    const start = toMinutes(appointment.time);
    const duration = getAppointmentDuration(appointment.service, config);
    return { start, end: start + duration, time: appointment.time };
  });

  const available = [];
  const taken = [];

  for (const window of windows) {
    for (let cursor = window.start; cursor + durationMinutes <= window.end; cursor += slotStep) {
      const overlaps = existing.some((appointment) => rangesOverlap(cursor, cursor + durationMinutes, appointment.start, appointment.end));
      const slot = toTimeString(cursor);
      if (overlaps) {
        taken.push(slot);
      } else {
        available.push(slot);
      }
    }
  }

  return {
    available,
    taken: [...new Set(taken)],
    windows: windows.map((window) => ({ start: toTimeString(window.start), end: toTimeString(window.end) })),
    slot_duration_minutes: slotStep,
    lunch_break: config.lunch_break || ''
  };
}

function upsertConfigEntries(entries) {
  const upsert = db.prepare('INSERT OR REPLACE INTO business_config (key, value, updated_at) VALUES (?, ?, datetime(\'now\'))');
  const transaction = db.transaction((pairs) => {
    for (const [key, value] of pairs) {
      const previous = db.prepare('SELECT value FROM business_config WHERE key = ?').get(key)?.value ?? '';
      upsert.run(key, String(value ?? ''));
      if (previous !== String(value ?? '')) {
        logChange('business_config', key, key, previous, value, 'admin');
      }
    }
  });
  transaction(entries);
}

function getAdminToken() {
  return process.env.ADMIN_TOKEN || 'ashford-admin-token';
}

function adminAuth(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth || auth !== `Bearer ${getAdminToken()}`) {
    return res.status(401).json({ error: 'No autorizado' });
  }
  next();
}

app.post('/api/appointments', (req, res) => {
  const { name, phone, date, time, service, service_id, price, notes, channel = 'web' } = req.body;
  if (!name || !phone || !date || !time || !(service || service_id)) {
    return res.status(400).json({ error: 'Faltan campos obligatorios' });
  }

  const serviceRecord = getServiceRecord(service_id || service);
  if (!serviceRecord) {
    return res.status(400).json({ error: 'Servicio no valido' });
  }

  if (hasConflict(date, time, serviceRecord.duration_minutes)) {
    return res.status(409).json({ error: 'Franja horaria no disponible' });
  }

  const id = uid();
  db.prepare(`
    INSERT INTO appointments (id, name, phone, date, time, service, price, notes, channel, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, name, phone, date, time, serviceRecord.name, serviceRecord.price ?? price ?? 0, notes || '', channel, 'new');

  logChange('appointment', id, 'status', '', 'new', channel);

  const config = getConfigMap();
  const notifyTo = getBusinessNotificationPhone(config);
  if (notifyTo) {
    queueNotification(id, 'new_appointment_barber', 'whatsapp', notifyTo, {
      message: `Nueva cita solicitada: ${name} - ${serviceRecord.name} - ${date} ${time}`
    });
  }
  if (config.business_email) {
    queueNotification(id, 'new_appointment_barber', 'email', config.business_email, {
      subject: `Nueva cita - ${name}`,
      html: `<p>${name} ha solicitado ${serviceRecord.name} el ${date} a las ${time}.</p>`
    });
  }
  queueNotification(id, 'new_appointment', 'n8n', 'webhook', { id, name, phone, date, time, service: serviceRecord.name, channel });

  res.status(201).json(db.prepare('SELECT * FROM appointments WHERE id = ?').get(id));
});

app.get('/api/availability', (req, res) => {
  const { date, service_id, service, exclude_id } = req.query;
  if (!date) return res.status(400).json({ error: 'Fecha requerida' });

  const serviceRecord = getServiceRecord(service_id || service);
  const config = getConfigMap();
  const duration = serviceRecord?.duration_minutes || Number(config.slot_duration_minutes) || 30;
  const slots = getAvailableSlots(date, duration, exclude_id || null);

  res.json({
    date,
    service_duration_minutes: duration,
    ...slots
  });
});

app.get('/api/services', (_req, res) => {
  res.json(db.prepare('SELECT * FROM services WHERE active = 1 ORDER BY price ASC, name ASC').all());
});

app.get('/api/admin/services', adminAuth, (_req, res) => {
  res.json(db.prepare('SELECT * FROM services ORDER BY active DESC, price ASC, name ASC').all());
});

app.post('/api/admin/services', adminAuth, (req, res) => {
  const { name, description = '', price, duration_minutes, active = 1 } = req.body;
  if (!name || price === undefined || duration_minutes === undefined) {
    return res.status(400).json({ error: 'Faltan campos del servicio' });
  }

  const id = uid();
  db.prepare(`
    INSERT INTO services (id, name, description, price, duration_minutes, active)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(id, name.trim(), description.trim(), Number(price), Number(duration_minutes), active ? 1 : 0);

  logChange('service', id, 'created', '', JSON.stringify({ name, price, duration_minutes, active }), 'admin');
  res.status(201).json(db.prepare('SELECT * FROM services WHERE id = ?').get(id));
});

app.patch('/api/admin/services/:id', adminAuth, (req, res) => {
  const current = db.prepare('SELECT * FROM services WHERE id = ?').get(req.params.id);
  if (!current) return res.status(404).json({ error: 'Servicio no encontrado' });

  const next = {
    name: req.body.name !== undefined ? String(req.body.name).trim() : current.name,
    description: req.body.description !== undefined ? String(req.body.description).trim() : current.description,
    price: req.body.price !== undefined ? Number(req.body.price) : current.price,
    duration_minutes: req.body.duration_minutes !== undefined ? Number(req.body.duration_minutes) : current.duration_minutes,
    active: req.body.active !== undefined ? (req.body.active ? 1 : 0) : current.active,
  };

  if (!next.name || Number.isNaN(next.price) || Number.isNaN(next.duration_minutes)) {
    return res.status(400).json({ error: 'Datos de servicio no validos' });
  }

  db.prepare(`
    UPDATE services
    SET name = ?, description = ?, price = ?, duration_minutes = ?, active = ?
    WHERE id = ?
  `).run(next.name, next.description, next.price, next.duration_minutes, next.active, req.params.id);

  for (const field of ['name', 'description', 'price', 'duration_minutes', 'active']) {
    if (String(current[field] ?? '') !== String(next[field] ?? '')) {
      logChange('service', req.params.id, field, current[field], next[field], 'admin');
    }
  }

  res.json(db.prepare('SELECT * FROM services WHERE id = ?').get(req.params.id));
});

app.delete('/api/admin/services/:id', adminAuth, (req, res) => {
  const current = db.prepare('SELECT * FROM services WHERE id = ?').get(req.params.id);
  if (!current) return res.status(404).json({ error: 'Servicio no encontrado' });

  db.prepare('DELETE FROM services WHERE id = ?').run(req.params.id);
  logChange('service', req.params.id, 'deleted', JSON.stringify(current), '', 'admin');
  res.json({ ok: true });
});

app.get('/api/faqs', (_req, res) => {
  res.json(db.prepare('SELECT * FROM faqs WHERE active = 1 ORDER BY sort_order ASC, question ASC').all());
});

app.get('/api/business/info', (_req, res) => {
  const config = getConfigMap();
  const services = db.prepare('SELECT id, name, description, price, duration_minutes FROM services WHERE active = 1 ORDER BY price ASC, name ASC').all();
  const faqs = db.prepare('SELECT question, answer, category FROM faqs WHERE active = 1 ORDER BY sort_order ASC').all();
  res.json({ ...config, services, faqs });
});

app.get('/api/admin/appointments', adminAuth, (req, res) => {
  const { status, date, channel } = req.query;
  let query = 'SELECT * FROM appointments WHERE 1=1';
  const params = [];
  if (status) { query += ' AND status = ?'; params.push(status); }
  if (date) { query += ' AND date = ?'; params.push(date); }
  if (channel) { query += ' AND channel = ?'; params.push(channel); }
  query += ' ORDER BY date DESC, time DESC, created_at DESC';
  res.json(db.prepare(query).all(...params));
});

app.get('/api/admin/appointments/:id', adminAuth, (req, res) => {
  const appointment = db.prepare('SELECT * FROM appointments WHERE id = ?').get(req.params.id);
  if (!appointment) return res.status(404).json({ error: 'No encontrada' });
  res.json(appointment);
});

app.post('/api/admin/appointments', adminAuth, (req, res) => {
  const { name, phone, date, time, service, service_id, price, notes, channel = 'internal' } = req.body;
  if (!name || !phone || !date || !time || !(service || service_id)) {
    return res.status(400).json({ error: 'Faltan campos' });
  }

  const serviceRecord = getServiceRecord(service_id || service);
  if (!serviceRecord) {
    return res.status(400).json({ error: 'Servicio no valido' });
  }

  if (hasConflict(date, time, serviceRecord.duration_minutes)) {
    return res.status(409).json({ error: 'Franja horaria no disponible' });
  }

  const id = uid();
  db.prepare(`
    INSERT INTO appointments (id, name, phone, date, time, service, price, notes, channel, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, name, phone, date, time, serviceRecord.name, serviceRecord.price ?? price ?? 0, notes || '', channel, 'confirmed');
  logChange('appointment', id, 'status', '', 'confirmed', 'admin');

  res.status(201).json(db.prepare('SELECT * FROM appointments WHERE id = ?').get(id));
});

app.patch('/api/admin/appointments/:id', adminAuth, (req, res) => {
  const current = db.prepare('SELECT * FROM appointments WHERE id = ?').get(req.params.id);
  if (!current) return res.status(404).json({ error: 'No encontrada' });

  const serviceRecord = getServiceRecord(req.body.service_id || req.body.service || current.service);
  if (!serviceRecord) return res.status(400).json({ error: 'Servicio no valido' });

  const next = {
    name: req.body.name ?? current.name,
    phone: req.body.phone ?? current.phone,
    date: req.body.date ?? current.date,
    time: req.body.time ?? current.time,
    service: serviceRecord.name,
    price: req.body.price ?? serviceRecord.price ?? current.price,
    notes: req.body.notes ?? current.notes,
    status: req.body.status ?? current.status,
    channel: req.body.channel ?? current.channel,
  };

  if (hasConflict(next.date, next.time, serviceRecord.duration_minutes, req.params.id)) {
    return res.status(409).json({ error: 'Franja horaria no disponible' });
  }

  db.prepare(`
    UPDATE appointments
    SET name = ?, phone = ?, date = ?, time = ?, service = ?, price = ?, notes = ?, status = ?, channel = ?, updated_at = datetime('now')
    WHERE id = ?
  `).run(next.name, next.phone, next.date, next.time, next.service, next.price, next.notes || '', next.status, next.channel, req.params.id);

  for (const field of ['name', 'phone', 'date', 'time', 'service', 'price', 'notes', 'status', 'channel']) {
    if (String(current[field] ?? '') !== String(next[field] ?? '')) {
      logChange('appointment', req.params.id, field, current[field], next[field], 'admin');
    }
  }

  const updated = db.prepare('SELECT * FROM appointments WHERE id = ?').get(req.params.id);
  if (current.status !== updated.status) {
    if (updated.status === 'confirmed') {
      queueNotification(updated.id, 'appointment_confirmed', 'whatsapp', updated.phone, {
        message: `Tu cita en Ashford esta confirmada para ${updated.date} a las ${updated.time}.`
      });
    }
    if (updated.status === 'cancelled') {
      queueNotification(updated.id, 'appointment_cancelled', 'whatsapp', updated.phone, {
        message: `Tu cita en Ashford del ${updated.date} a las ${updated.time} ha sido cancelada.`
      });
    }
  }

  res.json(updated);
});

app.delete('/api/admin/appointments/:id', adminAuth, (req, res) => {
  db.prepare("UPDATE appointments SET status = 'cancelled', updated_at = datetime('now') WHERE id = ?").run(req.params.id);
  logChange('appointment', req.params.id, 'status', '', 'cancelled', 'admin');
  res.json({ ok: true });
});

app.get('/api/admin/stats', adminAuth, (_req, res) => {
  const today = new Date().toISOString().slice(0, 10);
  const revenueGenerated = db.prepare("SELECT COALESCE(SUM(price), 0) AS v FROM appointments WHERE status = 'done'").get().v;
  const revenueUpcoming = db.prepare("SELECT COALESCE(SUM(price), 0) AS v FROM appointments WHERE status = 'confirmed'").get().v;
  res.json({
    today: db.prepare('SELECT COUNT(*) AS n FROM appointments WHERE date = ?').get(today).n,
    pending: db.prepare("SELECT COUNT(*) AS n FROM appointments WHERE status IN ('new', 'pending')").get().n,
    confirmed: db.prepare("SELECT COUNT(*) AS n FROM appointments WHERE status = 'confirmed'").get().n,
    done: db.prepare("SELECT COUNT(*) AS n FROM appointments WHERE status = 'done'").get().n,
    revenue_confirmed: revenueUpcoming,
    revenue_done: revenueGenerated,
    revenue_upcoming: revenueUpcoming,
    revenue_generated: revenueGenerated,
    by_channel: db.prepare('SELECT channel, COUNT(*) AS n FROM appointments GROUP BY channel').all(),
    by_status: db.prepare('SELECT status, COUNT(*) AS n FROM appointments GROUP BY status').all(),
  });
});

app.get('/api/admin/logs', adminAuth, (_req, res) => {
  res.json(db.prepare('SELECT * FROM change_logs ORDER BY created_at DESC LIMIT 100').all());
});

app.get('/api/admin/notifications', adminAuth, (_req, res) => {
  res.json(db.prepare('SELECT * FROM notification_queue ORDER BY created_at DESC LIMIT 50').all());
});

app.get('/api/admin/config', adminAuth, (_req, res) => {
  res.json(db.prepare('SELECT key, value FROM business_config ORDER BY key ASC').all());
});

app.patch('/api/admin/config', adminAuth, (req, res) => {
  upsertConfigEntries(Object.entries(req.body));
  res.json({ ok: true, config: getConfigMap() });
});

app.post('/api/webhooks/inbound', (req, res) => {
  const { channel = 'external', event, data } = req.body;

  if (event === 'new_appointment' && data) {
    const serviceRecord = getServiceRecord(data.service_id || data.service);
    if (!serviceRecord) {
      return res.status(400).json({ error: 'Servicio no valido' });
    }
    if (hasConflict(data.date, data.time, serviceRecord.duration_minutes)) {
      return res.status(409).json({ error: 'Franja horaria no disponible' });
    }

    const id = uid();
    db.prepare(`
      INSERT INTO appointments (id, name, phone, date, time, service, price, notes, channel, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, data.name, data.phone, data.date, data.time, serviceRecord.name, serviceRecord.price ?? data.price ?? 0, data.notes || '', channel, 'new');
    logChange('appointment', id, 'status', '', 'new', channel);
    return res.json({ ok: true, id });
  }

  if (event === 'faq_query' && data?.question) {
    const faqs = db.prepare('SELECT * FROM faqs WHERE active = 1').all();
    const question = String(data.question).toLowerCase();
    const match = faqs.find((faq) => question.includes(String(faq.question).toLowerCase().split(' ')[0]));
    return res.json({ answer: match?.answer || 'Para mas informacion, contactanos directamente.' });
  }

  res.json({ ok: true, received: true });
});

app.post('/api/webhooks/n8n', (req, res) => {
  const { appointment_id, result } = req.body;
  if (appointment_id && result?.status) {
    db.prepare("UPDATE appointments SET status = ?, updated_at = datetime('now') WHERE id = ?").run(result.status, appointment_id);
  }
  res.json({ ok: true });
});

app.listen(PORT, () => {
  console.log(`ASHFORD API running on http://localhost:${PORT}`);
  console.log(`Admin token: ${getAdminToken()}`);
});

module.exports = app;
