const express    = require('express');
const mysql      = require('mysql2/promise');
const cors       = require('cors');
const bodyParser = require('body-parser');
require('dotenv').config();   // ← loads .env file

// Optional deps — loaded safely so server still starts if not yet installed
let multer, XLSX;
try { multer = require('multer'); } catch(e) {
  console.warn('⚠️  multer not installed. Run: npm install  (in backend folder)');
}
try { XLSX = require('xlsx'); } catch(e) {
  console.warn('⚠️  xlsx not installed. Run: npm install  (in backend folder)');
}

const app  = express();
const PORT = process.env.PORT || 5000;

// ── CORS ── supports single URL or comma-separated list in FRONTEND_URL
const allowedOrigins = process.env.FRONTEND_URL
  ? process.env.FRONTEND_URL.split(',').map(u => u.trim()).filter(Boolean)
  : ['*'];

app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (mobile apps, curl, Postman)
    if (!origin) return callback(null, true);
    if (allowedOrigins.includes('*') || allowedOrigins.includes(origin)) {
      return callback(null, true);
    }
    return callback(new Error(`CORS: origin ${origin} not allowed`));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

// Handle preflight OPTIONS for all routes
app.options('*', cors());
app.use(bodyParser.json({ limit: '10mb' }));

// Multer: accept file uploads in memory (for Excel parsing)
const upload = multer ? multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => { cb(null, true); },
}) : null;

// ── Phone cleaner ──────────────────────────────────────────
function cleanPhone(raw) {
  if (!raw) return '';
  let s = String(raw).trim();
  if (/error/i.test(s)) return '';
  // Already a number (openpyxl-style float like 9445104589.0)
  const asNum = parseFloat(s);
  if (!isNaN(asNum) && asNum > 1e8) s = Math.round(asNum).toString();
  // Strip non-digits
  let digits = s.replace(/[^\d]/g, '');
  if (digits.startsWith('91') && digits.length === 12) digits = digits.slice(2);
  if (digits.startsWith('0')  && digits.length === 11) digits = digits.slice(1);
  if (digits.length > 10) digits = digits.slice(0, 10);
  return digits;
}

// ── Column name matcher ────────────────────────────────────
function matchCol(headers, patterns) {
  for (const h of headers) {
    const hn = h.toLowerCase().replace(/[\s_\-\.]+/g, '');
    if (patterns.some(p => hn.includes(p))) return h;
  }
  return null;
}

// ════════════════════════════════════════════════════════════
// DB CONFIG  ←  Set values in backend/.env file
// ════════════════════════════════════════════════════════════
const dbConfig = {
  host:        process.env.DB_HOST     || 'localhost',
  port:        parseInt(process.env.DB_PORT) || 3306,
  user:        process.env.DB_USER     || 'root',
  password:    process.env.DB_PASSWORD || '',
  database:    process.env.DB_NAME     || 'deeraj_crm',
  dateStrings: true,
};

async function getConn() {
  return await mysql.createConnection(dbConfig);
}

// ════════════════════════════════════════════════════════════
// AUTH HELPERS
// Token = base64(id:role:name)  — simple, no external libs
// ════════════════════════════════════════════════════════════
function makeToken(user) {
  return Buffer.from(`${user.id}:${user.role}:${user.name}`).toString('base64');
}

function parseToken(req) {
  try {
    const header = req.headers['authorization'] || '';
    const token  = header.replace('Bearer ', '').trim();
    if (!token) return null;
    const decoded = Buffer.from(token, 'base64').toString('utf8');
    const parts   = decoded.split(':');
    if (parts.length < 3) return null;
    return { id: parseInt(parts[0]), role: parts[1], name: parts.slice(2).join(':') };
  } catch { return null; }
}

function auth(req, res, next) {
  const u = parseToken(req);
  if (!u || isNaN(u.id)) return res.status(401).json({ error: 'Unauthorized – please login again' });
  req.user = u;
  next();
}

function adminOnly(req, res, next) {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin access required' });
  next();
}

// ════════════════════════════════════════════════════════════
// LOGIN
// ════════════════════════════════════════════════════════════
app.post('/api/login', async (req, res) => {
  const conn = await getConn();
  try {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ error: 'Username and password are required' });

    const [rows] = await conn.query(
      'SELECT * FROM users WHERE username = ? AND password = ? AND is_active = 1',
      [username.trim(), password.trim()]
    );

    if (!rows.length) return res.status(401).json({ error: 'Invalid username or password' });

    const user = rows[0];
    res.json({
      token: makeToken(user),
      user:  { id: user.id, name: user.name, username: user.username, role: user.role }
    });
  } catch (e) {
    console.error('Login error:', e.message);
    res.status(500).json({ error: 'Server error: ' + e.message });
  } finally { conn.end(); }
});

