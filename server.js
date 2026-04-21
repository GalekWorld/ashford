const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const path = require('path');
const crypto = require('crypto');
const fs = require('fs');

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

const app = express();
const PORT = process.env.PORT || 3001;

const DEFAULT_SERVICES = [
  ['Corte Clasico', 'Corte tradicional con tijera y maquina', 18, 40],
  ['Afeitado a Navaja', 'Afeitado clasico con navaja recta', 22, 35],
  ['Corte + Afeitado', 'Combinacion completa de corte y afeitado', 35, 70],
  ['Arreglo de Barba', 'Perfilado y arreglo de barba', 14, 25],
  ['Fade & Degradado', 'Tecnica moderna de degradado', 22, 45],
  ['Tratamiento Cuero', 'Tratamiento capilar y cuero cabelludo', 28, 55],
  ['Pack Premium', 'Corte + afeitado + tratamiento capilar', 55, 90],
];

const DEFAULT_CONFIG = [
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
];

const DEFAULT_FAQS = [
  ['Necesito reservar con antelacion?', 'Recomendamos reservar con al menos 24 horas para garantizar disponibilidad.', 'general', 1],
  ['Aceptais walk-ins?', 'Si, si hay disponibilidad. Siempre es preferible reservar con antelacion.', 'general', 2],
  ['Cuanto dura un corte clasico?', 'Entre 30 y 45 minutos, dependiendo del tipo de cabello.', 'servicios', 3],
  ['Como puedo cancelar mi cita?', 'Llamenos al +34 911 234 567 con al menos 2 horas de antelacion.', 'citas', 4],
  ['Cuales son vuestros horarios?', 'Lunes a viernes de 09:00 a 20:00, sabados de 09:00 a 15:00.', 'general', 5],
];

const DEFAULT_STAFF = [
  ['Carlos Ashford', 'owner', '+34 600 111 222', 'carlos@ashford.es'],
  ['Marco Ruiz', 'barber', '+34 600 333 444', 'marco@ashford.es'],
  ['Luis Perez', 'barber', '+34 600 555 666', 'luis@ashford.es'],
];

function uid() {
  return 'ap_' + crypto.randomBytes(8).toString('hex');
}

function getAdminToken() {
  return process.env.ADMIN_TOKEN || 'ashford-admin-token';
}

function getWhatsAppVerifyToken() {
  return process.env.WHATSAPP_VERIFY_TOKEN || 'ashford_verify_token_123';
}

function getCurrentDateInMadrid() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Madrid',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

function getPgConfig() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('Falta DATABASE_URL. Configura la cadena de conexion de Neon en el entorno.');
  }

  const isLocal = /localhost|127\.0\.0\.1/i.test(connectionString);
  return {
    connectionString,
    ssl: isLocal ? false : { rejectUnauthorized: false },
  };
}

const pool = new Pool(getPgConfig());

async function query(text, params = []) {
  return pool.query(text, params);
}

async function queryAll(text, params = []) {
  return (await query(text, params)).rows;
}

async function queryOne(text, params = []) {
  const rows = await queryAll(text, params);
  return rows[0] || null;
}

async function withTransaction(work) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function initDb() {
  const schemaPath = path.join(__dirname, 'db', 'schema.sql');
  const schemaSql = fs.readFileSync(schemaPath, 'utf8');
  await query(schemaSql);
  await query('ALTER TABLE notification_queue ADD COLUMN IF NOT EXISTS provider_message_id TEXT');
  await query('ALTER TABLE notification_queue ADD COLUMN IF NOT EXISTS error_message TEXT');
  await query('ALTER TABLE notification_queue ADD COLUMN IF NOT EXISTS response_payload TEXT');
  await seedData();
}

async function seedData() {
  const serviceCount = Number((await queryOne('SELECT COUNT(*)::int AS n FROM services')).n);
  if (serviceCount === 0) {
    for (const [name, description, price, durationMinutes] of DEFAULT_SERVICES) {
      await query(
        `INSERT INTO services (id, name, description, price, duration_minutes)
         VALUES ($1, $2, $3, $4, $5)`,
        [uid(), name, description, price, durationMinutes]
      );
    }
  }

  for (const [key, value] of DEFAULT_CONFIG) {
    await query(
      `INSERT INTO business_config (key, value)
       VALUES ($1, $2)
       ON CONFLICT (key) DO NOTHING`,
      [key, value]
    );
  }

  const faqCount = Number((await queryOne('SELECT COUNT(*)::int AS n FROM faqs')).n);
  if (faqCount === 0) {
    for (const [question, answer, category, sortOrder] of DEFAULT_FAQS) {
      await query(
        `INSERT INTO faqs (id, question, answer, category, sort_order)
         VALUES ($1, $2, $3, $4, $5)`,
        [uid(), question, answer, category, sortOrder]
      );
    }
  }

  const staffCount = Number((await queryOne('SELECT COUNT(*)::int AS n FROM staff')).n);
  if (staffCount === 0) {
    for (const [name, role, phone, email] of DEFAULT_STAFF) {
      await query(
        `INSERT INTO staff (id, name, role, phone, email)
         VALUES ($1, $2, $3, $4, $5)`,
        [uid(), name, role, phone, email]
      );
    }
  }
}

