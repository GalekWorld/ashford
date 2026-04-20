# ASHFORD — Sistema de Gestión de Citas

## Estructura del proyecto

```
ashford/
├── index.html          # Frontend completo (standalone, funcional)
├── server.js           # Backend API (Node.js + Express + SQLite)
├── package.json
├── ashford.db          # SQLite (generado en primera ejecución)
└── README.md
```

---

## Puesta en marcha

### Frontend standalone (sin backend)
Abrir `index.html` directamente en el navegador.
Los datos se persisten en `localStorage`. Lista para usar inmediatamente.

**Credenciales del panel:**
- Usuario: `admin`
- Contraseña: `ashford2024`

### Backend API
```bash
npm install
node server.js
# API disponible en http://localhost:3001
```

---

## Esquema de base de datos

| Tabla               | Descripción                                      |
|---------------------|--------------------------------------------------|
| `appointments`      | Citas con todos sus campos y estado              |
| `clients`           | Registro de clientes                             |
| `services`          | Catálogo de servicios y precios                  |
| `staff`             | Personal del negocio                             |
| `business_config`   | Configuración general (horarios, claves API)     |
| `faqs`              | Preguntas frecuentes para chatbot/web            |
| `change_logs`       | Historial de cambios por entidad                 |
| `notification_queue`| Cola de notificaciones con estado de envío       |

---

## Canales de entrada contemplados

| Canal       | Estado         | Integración                    |
|-------------|----------------|--------------------------------|
| Web         | ✅ Activo       | `POST /api/appointments`       |
| Interno     | ✅ Activo       | Panel admin                    |
| WhatsApp    | 🔧 Preparado    | Bot → `POST /api/webhooks/inbound` |
| Llamada/IVR | 🔧 Preparado    | IVR → `POST /api/webhooks/inbound` |

---

## Integraciones preparadas

### n8n
1. Activar webhook en `business_config`: `n8n_webhook_url`
2. Todos los eventos de cita disparan `NotificationService.triggerN8n()`
3. n8n puede devolver llamadas a `POST /api/webhooks/n8n`

**Eventos disponibles:**
- `new_appointment` — nueva solicitud
- `status_change` — cambio de estado
- `appointment_confirmed` — cita confirmada
- `appointment_cancelled` — cita cancelada

### WhatsApp (Twilio / Meta API)
1. Configurar `whatsapp_api_key` en `business_config`
2. Descomentar el bloque Twilio en `NotificationService.sendWhatsApp()`
3. El chatbot inbound recibe mensajes en `POST /api/webhooks/inbound`

### Email (SMTP / SendGrid)
1. Configurar `email_smtp_host`, `email_smtp_user`, `email_smtp_pass`
2. Descomentar el bloque Nodemailer en `NotificationService.sendEmail()`

### Chatbot WhatsApp / IVR
El endpoint `GET /api/business/info` expone:
- Configuración del negocio
- Catálogo de servicios con precios
- FAQs completas

Diseñado para ser consumido por el contexto de sistema de un LLM (GPT-4, Claude, Llama) que actúe como agente de WhatsApp o voz.

---

## Flujo de estados de cita

```
new → pending → confirmed → done
         ↓            ↓
      cancelled    cancelled
```

---

## API Reference

### Público

| Método | Endpoint                    | Descripción              |
|--------|-----------------------------|--------------------------|
| POST   | `/api/appointments`         | Crear solicitud          |
| GET    | `/api/availability?date=`   | Franjas disponibles      |
| GET    | `/api/services`             | Catálogo de servicios    |
| GET    | `/api/faqs`                 | FAQs                     |
| GET    | `/api/business/info`        | Info completa del negocio|

### Admin (requiere Bearer token)

| Método | Endpoint                        | Descripción            |
|--------|---------------------------------|------------------------|
| GET    | `/api/admin/appointments`       | Listar con filtros     |
| POST   | `/api/admin/appointments`       | Crear cita             |
| PATCH  | `/api/admin/appointments/:id`   | Actualizar cita        |
| DELETE | `/api/admin/appointments/:id`   | Cancelar cita          |
| GET    | `/api/admin/stats`              | Dashboard metrics      |
| GET    | `/api/admin/logs`               | Historial de cambios   |
| GET    | `/api/admin/config`             | Leer configuración     |
| PATCH  | `/api/admin/config`             | Actualizar config      |
| GET    | `/api/admin/notifications`      | Cola de notificaciones |

### Webhooks

| Método | Endpoint                  | Descripción                       |
|--------|---------------------------|-----------------------------------|
| POST   | `/api/webhooks/inbound`   | Entrada desde WA bot / IVR / n8n  |
| POST   | `/api/webhooks/n8n`       | Callback desde n8n                |

---

## Variables de entorno

```env
PORT=3001
ADMIN_TOKEN=ashford-admin-token
```