// ════════════════════════════════════════════════════════════
// USERS  (admin only)
// ════════════════════════════════════════════════════════════
app.get('/api/users', auth, adminOnly, async (req, res) => {
  const conn = await getConn();
  try {
    const [rows] = await conn.query(
      'SELECT id, name, username, role, is_active, created_at FROM users ORDER BY id'
    );
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
  finally { conn.end(); }
});

app.post('/api/users', auth, adminOnly, async (req, res) => {
  const conn = await getConn();
  try {
    const { name, username, password, role } = req.body;
    if (!name || !username || !password) return res.status(400).json({ error: 'name, username and password are required' });

    const [r] = await conn.query(
      'INSERT INTO users (name, username, password, role) VALUES (?, ?, ?, ?)',
      [name, username, password, role || 'agent']
    );
    const [[u]] = await conn.query('SELECT id, name, username, role, is_active FROM users WHERE id = ?', [r.insertId]);
    res.status(201).json(u);
  } catch (e) {
    if (e.code === 'ER_DUP_ENTRY') return res.status(400).json({ error: 'Username already exists' });
    res.status(500).json({ error: e.message });
  } finally { conn.end(); }
});

app.put('/api/users/:id', auth, adminOnly, async (req, res) => {
  const conn = await getConn();
  try {
    const { name, username, password, role, is_active } = req.body;
    // If password is empty string, keep the existing one
    if (password && password.trim()) {
      await conn.query(
        'UPDATE users SET name=?, username=?, password=?, role=?, is_active=? WHERE id=?',
        [name, username, password, role, is_active ?? 1, req.params.id]
      );
    } else {
      await conn.query(
        'UPDATE users SET name=?, username=?, role=?, is_active=? WHERE id=?',
        [name, username, role, is_active ?? 1, req.params.id]
      );
    }
    const [[u]] = await conn.query('SELECT id, name, username, role, is_active FROM users WHERE id = ?', [req.params.id]);
    res.json(u);
  } catch (e) { res.status(500).json({ error: e.message }); }
  finally { conn.end(); }
});

app.delete('/api/users/:id', auth, adminOnly, async (req, res) => {
  const conn = await getConn();
  try {
    await conn.query('UPDATE users SET is_active = 0 WHERE id = ?', [req.params.id]);
    res.json({ message: 'User deactivated' });
  } finally { conn.end(); }
});

// ════════════════════════════════════════════════════════════
// STATS — clean version, no messy string concatenation
// ════════════════════════════════════════════════════════════
app.get('/api/stats', auth, async (req, res) => {
  const conn = await getConn();
  try {
    const isAdmin = req.user.role === 'admin';
    const userId  = req.user.id;

    // ── Build dynamic WHERE from optional query filters ──
    const conditions = [];
    const baseParams = [];

    // Role filter: agent only sees own leads
    if (!isAdmin) {
      conditions.push('assigned_to = ?');
      baseParams.push(userId);
    }

    // Optional filters from query string
    const { date, lead_source, priority, status, assigned_to } = req.query;

    if (date) {
      conditions.push("DATE(first_calling_date) = ?");
      baseParams.push(date);
    }
    if (lead_source) {
      conditions.push('lead_source = ?');
      baseParams.push(lead_source);
    }
    if (priority) {
      conditions.push('priority = ?');
      baseParams.push(priority);
    }
    if (status) {
      conditions.push('status = ?');
      baseParams.push(status);
    }
    if (isAdmin && assigned_to) {
      conditions.push('assigned_to = ?');
      baseParams.push(parseInt(assigned_to));
    }

    const baseWhere = conditions.length ? conditions.join(' AND ') : '1=1';

    const q = async (sql, params = []) => conn.query(sql, params);

    const [[{ total }]]        = await q(`SELECT COUNT(*) AS total FROM leads WHERE ${baseWhere}`, baseParams);
    const [byCategory]         = await q(`SELECT call_category, COUNT(*) AS count FROM leads WHERE ${baseWhere} GROUP BY call_category`, baseParams);
    const [bySecondCategory]   = await q(`SELECT second_call_category, COUNT(*) AS count FROM leads WHERE ${baseWhere} AND second_call_category != '' GROUP BY second_call_category`, baseParams);
    const [[{ ordersBooked }]]   = await q(`SELECT COUNT(*) AS ordersBooked FROM leads WHERE ${baseWhere} AND order_booked='YES'`, baseParams);
    const [[{ totalOrderAmt }]]  = await q(`SELECT COALESCE(SUM(order_amount),0) AS totalOrderAmt FROM leads WHERE ${baseWhere} AND order_booked='YES'`, baseParams);
    const [[{ quotesSent }]]     = await q(`SELECT COUNT(*) AS quotesSent  FROM leads WHERE ${baseWhere} AND quote_sent='YES'`, baseParams);
    const [[{ totalQuoteAmt }]]  = await q(`SELECT COALESCE(SUM(quote_amount),0) AS totalQuoteAmt FROM leads WHERE ${baseWhere} AND quote_sent='YES'`, baseParams);
    const [bookedByMonth]        = await q(`SELECT DATE_FORMAT(order_date,'%b %Y') AS month, COUNT(*) AS count, COALESCE(SUM(order_amount),0) AS amount FROM leads WHERE ${baseWhere} AND order_booked='YES' AND order_date IS NOT NULL GROUP BY month ORDER BY MIN(order_date) DESC LIMIT 6`, baseParams);
    const [[{ highPriority }]] = await q(`SELECT COUNT(*) AS highPriority FROM leads WHERE ${baseWhere} AND priority='HIGH'`, baseParams);
    const [[{ converted }]]    = await q(`SELECT COUNT(*) AS converted    FROM leads WHERE ${baseWhere} AND status='CONVERTED'`, baseParams);
    const [byProjectType]      = await q(`SELECT project_type, COUNT(*) AS count FROM leads WHERE ${baseWhere} AND project_type != '' GROUP BY project_type ORDER BY count DESC`, baseParams);
    const [byLeadSource]       = await q(`SELECT lead_source, COUNT(*) AS count FROM leads WHERE ${baseWhere} AND lead_source != '' GROUP BY lead_source`, baseParams);

    // Call log stats — respect same filters where applicable
    const callConditions = isAdmin ? [] : [`cl.user_id = ?`];
    const callParams = isAdmin ? [...baseParams] : [userId, ...baseParams.slice(isAdmin ? 0 : 1)];
    if (!isAdmin) { callConditions.push('1=1'); }
    const callWhere = isAdmin ? '1=1' : 'cl.user_id = ?';
    const callBaseParams = isAdmin ? [] : [userId];
    const [[{ totalCalls }]]  = await q(`SELECT COUNT(*) AS totalCalls FROM call_logs cl WHERE ${callWhere}`, callBaseParams);
    const [callsByCategory]   = await q(`SELECT call_category, COUNT(*) AS count FROM call_logs cl WHERE ${callWhere} GROUP BY call_category`, callBaseParams);

    // WA stats
    const waWhere = isAdmin ? '1=1' : 'wl.user_id = ?';
    const waBaseParams = isAdmin ? [] : [userId];
    const [[{ totalWA }]]  = await q(`SELECT COUNT(*) AS totalWA FROM whatsapp_logs wl WHERE ${waWhere}`, waBaseParams);
    const [waByCategory]   = await q(`SELECT category, COUNT(*) AS count FROM whatsapp_logs wl WHERE ${waWhere} GROUP BY category`, waBaseParams);

    // Agent breakdown (admin only) — full per-agent stats
    let agentStats = [];
    if (isAdmin) {
      [agentStats] = await q(`
        SELECT u.id, u.name,
          COUNT(DISTINCT l.id)                          AS total_leads,
          SUM(l.order_booked = 'YES')                   AS orders,
          SUM(l.quote_sent   = 'YES')                   AS quotes,
          COALESCE(SUM(CASE WHEN l.order_booked='YES' THEN l.order_amount ELSE 0 END),0) AS order_amount,
          SUM(l.priority = 'Hot Lead')                  AS hot_leads,
          SUM(l.call_category = 'FOLLOW UP')            AS follow_ups,
          SUM(l.call_category = 'NOT INTERESTED')       AS not_interested,
          COUNT(DISTINCT cl.id)                         AS calls,
          COUNT(DISTINCT wl.id)                         AS whatsapps
        FROM users u
        LEFT JOIN leads          l  ON l.assigned_to = u.id
        LEFT JOIN call_logs      cl ON cl.user_id    = u.id
        LEFT JOIN whatsapp_logs  wl ON wl.user_id    = u.id
        WHERE u.role = 'agent' AND u.is_active = 1
        GROUP BY u.id, u.name
        ORDER BY orders DESC, total_leads DESC
      `);
    }

    res.json({
      total, byCategory, bySecondCategory,
      ordersBooked, totalOrderAmt, quotesSent, totalQuoteAmt,
      bookedByMonth,
      highPriority, converted,
      byProjectType, byLeadSource,
      totalCalls, callsByCategory,
      totalWA, waByCategory,
      agentStats
    });
  } catch (e) {
    console.error('Stats error:', e.message);
    res.status(500).json({ error: e.message });
  } finally { conn.end(); }
});

// ════════════════════════════════════════════════════════════
// LEADS
// ════════════════════════════════════════════════════════════
app.get('/api/leads', auth, async (req, res) => {
  const conn = await getConn();
  try {
    const {
      search, call_category, quote_sent, order_booked,
      priority, status, assigned_to, page = 1, limit = 20
    } = req.query;

    const where  = [];
    const params = [];

    // Agents see only their leads
    if (req.user.role === 'agent') {
      where.push('l.assigned_to = ?');
      params.push(req.user.id);
    } else if (assigned_to) {
      // Admin filtered to a specific agent
      where.push('l.assigned_to = ?');
      params.push(parseInt(assigned_to));
    } else {
      // Admin with no agent filter: show only UNASSIGNED leads
      where.push('l.assigned_to IS NULL');
    }

    if (search) {
      where.push('(l.name LIKE ? OR l.primary_phone LIKE ? OR l.location LIKE ?)');
      params.push(`%${search}%`, `%${search}%`, `%${search}%`);
    }
    if (call_category) { where.push('l.call_category = ?');  params.push(call_category); }
    if (quote_sent)    { where.push('l.quote_sent = ?');      params.push(quote_sent); }
    if (order_booked)  { where.push('l.order_booked = ?');    params.push(order_booked); }
    if (priority)      { where.push('l.priority = ?');        params.push(priority); }
    if (status)        { where.push('l.status = ?');          params.push(status); }

    const wc     = where.length ? 'WHERE ' + where.join(' AND ') : '';
    const offset = (parseInt(page) - 1) * parseInt(limit);

    const [rows] = await conn.query(
      `SELECT l.*,
              u1.name AS created_by_name,
              u2.name AS assigned_to_name
       FROM leads l
       LEFT JOIN users u1 ON l.created_by  = u1.id
       LEFT JOIN users u2 ON l.assigned_to = u2.id
       ${wc}
       ORDER BY l.created_at DESC
       LIMIT ? OFFSET ?`,
      [...params, parseInt(limit), parseInt(offset)]
    );

    const [[{ total }]] = await conn.query(
      `SELECT COUNT(*) AS total FROM leads l ${wc}`, params
    );

    res.json({ data: rows, total, page: parseInt(page), limit: parseInt(limit) });
  } catch (e) {
    console.error('Get leads error:', e.message);
    res.status(500).json({ error: e.message });
  } finally { conn.end(); }
});

// ════════════════════════════════════════════════════════════
// PARSE EXCEL / CSV  →  returns rows as JSON (no DB write)
// ════════════════════════════════════════════════════════════
app.post('/api/leads/parse-excel', auth, (req, res, next) => {
  // Check deps are installed
  if (!multer || !XLSX) {
    return res.status(500).json({
      error: 'Server missing packages. Please run: cd backend && npm install',
    });
  }
  // Apply multer middleware dynamically
  upload.single('file')(req, res, (err) => {
    if (err) return res.status(400).json({ error: 'File upload error: ' + err.message });
    next();
  });
}, (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded. Make sure you are sending the file as form-data with key "file".' });

    const wb = XLSX.read(req.file.buffer, { type: 'buffer' });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const raw = XLSX.utils.sheet_to_json(ws, { defval: '' });

    if (!raw || raw.length === 0) {
      return res.status(400).json({ error: 'No data rows found in the file' });
    }

    const headers = Object.keys(raw[0]);
    const nameCol  = matchCol(headers, ['name','customername','fullname','client','customer']);
    const phoneCol = matchCol(headers, ['phone','mobile','contactno','contactno','contact','cell','phoneno','mobileno','ph','no']);
    const emailCol = matchCol(headers, ['email','gmail','mail','emailid','emailaddress']);

    if (!nameCol && !phoneCol) {
      return res.status(400).json({
        error: 'Could not find name/phone columns. Found: ' + headers.join(', '),
      });
    }

    const rows = raw.map((r, i) => {
      const name  = nameCol  ? String(r[nameCol]  || '').trim() : '';
      const phone = phoneCol ? cleanPhone(r[phoneCol]) : '';
      const email = emailCol ? String(r[emailCol] || '').trim() : '';
      return { name, primary_phone: phone, email, _row: i + 2 };
    }).filter(r => r.name || r.primary_phone);

    res.json({ rows, total: rows.length });
  } catch (e) {
    console.error('parse-excel error:', e.message);
    res.status(500).json({ error: 'Failed to parse file: ' + e.message });
  }
});