async function logChange(entityType, entityId, field, oldValue, newValue, by = 'system') {
  await query(
    `INSERT INTO change_logs (id, entity_type, entity_id, field_changed, old_value, new_value, changed_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [uid(), entityType, entityId, field, String(oldValue ?? ''), String(newValue ?? ''), by]
  );
}

async function queueNotification(appointmentId, type, channel, recipient, payload) {
  const notificationId = uid();
  await query(
    `INSERT INTO notification_queue (id, appointment_id, type, channel, recipient, payload)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [notificationId, appointmentId, type, channel, recipient, JSON.stringify(payload)]
  );
  await NotificationService.dispatch({ notificationId, appointmentId, type, channel, recipient, payload }).catch((error) => {
    console.error(`[notify:${channel}] failed`, error.message);
  });
}

function normalizePhoneNumber(phone) {
  return String(phone || '').replace(/\D/g, '');
}

function adminAuth(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth || auth !== `Bearer ${getAdminToken()}`) {
    return res.status(401).json({ error: 'No autorizado' });
  }
  next();
}

async function getConfigMap() {
  return Object.fromEntries(
    (await queryAll('SELECT key, value FROM business_config')).map(({ key, value }) => [key, value])
  );
}

function getBusinessNotificationPhone(config) {
  return normalizePhoneNumber(process.env.WHATSAPP_NOTIFY_TO || config.business_whatsapp || '');
}

function getWhatsAppTemplateName(payload = {}) {
  return payload.template_name || process.env.WHATSAPP_TEMPLATE_NAME || '';
}

function getWhatsAppTemplateLanguage(payload = {}) {
  return payload.template_language || process.env.WHATSAPP_TEMPLATE_LANGUAGE || 'es';
}

function getWhatsAppConfirmationTemplateName(payload = {}) {
  return payload.template_name || process.env.WHATSAPP_CONFIRM_TEMPLATE_NAME || 'cita_confirmada_cliente';
}

function getWhatsAppConfirmationTemplateLanguage(payload = {}) {
  return payload.template_language || process.env.WHATSAPP_CONFIRM_TEMPLATE_LANGUAGE || 'es';
}

function shouldUseBusinessTemplate(payload = {}) {
  const templateName = getWhatsAppTemplateName(payload);
  return payload.use_template === true || process.env.WHATSAPP_USE_TEMPLATES === '1' || templateName === 'hello_world';
}

function shouldUseConfirmationTemplate(payload = {}) {
  const templateName = getWhatsAppConfirmationTemplateName(payload);
  return payload.use_template === true || process.env.WHATSAPP_CONFIRM_USE_TEMPLATES === '1' || templateName === 'hello_world';
}

function buildWhatsAppTemplatePayload(to, payload = {}) {
  const templateName = getWhatsAppTemplateName(payload);
  if (!templateName) return null;

  const body = {
    messaging_product: 'whatsapp',
    to,
    type: 'template',
    template: {
      name: templateName,
      language: { code: getWhatsAppTemplateLanguage(payload) },
    },
  };

  const templateParams = Array.isArray(payload.template_params) ? payload.template_params.filter((item) => item !== undefined && item !== null && String(item) !== '') : [];
  const shouldAttachParams = templateName !== 'hello_world';
  if (shouldAttachParams && templateParams.length) {
    body.template.components = [
      {
        type: 'body',
        parameters: templateParams.map((value) => ({ type: 'text', text: String(value) })),
      },
    ];
  }

  return body;
}

async function updateNotificationRecord(notificationId, changes) {
  const fields = [];
  const values = [];
  for (const [key, value] of Object.entries(changes)) {
    values.push(value);
    fields.push(`${key} = $${values.length}`);
  }
  if (!fields.length) return;
  values.push(notificationId);
  await query(`UPDATE notification_queue SET ${fields.join(', ')} WHERE id = $${values.length}`, values);
}

