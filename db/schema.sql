CREATE TABLE IF NOT EXISTS clients (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  phone TEXT NOT NULL,
  phone_normalized TEXT,
  email TEXT,
  notes TEXT,
  source TEXT DEFAULT 'web',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS appointments (
  id TEXT PRIMARY KEY,
  client_id TEXT,
  name TEXT NOT NULL,
  phone TEXT NOT NULL,
  date TEXT NOT NULL,
  time TEXT NOT NULL,
  service TEXT NOT NULL,
  price DOUBLE PRECISION DEFAULT 0,
  status TEXT DEFAULT 'new',
  channel TEXT DEFAULT 'web',
  notes TEXT,
  notification_sent INTEGER DEFAULT 0,
  confirmation_sent INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT fk_appointments_client FOREIGN KEY (client_id) REFERENCES clients(id)
);

CREATE TABLE IF NOT EXISTS services (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  price DOUBLE PRECISION NOT NULL,
  duration_minutes INTEGER DEFAULT 30,
  active INTEGER DEFAULT 1,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS staff (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  role TEXT DEFAULT 'barber',
  phone TEXT,
  email TEXT,
  active INTEGER DEFAULT 1,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS business_config (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS faqs (
  id TEXT PRIMARY KEY,
  question TEXT NOT NULL,
  answer TEXT NOT NULL,
  category TEXT DEFAULT 'general',
  active INTEGER DEFAULT 1,
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS change_logs (
  id TEXT PRIMARY KEY,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  field_changed TEXT,
  old_value TEXT,
  new_value TEXT,
  changed_by TEXT DEFAULT 'system',
  created_at TIMESTAMPTZ DEFAULT NOW()
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
  provider_message_id TEXT,
  error_message TEXT,
  response_payload TEXT,
  last_attempt TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT fk_notification_queue_appointment FOREIGN KEY (appointment_id) REFERENCES appointments(id)
);

CREATE INDEX IF NOT EXISTS idx_appointments_date_status ON appointments (date, status);
CREATE INDEX IF NOT EXISTS idx_appointments_status ON appointments (status);
CREATE INDEX IF NOT EXISTS idx_appointments_client_id ON appointments (client_id);
CREATE INDEX IF NOT EXISTS idx_notification_queue_appointment ON notification_queue (appointment_id);