// ════════════════════════════════════════════════════════════
// BULK IMPORT LEADS
// ════════════════════════════════════════════════════════════
// POST /api/leads/bulk-import
// Body: { leads: [{ name, email, primary_phone, ... }] }
app.post('/api/leads/bulk-import', auth, async (req, res) => {
  const conn = await getConn();
  try {
    const { leads } = req.body;
    if (!Array.isArray(leads) || leads.length === 0) {
      return res.status(400).json({ error: 'No leads provided' });
    }
    if (leads.length > 500) {
      return res.status(400).json({ error: 'Max 500 leads per import' });
    }

    let inserted = 0;
    let skipped  = 0;
    const errors = [];

    for (const row of leads) {
      const name  = (row.name  || '').trim();
      const phone = (row.primary_phone || '').toString().trim();
      const email = (row.email || '').trim();

      if (!name || !phone) { skipped++; continue; }

      // Skip if same phone already exists
      const [existing] = await conn.query(
        'SELECT id FROM leads WHERE primary_phone = ?', [phone]
      );
      if (existing.length > 0) { skipped++; continue; }

      try {
        await conn.query(
          `INSERT INTO leads
             (created_by, assigned_to, name, primary_phone, alternate_phone,
              location, project_type, lead_source, priority, status,
              caller_name, call_category)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
          [
            req.user.id,
            row.assigned_to || null,
            name,
            phone,
            email,           // store email in alternate_phone field for now
            row.location     || '',
            row.project_type || '',
            row.lead_source  || '',
            row.priority     || 'MEDIUM',
            row.status       || 'ACTIVE',
            row.caller_name  || '',
            row.call_category|| 'FOLLOW UP',
          ]
        );
        inserted++;
      } catch (e) {
        errors.push({ row: name, error: e.message });
      }
    }

    res.json({ inserted, skipped, errors });
  } catch (e) {
    res.status(500).json({ error: e.message });
  } finally { conn.end(); }
});

// PUT /api/leads/bulk-assign  — admin only — MUST be before /:id routes
app.put('/api/leads/bulk-assign', auth, adminOnly, async (req, res) => {
  let conn;
  try {
    const { lead_ids, assigned_to } = req.body;
    console.log('bulk-assign called. body:', JSON.stringify(req.body));
    console.log('user:', JSON.stringify(req.user));

    if (!Array.isArray(lead_ids) || lead_ids.length === 0)
      return res.status(400).json({ error: 'No leads selected' });

    const cleanIds = lead_ids.map(id => parseInt(id)).filter(id => !isNaN(id));
    if (cleanIds.length === 0)
      return res.status(400).json({ error: 'Invalid lead IDs' });

    const agentId = assigned_to ? parseInt(assigned_to) : null;
    console.log('cleanIds:', cleanIds, 'agentId:', agentId);

    conn = await getConn();
    const placeholders = cleanIds.map(() => '?').join(',');
    const sql = `UPDATE leads SET assigned_to = ? WHERE id IN (${placeholders})`;
    console.log('SQL:', sql, 'params:', [agentId, ...cleanIds]);

    const [result] = await conn.query(sql, [agentId, ...cleanIds]);
    console.log('bulk-assign OK, affectedRows:', result.affectedRows);
    res.json({ updated: cleanIds.length });
  } catch (e) {
    console.error('Bulk assign ERROR:', e.message);
    console.error(e.stack);
    res.status(500).json({ error: e.message });
  } finally {
    if (conn) { try { conn.end(); } catch(_){} }
  }
});

app.get('/api/leads/:id', auth, async (req, res) => {
  if (isNaN(parseInt(req.params.id))) return res.status(404).json({ error: 'Not found' });
  const conn = await getConn();
  try {
    const [rows] = await conn.query(
      `SELECT l.*, u1.name AS created_by_name, u2.name AS assigned_to_name
       FROM leads l
       LEFT JOIN users u1 ON l.created_by  = u1.id
       LEFT JOIN users u2 ON l.assigned_to = u2.id
       WHERE l.id = ?`,
      [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Lead not found' });

    // Agents can only view their own leads
    if (req.user.role === 'agent' && rows[0].assigned_to !== req.user.id)
      return res.status(403).json({ error: 'Access denied' });

    res.json(rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
  finally { conn.end(); }
});

const nullify = v => (v === '' || v === undefined || v === null) ? null : v;

app.post('/api/leads', auth, async (req, res) => {
  const conn = await getConn();
  try {
    const f = req.body;
    const assignedTo = req.user.role === 'admin' ? (f.assigned_to || req.user.id) : req.user.id;

    const [r] = await conn.query(
      `INSERT INTO leads (
        created_by, assigned_to,
        name, primary_phone, alternate_phone, location, project_type, lead_source, priority, status, highlight_color,
        caller_name, first_calling_date, call_category, first_call_remark,
        quote_sent, quote_sent_date, quote_amount,
        order_booked, order_date, order_amount,
        second_caller_name, second_calling_date, second_call_category, second_call_remark,
        third_caller_name,  third_calling_date,  third_call_category,  third_call_remark,
        latest_whatsapp_date, whatsapp_category, whatsapp_remark
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        req.user.id, assignedTo,
        f.name, f.primary_phone, f.alternate_phone || '', f.location || '', f.project_type || '', f.lead_source || '', f.priority || 'MEDIUM', f.status || 'ACTIVE', nullify(f.highlight_color),
        f.caller_name || '', nullify(f.first_calling_date), f.call_category || 'FOLLOW UP', f.first_call_remark || '',
        f.quote_sent || '', nullify(f.quote_sent_date), nullify(f.quote_amount),
        f.order_booked || '', nullify(f.order_date), nullify(f.order_amount),
        f.second_caller_name || '', nullify(f.second_calling_date), f.second_call_category || '', f.second_call_remark || '',
        f.third_caller_name  || '', nullify(f.third_calling_date),  f.third_call_category  || '', f.third_call_remark  || '',
        nullify(f.latest_whatsapp_date), f.whatsapp_category || '', f.whatsapp_remark || ''
      ]
    );
    const [[lead]] = await conn.query('SELECT * FROM leads WHERE id = ?', [r.insertId]);
    res.status(201).json(lead);
  } catch (e) {
    console.error('Create lead error:', e.message);
    res.status(500).json({ error: e.message });
  } finally { conn.end(); }
});

app.put('/api/leads/:id', auth, async (req, res) => {
  // Safety guard — reject non-numeric IDs so named routes can never fall through
  if (isNaN(parseInt(req.params.id))) {
    return res.status(404).json({ error: `Unknown route: PUT /api/leads/${req.params.id}` });
  }
  const conn = await getConn();
  try {
    const f = req.body;
    const assignedTo = req.user.role === 'admin' ? (f.assigned_to || null) : req.user.id;

    await conn.query(
      `UPDATE leads SET
        assigned_to=?,
        name=?, primary_phone=?, alternate_phone=?, location=?, project_type=?, lead_source=?, priority=?, status=?, highlight_color=?,
        caller_name=?, first_calling_date=?, call_category=?, first_call_remark=?,
        quote_sent=?, quote_sent_date=?, quote_amount=?,
        order_booked=?, order_date=?, order_amount=?,
        second_caller_name=?, second_calling_date=?, second_call_category=?, second_call_remark=?,
        third_caller_name=?,  third_calling_date=?,  third_call_category=?,  third_call_remark=?,
        latest_whatsapp_date=?, whatsapp_category=?, whatsapp_remark=?
       WHERE id = ?`,
      [
        assignedTo,
        f.name, f.primary_phone, f.alternate_phone || '', f.location || '', f.project_type || '', f.lead_source || '', f.priority || 'MEDIUM', f.status || 'ACTIVE', nullify(f.highlight_color),
        f.caller_name || '', nullify(f.first_calling_date), f.call_category || 'FOLLOW UP', f.first_call_remark || '',
        f.quote_sent || '', nullify(f.quote_sent_date), nullify(f.quote_amount),
        f.order_booked || '', nullify(f.order_date), nullify(f.order_amount),
        f.second_caller_name || '', nullify(f.second_calling_date), f.second_call_category || '', f.second_call_remark || '',
        f.third_caller_name  || '', nullify(f.third_calling_date),  f.third_call_category  || '', f.third_call_remark  || '',
        nullify(f.latest_whatsapp_date), f.whatsapp_category || '', f.whatsapp_remark || '',
        req.params.id
      ]
    );
    const [[updated]] = await conn.query('SELECT * FROM leads WHERE id = ?', [req.params.id]);
    res.json(updated);
  } catch (e) {
    console.error('Update lead error:', e.message);
    res.status(500).json({ error: e.message });
  } finally { conn.end(); }
});

app.delete('/api/leads/:id', auth, adminOnly, async (req, res) => {
  if (isNaN(parseInt(req.params.id))) return res.status(404).json({ error: 'Not found' });
  const conn = await getConn();
  try {
    await conn.query('DELETE FROM leads WHERE id = ?', [req.params.id]);
    res.json({ message: 'Lead deleted' });
  } catch (e) { res.status(500).json({ error: e.message }); }
  finally { conn.end(); }
});

// ════════════════════════════════════════════════════════════
// CALL LOGS
// ════════════════════════════════════════════════════════════
app.get('/api/leads/:id/calls', auth, async (req, res) => {
  const conn = await getConn();
  try {
    const [rows] = await conn.query(
      `SELECT cl.*, u.name AS agent_name
       FROM call_logs cl
       JOIN users u ON cl.user_id = u.id
       WHERE cl.lead_id = ?
       ORDER BY cl.call_date ASC, cl.id ASC`,
      [req.params.id]
    );
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
  finally { conn.end(); }
});

app.post('/api/leads/:id/calls', auth, async (req, res) => {
  const conn = await getConn();
  try {
    const { call_date, call_category, remark } = req.body;
    if (!call_date || !call_category) return res.status(400).json({ error: 'call_date and call_category are required' });

    const [[{ cnt }]] = await conn.query(
      'SELECT COUNT(*) + 1 AS cnt FROM call_logs WHERE lead_id = ?', [req.params.id]
    );

    const [r] = await conn.query(
      'INSERT INTO call_logs (lead_id, user_id, call_number, call_date, call_category, remark) VALUES (?,?,?,?,?,?)',
      [req.params.id, req.user.id, cnt, call_date, call_category, remark || '']
    );

    const [[log]] = await conn.query(
      `SELECT cl.*, u.name AS agent_name FROM call_logs cl
       JOIN users u ON cl.user_id = u.id WHERE cl.id = ?`,
      [r.insertId]
    );
    res.status(201).json(log);
  } catch (e) { res.status(500).json({ error: e.message }); }
  finally { conn.end(); }
});

app.delete('/api/calls/:id', auth, adminOnly, async (req, res) => {
  const conn = await getConn();
  try {
    await conn.query('DELETE FROM call_logs WHERE id = ?', [req.params.id]);
    res.json({ message: 'Call log deleted' });
  } finally { conn.end(); }
});

// ════════════════════════════════════════════════════════════
// WHATSAPP LOGS
// ════════════════════════════════════════════════════════════
app.get('/api/leads/:id/whatsapp', auth, async (req, res) => {
  const conn = await getConn();
  try {
    const [rows] = await conn.query(
      `SELECT wl.*, u.name AS agent_name
       FROM whatsapp_logs wl
       JOIN users u ON wl.user_id = u.id
       WHERE wl.lead_id = ?
       ORDER BY wl.sent_date ASC, wl.id ASC`,
      [req.params.id]
    );
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
  finally { conn.end(); }
});

app.post('/api/leads/:id/whatsapp', auth, async (req, res) => {
  const conn = await getConn();
  try {
    const { sent_date, category, message_type, remark } = req.body;
    if (!sent_date || !category) return res.status(400).json({ error: 'sent_date and category are required' });

    const [r] = await conn.query(
      'INSERT INTO whatsapp_logs (lead_id, user_id, sent_date, category, message_type, remark) VALUES (?,?,?,?,?,?)',
      [req.params.id, req.user.id, sent_date, category, message_type || 'SENT', remark || '']
    );

    const [[log]] = await conn.query(
      `SELECT wl.*, u.name AS agent_name FROM whatsapp_logs wl
       JOIN users u ON wl.user_id = u.id WHERE wl.id = ?`,
      [r.insertId]
    );
    res.status(201).json(log);
  } catch (e) { res.status(500).json({ error: e.message }); }
  finally { conn.end(); }
});

app.delete('/api/whatsapp/:id', auth, adminOnly, async (req, res) => {
  const conn = await getConn();
  try {
    await conn.query('DELETE FROM whatsapp_logs WHERE id = ?', [req.params.id]);
    res.json({ message: 'WhatsApp log deleted' });
  } finally { conn.end(); }
});




// ════════════════════════════════════════════════════════════

// ════════════════════════════════════════════════════════════
// PASSWORD CHANGE WITH OTP  (pure in-memory, no DB needed)
// ════════════════════════════════════════════════════════════
const otpStore = new Map();
function generateOTP()       { return String(Math.floor(100000 + Math.random() * 900000)); }
function generateSessionId() { return Math.random().toString(36).slice(2) + Date.now().toString(36); }

// STEP 1 — Generate OTP for an agent (called from admin UI)
app.post('/api/password/request-otp', async (req, res) => {
  const conn = await getConn();
  try {
    const { username } = req.body;
    if (!username) return res.status(400).json({ error: 'Username is required' });

    const [[user]] = await conn.query(
      'SELECT id, name, username FROM users WHERE username = ? AND is_active = 1',
      [username.trim()]
    );
    if (!user) return res.status(404).json({ error: 'Username not found' });

    const otp       = generateOTP();
    const sessionId = generateSessionId();
    const expires   = Date.now() + 10 * 60 * 1000;

    otpStore.set(sessionId, { userId: user.id, username: user.username, name: user.name, otp, expires, verified: false });
    console.log(`\n🔑 OTP CREATED — ${user.name} | OTP: ${otp} | sid: ${sessionId} | store size: ${otpStore.size}\n`);

    res.json({ sessionId, otp, agentName: user.name, message: `OTP for ${user.name}: ${otp}` });
  } catch(e) { res.status(500).json({ error: e.message }); }
  finally { conn.end(); }
});

// STEP 2 — Agent verifies OTP
app.post('/api/password/verify-otp', (req, res) => {
  const { sessionId, otp } = req.body;
  if (!sessionId || !otp) return res.status(400).json({ error: 'sessionId and otp are required' });

  const sid       = String(sessionId).trim();
  const submitted = String(otp).trim();

  console.log(`\n🔍 VERIFY sid="${sid}" otp="${submitted}" storeSize=${otpStore.size}`);
  console.log(`   keys: [${[...otpStore.keys()].join(' | ')}]`);

  const record = otpStore.get(sid);
  if (!record) return res.status(400).json({ error: 'Session not found. Generate a new OTP from admin.' });
  if (Date.now() > record.expires) { otpStore.delete(sid); return res.status(400).json({ error: 'OTP expired. Generate a new OTP.' }); }

  const stored = String(record.otp).trim();
  console.log(`   stored="${stored}" match=${submitted === stored}`);

  if (submitted !== stored) return res.status(400).json({ error: 'Incorrect OTP. Try again.' });

  record.verified = true;
  res.json({ message: 'OTP verified', agentName: record.name });
});

// STEP 3 — Set new password
app.post('/api/password/confirm', async (req, res) => {
  const conn = await getConn();
  try {
    const { sessionId, newPassword } = req.body;
    if (!sessionId || !newPassword) return res.status(400).json({ error: 'sessionId and newPassword are required' });
    if (newPassword.length < 6)     return res.status(400).json({ error: 'Password must be at least 6 characters' });

    const sid    = String(sessionId).trim();
    const record = otpStore.get(sid);
    if (!record || !record.verified) return res.status(400).json({ error: 'OTP not verified. Please verify OTP first.' });
    if (Date.now() > record.expires) { otpStore.delete(sid); return res.status(400).json({ error: 'Session expired. Start again.' }); }

    await conn.query('UPDATE users SET password = ? WHERE id = ?', [newPassword, record.userId]);
    otpStore.delete(sid);
    console.log(`✅ Password changed: ${record.name}`);
    res.json({ message: 'Password changed successfully' });
  } catch(e) { res.status(500).json({ error: e.message }); }
  finally { conn.end(); }
});

// SERVICE CALLS
// ════════════════════════════════════════════════════════════

const CREATE_SERVICE_CALLS = `
  CREATE TABLE IF NOT EXISTS service_calls (
    id          INT AUTO_INCREMENT PRIMARY KEY,
    created_by  INT NOT NULL,
    name        VARCHAR(150) NOT NULL,
    phone       VARCHAR(20)  NOT NULL,
    department  VARCHAR(100) NOT NULL,
    description TEXT,
    status      ENUM('Open','In Progress','Resolved') DEFAULT 'Open',
    created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )
`;

// GET all service calls (admin: all, agent: own)
app.get('/api/service-calls', auth, async (req, res) => {
  const conn = await getConn();
  try {
    await conn.query(CREATE_SERVICE_CALLS);
    const isAdmin = req.user.role === 'admin';
    const [rows] = await conn.query(
      `SELECT sc.*, u.name AS created_by_name
       FROM service_calls sc
       JOIN users u ON sc.created_by = u.id
       ${isAdmin ? '' : 'WHERE sc.created_by = ?'}
       ORDER BY sc.created_at DESC`,
      isAdmin ? [] : [req.user.id]
    );
    res.json(rows);
  } catch(e) { res.status(500).json({ error: e.message }); }
  finally { conn.end(); }
});

// POST create service call
app.post('/api/service-calls', auth, async (req, res) => {
  const conn = await getConn();
  try {
    await conn.query(CREATE_SERVICE_CALLS);
    const { name, phone, department, description } = req.body;
    if (!name || !phone || !department) return res.status(400).json({ error: 'Name, phone and department are required' });
    const [r] = await conn.query(
      'INSERT INTO service_calls (created_by, name, phone, department, description) VALUES (?,?,?,?,?)',
      [req.user.id, name, phone, department, description || '']
    );
    const [[sc]] = await conn.query(
      `SELECT sc.*, u.name AS created_by_name FROM service_calls sc JOIN users u ON sc.created_by=u.id WHERE sc.id=?`,
      [r.insertId]
    );
    res.status(201).json(sc);
  } catch(e) { res.status(500).json({ error: e.message }); }
  finally { conn.end(); }
});

// PUT update status (admin only)
app.put('/api/service-calls/:id', auth, adminOnly, async (req, res) => {
  const conn = await getConn();
  try {
    await conn.query(CREATE_SERVICE_CALLS);
    const { status } = req.body;
    await conn.query('UPDATE service_calls SET status=? WHERE id=?', [status, req.params.id]);
    res.json({ message: 'Updated' });
  } catch(e) { res.status(500).json({ error: e.message }); }
  finally { conn.end(); }
});

// DELETE service call (admin only)
app.delete('/api/service-calls/:id', auth, adminOnly, async (req, res) => {
  const conn = await getConn();
  try {
    await conn.query(CREATE_SERVICE_CALLS);
    await conn.query('DELETE FROM service_calls WHERE id=?', [req.params.id]);
    res.json({ message: 'Deleted' });
  } catch(e) { res.status(500).json({ error: e.message }); }
  finally { conn.end(); }
});


// ── Health check (useful for Render uptime checks)
app.get('/', (req, res) => res.json({ status: 'ok', message: 'Deeraj CRM API is running' }));
app.get('/api', (req, res) => res.json({ status: 'ok', message: 'Deeraj CRM API is running' }));

// ── 404 catch-all for unknown routes
app.use((req, res) => {
  res.status(404).json({ error: `Route not found: ${req.method} ${req.originalUrl}` });
});

// ════════════════════════════════════════════════════════════
app.listen(PORT, () => {
  console.log(`✅ Deeraj CRM Server running → http://localhost:${PORT}`);
  console.log(`   DB: ${dbConfig.database} on ${dbConfig.host}`);
});