async function getServiceRecord(input) {
  if (!input) return null;
  return queryOne('SELECT * FROM services WHERE id = $1 OR name = $1 LIMIT 1', [input]);
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

async function getAppointmentDuration(serviceName, config = null) {
  const row = await queryOne('SELECT duration_minutes FROM services WHERE name = $1 LIMIT 1', [serviceName]);
  const effectiveConfig = config || await getConfigMap();
  return Number(row?.duration_minutes || effectiveConfig.slot_duration_minutes || 30);
}

function rangesOverlap(startA, endA, startB, endB) {
  return startA < endB && startB < endA;
}

async function listActiveAppointments(date, excludeId = null) {
  if (excludeId) {
    return queryAll(
      `SELECT id, time, service
       FROM appointments
       WHERE date = $1 AND status IN ('new', 'pending', 'confirmed') AND id != $2`,
      [date, excludeId]
    );
  }

  return queryAll(
    `SELECT id, time, service
     FROM appointments
     WHERE date = $1 AND status IN ('new', 'pending', 'confirmed')`,
    [date]
  );
}

async function hasConflict(date, time, durationMinutes, excludeId = null) {
  const start = toMinutes(time);
  if (start === null) return true;

  const end = start + durationMinutes;
  const existing = await listActiveAppointments(date, excludeId);
  const config = await getConfigMap();

  for (const appointment of existing) {
    const existingStart = toMinutes(appointment.time);
    const existingDuration = await getAppointmentDuration(appointment.service, config);
    if (rangesOverlap(start, end, existingStart, existingStart + existingDuration)) {
      return true;
    }
  }

  return false;
}

async function getAvailableSlots(date, durationMinutes, excludeId = null) {
  const config = await getConfigMap();
  const slotStep = Number(config.slot_duration_minutes) || 30;
  const windows = getActiveWindows(date, config);
  const existingAppointments = await listActiveAppointments(date, excludeId);
  const existing = [];

  for (const appointment of existingAppointments) {
    const start = toMinutes(appointment.time);
    const duration = await getAppointmentDuration(appointment.service, config);
    existing.push({ start, end: start + duration, time: appointment.time });
  }

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
    lunch_break: config.lunch_break || '',
  };
}

async function upsertConfigEntries(entries) {
  await withTransaction(async (client) => {
    for (const [key, value] of entries) {
      const previous = (await client.query('SELECT value FROM business_config WHERE key = $1', [key])).rows[0]?.value ?? '';
      await client.query(
        `INSERT INTO business_config (key, value, updated_at)
         VALUES ($1, $2, NOW())
         ON CONFLICT (key)
         DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
        [key, String(value ?? '')]
      );

      if (previous !== String(value ?? '')) {
        await client.query(
          `INSERT INTO change_logs (id, entity_type, entity_id, field_changed, old_value, new_value, changed_by)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [uid(), 'business_config', key, key, previous, String(value ?? ''), 'admin']
        );
      }
    }
  });
}

const NotificationService = {
  async dispatch({ notificationId, appointmentId, type, channel, recipient, payload }) {
    try {
      let providerResult = null;
      switch (channel) {
        case 'whatsapp':
          providerResult = await this.sendWhatsApp(recipient, payload);
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

      await updateNotificationRecord(notificationId, {
        status: 'sent',
        last_attempt: new Date(),
        provider_message_id: providerResult?.providerMessageId || null,
        response_payload: providerResult ? JSON.stringify(providerResult) : null,
        error_message: null,
      });
    } catch (error) {
      await query(
        `UPDATE notification_queue
         SET status = 'failed',
             attempts = attempts + 1,
             last_attempt = NOW(),
             error_message = $2,
             response_payload = $3
         WHERE id = $1`,
        [
          notificationId,
          error.message,
          error.meta ? JSON.stringify(error.meta) : null,
        ]
      );
      throw error;
    }
  },

  async callWhatsAppApi(body, accessToken, phoneNumberId) {
    const response = await fetch(`https://graph.facebook.com/v22.0/${phoneNumberId}/messages`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    const rawText = await response.text();
    let parsed = null;
    try {
      parsed = rawText ? JSON.parse(rawText) : null;
    } catch (_error) {
      parsed = rawText || null;
    }

    if (!response.ok) {
      const error = new Error(
        parsed?.error?.message
          ? `WhatsApp API error ${response.status}: ${parsed.error.message}`
          : `WhatsApp API error ${response.status}: ${rawText}`
      );
      error.meta = parsed || rawText;
      throw error;
    }

    return parsed;
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

    const textBody = {
      messaging_product: 'whatsapp',
      to,
      type: 'text',
      text: {
        body: payload.message || payload.subject || 'Nueva notificacion de Ashford',
      },
    };

    const templateBody = buildWhatsAppTemplatePayload(to, payload);
    const forceTemplate = payload.use_template === true || process.env.WHATSAPP_USE_TEMPLATES === '1';

    try {
      const result = await this.callWhatsAppApi(forceTemplate && templateBody ? templateBody : textBody, accessToken, phoneNumberId);
      return {
        mode: forceTemplate && templateBody ? 'template' : 'text',
        providerMessageId: result?.messages?.[0]?.id || '',
        response: result,
      };
    } catch (error) {
      const mayNeedTemplate = /outside the allowed window|template|re-engagement|free-form|24 hour|24-hour/i.test(error.message);
      if (templateBody && !forceTemplate && mayNeedTemplate) {
        const templateResult = await this.callWhatsAppApi(templateBody, accessToken, phoneNumberId);
        return {
          mode: 'template',
          providerMessageId: templateResult?.messages?.[0]?.id || '',
          response: templateResult,
          fallback_from: 'text',
        };
      }
      throw error;
    }
  },
};

const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

const initPromise = initDb();

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use(asyncHandler(async (_req, _res, next) => {
  await initPromise;
  next();
}));

app.get('/favicon.ico', (_req, res) => {
  res.status(204).end();
});

app.get('/', (_req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.get('/admin', (_req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.get('/privacy-policy', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'privacy-policy.html'));
});

app.get('/data-deletion', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'data-deletion.html'));
});

