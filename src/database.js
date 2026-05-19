const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

let db;

function init(userDataPath) {
  const dbPath = path.join(userDataPath, 'pts.db');
  db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL DEFAULT 'New Chat',
      model TEXT DEFAULT 'qwen2.5',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id INTEGER NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('user','assistant','system')),
      content TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(session_id) REFERENCES sessions(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS tickets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      description TEXT DEFAULT '',
      priority TEXT DEFAULT 'medium' CHECK(priority IN ('low','medium','high')),
      status TEXT DEFAULT 'backlog' CHECK(status IN ('backlog','in_progress','done')),
      score INTEGER DEFAULT 0,
      folder_path TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS ticket_interactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ticket_id INTEGER NOT NULL,
      timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(ticket_id) REFERENCES tickets(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS ticket_notes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ticket_id INTEGER NOT NULL,
      content TEXT NOT NULL,
      author TEXT DEFAULT 'user',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(ticket_id) REFERENCES tickets(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);

  // Safe ALTER TABLE to add 'score' column if it does not exist in existing database
  try {
    db.exec(`ALTER TABLE tickets ADD COLUMN score INTEGER DEFAULT 0`);
  } catch (e) {
    // Column already exists, safe to ignore
  }

  // Default settings
  const defaults = [
    ['active_model', 'qwen2.5'],
    ['voice_enabled', '1'],
    ['tts_rate', '0.95'],
    ['tts_pitch', '1.1'],
    ['workspace_path', ''],
  ];
  const upsert = db.prepare(`INSERT OR IGNORE INTO settings(key,value) VALUES(?,?)`);
  defaults.forEach(([k, v]) => upsert.run(k, v));

  return db;
}

// ── Sessions ──────────────────────────────────────────────────────────────────
function createSession(title = 'New Chat', model = 'qwen2.5') {
  return db.prepare(`INSERT INTO sessions(title,model) VALUES(?,?) RETURNING *`).get(title, model);
}

function getSessions() {
  return db.prepare(`SELECT * FROM sessions ORDER BY updated_at DESC`).all();
}

function getSession(id) {
  return db.prepare(`SELECT * FROM sessions WHERE id=?`).get(id);
}

function updateSessionTitle(id, title) {
  db.prepare(`UPDATE sessions SET title=?, updated_at=CURRENT_TIMESTAMP WHERE id=?`).run(title, id);
}

function deleteSession(id) {
  db.prepare(`DELETE FROM sessions WHERE id=?`).run(id);
}

// ── Messages ──────────────────────────────────────────────────────────────────
function addMessage(sessionId, role, content) {
  const msg = db.prepare(
    `INSERT INTO messages(session_id,role,content) VALUES(?,?,?) RETURNING *`
  ).get(sessionId, role, content);
  db.prepare(`UPDATE sessions SET updated_at=CURRENT_TIMESTAMP WHERE id=?`).run(sessionId);
  return msg;
}

function getMessages(sessionId) {
  return db.prepare(`SELECT * FROM messages WHERE session_id=? ORDER BY created_at ASC`).all(sessionId);
}

// ── Tickets ───────────────────────────────────────────────────────────────────
function recordInteraction(ticketId) {
  if (!ticketId) return;
  db.prepare(`INSERT INTO ticket_interactions(ticket_id) VALUES(?)`).run(ticketId);
  decayAndRecalculate();
}

function decayAndRecalculate() {
  db.prepare(`DELETE FROM ticket_interactions WHERE timestamp < datetime('now', '-48 hours')`).run();
  db.prepare(`UPDATE tickets SET score = (SELECT COUNT(*) FROM ticket_interactions WHERE ticket_interactions.ticket_id = tickets.id)`).run();
  db.prepare(`UPDATE tickets SET score = 9 WHERE score > 9`).run();
  db.prepare(`UPDATE tickets SET status = 'backlog' WHERE score = 0 AND status != 'done'`).run();
  db.prepare(`UPDATE tickets SET status = 'in_progress' WHERE score > 0 AND status != 'done'`).run();
}

function createTicket(title, description = '', priority = 'medium', folderPath = '') {
  return db.prepare(
    `INSERT INTO tickets(title,description,priority,folder_path) VALUES(?,?,?,?) RETURNING *`
  ).get(title, description, priority, folderPath);
}

function getTickets() {
  decayAndRecalculate();
  return db.prepare(`SELECT * FROM tickets ORDER BY score DESC, updated_at DESC`).all();
}

function getTicket(id) {
  return db.prepare(`SELECT * FROM tickets WHERE id=?`).get(id);
}

function updateTicket(id, fields) {
  const allowed = ['title','description','priority','status','folder_path'];
  const sets = Object.keys(fields).filter(k => allowed.includes(k)).map(k => `${k}=?`);
  if (!sets.length) return;
  const vals = sets.map(s => fields[s.split('=')[0]]);
  db.prepare(
    `UPDATE tickets SET ${sets.join(',')}, updated_at=CURRENT_TIMESTAMP WHERE id=?`
  ).run(...vals, id);
  // Auto-record interaction when updating ticket
  recordInteraction(id);
}

function deleteTicket(id) {
  db.prepare(`DELETE FROM tickets WHERE id=?`).run(id);
}

function addTicketNote(ticketId, content, author = 'user') {
  const note = db.prepare(
    `INSERT INTO ticket_notes(ticket_id,content,author) VALUES(?,?,?) RETURNING *`
  ).get(ticketId, content, author);
  recordInteraction(ticketId);
  return note;
}

function getTicketNotes(ticketId) {
  return db.prepare(`SELECT * FROM ticket_notes WHERE ticket_id=? ORDER BY created_at ASC`).all(ticketId);
}

// ── Settings ──────────────────────────────────────────────────────────────────
function getSetting(key) {
  const row = db.prepare(`SELECT value FROM settings WHERE key=?`).get(key);
  return row ? row.value : null;
}

function setSetting(key, value) {
  db.prepare(`INSERT OR REPLACE INTO settings(key,value) VALUES(?,?)`).run(key, String(value));
}

function getAllSettings() {
  const rows = db.prepare(`SELECT key,value FROM settings`).all();
  return Object.fromEntries(rows.map(r => [r.key, r.value]));
}

module.exports = {
  init,
  createSession, getSessions, getSession, updateSessionTitle, deleteSession,
  addMessage, getMessages,
  createTicket, getTickets, getTicket, updateTicket, deleteTicket, recordInteraction,
  addTicketNote, getTicketNotes,
  getSetting, setSetting, getAllSettings,
};
