import Database from 'better-sqlite3';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { mkdirSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_PATH = join(__dirname, 'content_queue.db');
const LOGS_DIR = join(__dirname, 'logs');

mkdirSync(LOGS_DIR, { recursive: true });

let db;

export function getDb() {
  if (!db) {
    db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    initSchema();
  }
  return db;
}

function initSchema() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS posts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      scheduled_at TEXT NOT NULL,
      platform TEXT NOT NULL,
      content TEXT NOT NULL,
      first_comment TEXT,
      poll_options TEXT,
      group_name TEXT,
      status TEXT DEFAULT 'pending',
      published_at TEXT,
      error TEXT,
      post_id TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_status_scheduled ON posts(status, scheduled_at);
  `);
}

export function getPendingPosts(limit = 3) {
  const db = getDb();
  const now = new Date().toISOString();
  return db.prepare(`
    SELECT * FROM posts
    WHERE status = 'pending' AND scheduled_at <= ?
    ORDER BY scheduled_at ASC
    LIMIT ?
  `).all(now, limit);
}

export function markPublished(id, postId = null) {
  const db = getDb();
  db.prepare(`
    UPDATE posts
    SET status = 'published',
        published_at = datetime('now'),
        post_id = ?
    WHERE id = ?
  `).run(postId, id);
}

export function markFailed(id, errorMessage) {
  const db = getDb();
  db.prepare(`
    UPDATE posts
    SET status = 'failed',
        published_at = datetime('now'),
        error = ?
    WHERE id = ?
  `).run(errorMessage, id);
}

export function insertPost({ scheduled_at, platform, content, first_comment, poll_options, group_name }) {
  const db = getDb();
  return db.prepare(`
    INSERT INTO posts (scheduled_at, platform, content, first_comment, poll_options, group_name)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(scheduled_at, platform, content, first_comment ?? null, poll_options ?? null, group_name ?? null);
}

export function insertPosts(posts) {
  const db = getDb();
  const insert = db.prepare(`
    INSERT INTO posts (scheduled_at, platform, content, first_comment, poll_options, group_name)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  const insertMany = db.transaction((rows) => {
    for (const row of rows) {
      insert.run(
        row.scheduled_at,
        row.platform,
        row.content,
        row.first_comment ?? null,
        row.poll_options ?? null,
        row.group_name ?? null
      );
    }
  });
  insertMany(posts);
}

export function getAllPosts(status = null) {
  const db = getDb();
  if (status) {
    return db.prepare('SELECT * FROM posts WHERE status = ? ORDER BY scheduled_at ASC').all(status);
  }
  return db.prepare('SELECT * FROM posts ORDER BY scheduled_at ASC').all();
}

export function getPostById(id) {
  return getDb().prepare('SELECT * FROM posts WHERE id = ?').get(id);
}

export function updateStatus(id, status) {
  getDb().prepare('UPDATE posts SET status = ?, error = NULL WHERE id = ?').run(status, id);
}