app.get('/terms-of-service', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'terms-of-service.html'));
});

app.post('/api/appointments', asyncHandler(async (req, res) => {
  const { name, phone, date, time, service, service_id, price, notes, channel = 'web' } = req.body;
  if (!name || !phone || !date || !time || !(service || service_id)) {
    return res.status(400).json({ error: 'Faltan campos obligatorios' });
  }

  const serviceRecord = await getServiceRecord(service_id || service);
  if (!serviceRecord) {
    return res.status(400).json({ error: 'Servicio no valido' });
  }

  if (await hasConflict(date, time, Number(serviceRecord.duration_minutes))) {
    return res.status(409).json({ error: 'Franja horaria no disponible' });
  }

  const id = uid();
  await query(
    `INSERT INTO appointments (id, name, phone, date, time, service, price, notes, channel, status)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [id, name, phone, date, time, serviceRecord.name, Number(serviceRecord.price ?? price ?? 0), notes || '', channel, 'new']
  );

  await logChange('appointment', id, 'status', '', 'new', channel);

  const config = await getConfigMap();
  const notifyTo = getBusinessNotificationPhone(config);
  if (notifyTo) {
    await queueNotification(id, 'new_appointment_barber', 'whatsapp', notifyTo, {
      message: `Nueva cita solicitada: ${name} - ${serviceRecord.name} - ${date} ${time}`,
      use_template: shouldUseBusinessTemplate(),
      template_name: getWhatsAppTemplateName({
        template_name: process.env.WHATSAPP_TEMPLATE_NAME || 'cita_peluquero_info',
      }),
      template_language: process.env.WHATSAPP_TEMPLATE_LANGUAGE || 'es',
      template_params: [name, serviceRecord.name, date, time, phone],
    });
  }
  if (config.business_email) {
    await queueNotification(id, 'new_appointment_barber', 'email', config.business_email, {
      subject: `Nueva cita - ${name}`,
      html: `<p>${name} ha solicitado ${serviceRecord.name} el ${date} a las ${time}.</p>`,
    });
  }
  await queueNotification(id, 'new_appointment', 'n8n', 'webhook', {
    id,
    name,
    phone,
    date,
    time,
    service: serviceRecord.name,
    channel,
  });

  res.status(201).json(await queryOne('SELECT * FROM appointments WHERE id = $1', [id]));
}));

app.get('/api/availability', asyncHandler(async (req, res) => {
  const { date, service_id, service, exclude_id } = req.query;
  if (!date) return res.status(400).json({ error: 'Fecha requerida' });

  const serviceRecord = await getServiceRecord(service_id || service);
  const config = await getConfigMap();
  const duration = Number(serviceRecord?.duration_minutes || config.slot_duration_minutes || 30);
  const slots = await getAvailableSlots(date, duration, exclude_id || null);

  res.json({
    date,
    service_duration_minutes: duration,
    ...slots,
  });
}));

app.get('/api/services', asyncHandler(async (_req, res) => {
  res.json(await queryAll('SELECT * FROM services WHERE active = 1 ORDER BY price ASC, name ASC'));
}));

app.get('/api/admin/services', adminAuth, asyncHandler(async (_req, res) => {
  res.json(await queryAll('SELECT * FROM services ORDER BY active DESC, price ASC, name ASC'));
}));

app.post('/api/admin/services', adminAuth, asyncHandler(async (req, res) => {
  const { name, description = '', price, duration_minutes, active = 1 } = req.body;
  if (!name || price === undefined || duration_minutes === undefined) {
    return res.status(400).json({ error: 'Faltan campos del servicio' });
  }

  const id = uid();
  await query(
    `INSERT INTO services (id, name, description, price, duration_minutes, active)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [id, name.trim(), description.trim(), Number(price), Number(duration_minutes), active ? 1 : 0]
  );

  await logChange('service', id, 'created', '', JSON.stringify({ name, price, duration_minutes, active }), 'admin');
  res.status(201).json(await queryOne('SELECT * FROM services WHERE id = $1', [id]));
}));

app.patch('/api/admin/services/:id', adminAuth, asyncHandler(async (req, res) => {
  const current = await queryOne('SELECT * FROM services WHERE id = $1', [req.params.id]);
  if (!current) return res.status(404).json({ error: 'Servicio no encontrado' });

  const next = {
    name: req.body.name !== undefined ? String(req.body.name).trim() : current.name,
    description: req.body.description !== undefined ? String(req.body.description).trim() : current.description,
    price: req.body.price !== undefined ? Number(req.body.price) : Number(current.price),
    duration_minutes: req.body.duration_minutes !== undefined ? Number(req.body.duration_minutes) : Number(current.duration_minutes),
    active: req.body.active !== undefined ? (req.body.active ? 1 : 0) : Number(current.active),
  };

  if (!next.name || Number.isNaN(next.price) || Number.isNaN(next.duration_minutes)) {
    return res.status(400).json({ error: 'Datos de servicio no validos' });
  }

  await query(
    `UPDATE services
     SET name = $1, description = $2, price = $3, duration_minutes = $4, active = $5
     WHERE id = $6`,
    [next.name, next.description, next.price, next.duration_minutes, next.active, req.params.id]
  );

  for (const field of ['name', 'description', 'price', 'duration_minutes', 'active']) {
    if (String(current[field] ?? '') !== String(next[field] ?? '')) {
      await logChange('service', req.params.id, field, current[field], next[field], 'admin');
    }
  }

  res.json(await queryOne('SELECT * FROM services WHERE id = $1', [req.params.id]));
}));

app.delete('/api/admin/services/:id', adminAuth, asyncHandler(async (req, res) => {
  const current = await queryOne('SELECT * FROM services WHERE id = $1', [req.params.id]);
  if (!current) return res.status(404).json({ error: 'Servicio no encontrado' });

  await query('DELETE FROM services WHERE id = $1', [req.params.id]);
  await logChange('service', req.params.id, 'deleted', JSON.stringify(current), '', 'admin');
  res.json({ ok: true });
}));

app.get('/api/faqs', asyncHandler(async (_req, res) => {
  res.json(await queryAll('SELECT * FROM faqs WHERE active = 1 ORDER BY sort_order ASC, question ASC'));
}));

app.get('/api/business/info', asyncHandler(async (_req, res) => {
  const config = await getConfigMap();
  const services = await queryAll(
    'SELECT id, name, description, price, duration_minutes FROM services WHERE active = 1 ORDER BY price ASC, name ASC'
  );
  const faqs = await queryAll(
    'SELECT question, answer, category FROM faqs WHERE active = 1 ORDER BY sort_order ASC'
  );
  res.json({ ...config, services, faqs });
}));

app.get('/api/admin/appointments', adminAuth, asyncHandler(async (req, res) => {
  const { status, date, channel } = req.query;
  const clauses = ['1=1'];
  const params = [];

  if (status) {
    params.push(status);
    clauses.push(`status = $${params.length}`);
  }
  if (date) {
    params.push(date);
    clauses.push(`date = $${params.length}`);
  }
  if (channel) {
    params.push(channel);
    clauses.push(`channel = $${params.length}`);
  }

  const sql = `
    SELECT * FROM appointments
    WHERE ${clauses.join(' AND ')}
    ORDER BY date DESC, time DESC, created_at DESC
  `;

  res.json(await queryAll(sql, params));
}));

app.get('/api/admin/appointments/:id', adminAuth, asyncHandler(async (req, res) => {
  const appointment = await queryOne('SELECT * FROM appointments WHERE id = $1', [req.params.id]);
  if (!appointment) return res.status(404).json({ error: 'No encontrada' });
  res.json(appointment);
}));

app.post('/api/admin/appointments', adminAuth, asyncHandler(async (req, res) => {
  const { name, phone, date, time, service, service_id, price, notes, channel = 'internal' } = req.body;
  if (!name || !phone || !date || !time || !(service || service_id)) {
    return res.status(400).json({ error: 'Faltan campos' });
  }

  const serviceRecord = await getServiceRecord(service_id || service);
  if (!serviceRecord) {
    return res.status(400).json({ error: 'Servicio no valido' });
  }

  if (await hasConflict(date, time, Number(serviceRecord.duration_minutes))) {
    return res.status(409).json({ error: 'Franja horaria no disponible' });
  }

  const id = uid();
  await query(
    `INSERT INTO appointments (id, name, phone, date, time, service, price, notes, channel, status)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [id, name, phone, date, time, serviceRecord.name, Number(serviceRecord.price ?? price ?? 0), notes || '', channel, 'confirmed']
  );

  await logChange('appointment', id, 'status', '', 'confirmed', 'admin');
  res.status(201).json(await queryOne('SELECT * FROM appointments WHERE id = $1', [id]));
}));

app.patch('/api/admin/appointments/:id', adminAuth, asyncHandler(async (req, res) => {
  const current = await queryOne('SELECT * FROM appointments WHERE id = $1', [req.params.id]);
  if (!current) return res.status(404).json({ error: 'No encontrada' });

  const isServiceBeingChanged = req.body.service_id !== undefined || req.body.service !== undefined;
  const isScheduleBeingChanged = isServiceBeingChanged || req.body.date !== undefined || req.body.time !== undefined;
  const serviceRecord = isServiceBeingChanged
    ? await getServiceRecord(req.body.service_id || req.body.service)
    : await getServiceRecord(current.service);

  if (isServiceBeingChanged && !serviceRecord) {
    return res.status(400).json({ error: 'Servicio no valido' });
  }

  const next = {
    name: req.body.name ?? current.name,
    phone: req.body.phone ?? current.phone,
    date: req.body.date ?? current.date,
    time: req.body.time ?? current.time,
    service: serviceRecord?.name || current.service,
    price: req.body.price ?? serviceRecord?.price ?? current.price,
    notes: req.body.notes ?? current.notes,
    status: req.body.status ?? current.status,
    channel: req.body.channel ?? current.channel,
  };

  if (isScheduleBeingChanged) {
    const durationMinutes = Number(serviceRecord?.duration_minutes || await getAppointmentDuration(current.service));
    if (await hasConflict(next.date, next.time, durationMinutes, req.params.id)) {
      return res.status(409).json({ error: 'Franja horaria no disponible' });
    }
  }

  await query(
    `UPDATE appointments
     SET name = $1, phone = $2, date = $3, time = $4, service = $5, price = $6, notes = $7, status = $8, channel = $9, updated_at = NOW()
     WHERE id = $10`,
    [next.name, next.phone, next.date, next.time, next.service, Number(next.price), next.notes || '', next.status, next.channel, req.params.id]
  );

  for (const field of ['name', 'phone', 'date', 'time', 'service', 'price', 'notes', 'status', 'channel']) {
    if (String(current[field] ?? '') !== String(next[field] ?? '')) {
      await logChange('appointment', req.params.id, field, current[field], next[field], 'admin');
    }
  }

  const updated = await queryOne('SELECT * FROM appointments WHERE id = $1', [req.params.id]);
  if (current.status !== updated.status) {
    if (updated.status === 'confirmed') {
      await queueNotification(updated.id, 'appointment_confirmed', 'whatsapp', updated.phone, {
        message: `Tu cita en Ashford esta confirmada para ${updated.date} a las ${updated.time}.`,
        use_template: shouldUseConfirmationTemplate(),
        template_name: getWhatsAppConfirmationTemplateName(),
        template_language: getWhatsAppConfirmationTemplateLanguage(),
        template_params: [updated.name, updated.service, updated.date, updated.time],
      });
    }
    if (updated.status === 'cancelled') {
      await queueNotification(updated.id, 'appointment_cancelled', 'whatsapp', updated.phone, {
        message: `Tu cita en Ashford del ${updated.date} a las ${updated.time} ha sido cancelada.`,
        use_template: false,
      });
    }
  }

  res.json(updated);
}));

app.delete('/api/admin/appointments/:id', adminAuth, asyncHandler(async (req, res) => {
  await query(
    `UPDATE appointments
     SET status = 'cancelled', updated_at = NOW()
     WHERE id = $1`,
    [req.params.id]
  );
  await logChange('appointment', req.params.id, 'status', '', 'cancelled', 'admin');
  res.json({ ok: true });
}));

app.get('/api/admin/stats', adminAuth, asyncHandler(async (_req, res) => {
  const today = getCurrentDateInMadrid();
  const revenueGenerated = Number((await queryOne(
    "SELECT COALESCE(SUM(price), 0)::float AS v FROM appointments WHERE status = 'done'"
  )).v);
  const revenueUpcoming = Number((await queryOne(
    "SELECT COALESCE(SUM(price), 0)::float AS v FROM appointments WHERE status = 'confirmed'"
  )).v);

  res.json({
    today: Number((await queryOne('SELECT COUNT(*)::int AS n FROM appointments WHERE date = $1', [today])).n),
    pending: Number((await queryOne("SELECT COUNT(*)::int AS n FROM appointments WHERE status IN ('new', 'pending')")).n),
    confirmed: Number((await queryOne("SELECT COUNT(*)::int AS n FROM appointments WHERE status = 'confirmed'")).n),
    done: Number((await queryOne("SELECT COUNT(*)::int AS n FROM appointments WHERE status = 'done'")).n),
    revenue_confirmed: revenueUpcoming,
    revenue_done: revenueGenerated,
    revenue_upcoming: revenueUpcoming,
    revenue_generated: revenueGenerated,
    by_channel: await queryAll('SELECT channel, COUNT(*)::int AS n FROM appointments GROUP BY channel ORDER BY channel ASC'),
    by_status: await queryAll('SELECT status, COUNT(*)::int AS n FROM appointments GROUP BY status ORDER BY status ASC'),
  });
}));

app.get('/api/admin/logs', adminAuth, asyncHandler(async (_req, res) => {
  res.json(await queryAll(`
    SELECT *
    FROM change_logs
    WHERE
      (entity_type = 'appointment' AND field_changed IN ('status', 'date', 'time', 'service'))
      OR (entity_type = 'service' AND field_changed IN ('created', 'deleted', 'price', 'duration_minutes', 'active'))
      OR (entity_type = 'business_config' AND field_changed IN (
        'business_name',
        'business_address',
        'business_phone',
        'business_email',
        'business_whatsapp',
        'opening_hours_weekday',
        'opening_hours_saturday',
        'opening_hours_sunday',
        'lunch_break',
        'slot_duration_minutes'
      ))
      OR (entity_type = 'whatsapp_test')
    ORDER BY created_at DESC
    LIMIT 100
  `));
}));

app.get('/api/admin/notifications', adminAuth, asyncHandler(async (_req, res) => {
  res.json(await queryAll('SELECT * FROM notification_queue ORDER BY created_at DESC LIMIT 50'));
}));

app.post('/api/admin/test-whatsapp', adminAuth, asyncHandler(async (req, res) => {
  const config = await getConfigMap();
  const to = normalizePhoneNumber(req.body?.to || getBusinessNotificationPhone(config));
  if (!to) {
    return res.status(400).json({ error: 'No hay numero de destino configurado para WhatsApp.' });
  }

  const templateName = getWhatsAppTemplateName(req.body || {});
  const defaultMessage = req.body?.message || 'Prueba de WhatsApp desde Ashford. Si recibes este mensaje, la integracion esta funcionando.';
  const result = await NotificationService.sendWhatsApp(to, {
    message: defaultMessage,
    use_template: shouldUseBusinessTemplate(req.body || {}),
    template_name: templateName,
    template_language: req.body?.template_language,
    template_params: Array.isArray(req.body?.template_params) ? req.body.template_params : [],
  });

  const referenceAppointmentId = req.body?.appointment_id || (await queryOne('SELECT id FROM appointments ORDER BY created_at DESC LIMIT 1'))?.id || null;
  if (referenceAppointmentId) {
    await query(
      `INSERT INTO notification_queue (id, appointment_id, type, channel, recipient, payload, status, provider_message_id, response_payload, last_attempt)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())`,
      [
        uid(),
        referenceAppointmentId,
        'manual_whatsapp_test',
        'whatsapp',
        to,
        JSON.stringify({ message: defaultMessage, template_name: templateName || '' }),
        'sent',
        result.providerMessageId || null,
        JSON.stringify(result),
      ]
    );
  } else {
    await logChange('whatsapp_test', uid(), 'result', '', JSON.stringify(result), 'admin');
  }

  res.json({
    ok: true,
    to,
    ...result,
  });
}));

app.get('/api/admin/config', adminAuth, asyncHandler(async (_req, res) => {
  res.json(await queryAll('SELECT key, value FROM business_config ORDER BY key ASC'));
}));

app.patch('/api/admin/config', adminAuth, asyncHandler(async (req, res) => {
  await upsertConfigEntries(Object.entries(req.body));
  res.json({ ok: true, config: await getConfigMap() });
}));

app.get('/api/whatsapp/webhook', asyncHandler(async (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === getWhatsAppVerifyToken()) {
    return res.status(200).type('text/plain').send(String(challenge || ''));
  }

  return res.status(403).json({ error: 'Token de verificacion invalido' });
}));

app.post('/api/whatsapp/webhook', asyncHandler(async (req, res) => {
  const entries = Array.isArray(req.body?.entry) ? req.body.entry : [];

  for (const entry of entries) {
    const changes = Array.isArray(entry?.changes) ? entry.changes : [];

    for (const change of changes) {
      const value = change?.value || {};
      const statuses = Array.isArray(value.statuses) ? value.statuses : [];
      const messages = Array.isArray(value.messages) ? value.messages : [];

      for (const status of statuses) {
        const statusPayload = {
          whatsapp_message_id: status.id || '',
          recipient_id: status.recipient_id || '',
          status: status.status || '',
          timestamp: status.timestamp || '',
          raw: status,
        };

        await query(
          `INSERT INTO change_logs (id, entity_type, entity_id, field_changed, old_value, new_value, changed_by)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [
            uid(),
            'whatsapp_status',
            status.id || uid(),
            'status',
            '',
            JSON.stringify(statusPayload),
            'whatsapp_webhook',
          ]
        );
      }

      for (const message of messages) {
        const inboundPayload = {
          from: message.from || '',
          type: message.type || '',
          text: message.text?.body || '',
          raw: message,
        };

        await query(
          `INSERT INTO change_logs (id, entity_type, entity_id, field_changed, old_value, new_value, changed_by)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [
            uid(),
            'whatsapp_inbound',
            message.id || uid(),
            'message',
            '',
            JSON.stringify(inboundPayload),
            'whatsapp_webhook',
          ]
        );
      }
    }
  }

  res.status(200).json({ ok: true });
}));

app.post('/api/webhooks/inbound', asyncHandler(async (req, res) => {
  const { channel = 'external', event, data } = req.body;

  if (event === 'new_appointment' && data) {
    const serviceRecord = await getServiceRecord(data.service_id || data.service);
    if (!serviceRecord) {
      return res.status(400).json({ error: 'Servicio no valido' });
    }
    if (await hasConflict(data.date, data.time, Number(serviceRecord.duration_minutes))) {
      return res.status(409).json({ error: 'Franja horaria no disponible' });
    }

    const id = uid();
    await query(
      `INSERT INTO appointments (id, name, phone, date, time, service, price, notes, channel, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [id, data.name, data.phone, data.date, data.time, serviceRecord.name, Number(serviceRecord.price ?? data.price ?? 0), data.notes || '', channel, 'new']
    );
    await logChange('appointment', id, 'status', '', 'new', channel);
    return res.json({ ok: true, id });
  }

  if (event === 'faq_query' && data?.question) {
    const faqs = await queryAll('SELECT * FROM faqs WHERE active = 1');
    const question = String(data.question).toLowerCase();
    const match = faqs.find((faq) => question.includes(String(faq.question).toLowerCase().split(' ')[0]));
    return res.json({ answer: match?.answer || 'Para mas informacion, contactanos directamente.' });
  }

  res.json({ ok: true, received: true });
}));

app.post('/api/webhooks/n8n', asyncHandler(async (req, res) => {
  const { appointment_id, result } = req.body;
  if (appointment_id && result?.status) {
    await query(
      `UPDATE appointments
       SET status = $1, updated_at = NOW()
       WHERE id = $2`,
      [result.status, appointment_id]
    );
  }
  res.json({ ok: true });
}));

app.use((error, _req, res, _next) => {
  console.error(error);
  res.status(500).json({ error: 'Error interno del servidor' });
});

if (!process.env.VERCEL) {
  initPromise
    .then(() => {
      app.listen(PORT, () => {
        console.log(`ASHFORD API running on http://localhost:${PORT}`);
        console.log(`Admin token: ${getAdminToken()}`);
      });
    })
    .catch((error) => {
      console.error('Database initialization failed:', error);
      process.exit(1);
    });
}

module.exports = app;
