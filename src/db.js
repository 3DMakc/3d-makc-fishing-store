import Database from "better-sqlite3";
import bcrypt from "bcryptjs";
import dotenv from "dotenv";
dotenv.config();

export const db = new Database("./data/store.sqlite");
db.pragma("journal_mode = WAL");

export const q = {
  get: (sql, params) => db.prepare(sql).get(params),
  all: (sql, params) => db.prepare(sql).all(params),
  run: (sql, params) => db.prepare(sql).run(params),
};

export function initDb(){
  q.run(`CREATE TABLE IF NOT EXISTS categories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    slug TEXT NOT NULL UNIQUE
  )`);

  q.run(`CREATE TABLE IF NOT EXISTS products (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    slug TEXT NOT NULL UNIQUE,
    sku TEXT,
    price_uah REAL NOT NULL DEFAULT 0,
    stock INTEGER NOT NULL DEFAULT 0,
    brand TEXT,
    category_id INTEGER,
    description TEXT,
    images TEXT,
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT,
    FOREIGN KEY(category_id) REFERENCES categories(id)
  )`);

  q.run(`CREATE TABLE IF NOT EXISTS orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    full_name TEXT NOT NULL,
    phone TEXT NOT NULL,
    region TEXT,
    city TEXT NOT NULL,
    np_branch TEXT NOT NULL,
    comment TEXT,
    total_uah REAL NOT NULL,
    status TEXT NOT NULL DEFAULT 'new',
    created_at TEXT
  )`);

  q.run(`CREATE TABLE IF NOT EXISTS order_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id INTEGER NOT NULL,
    product_id INTEGER,
    name TEXT NOT NULL,
    price_uah REAL NOT NULL,
    qty INTEGER NOT NULL,
    FOREIGN KEY(order_id) REFERENCES orders(id)
  )`);

  q.run(`CREATE TABLE IF NOT EXISTS admins (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL
  )`);
}

export function ensureAdmin(){
  const user = process.env.ADMIN_USER || "admin";
  const pass = process.env.ADMIN_PASSWORD || "ChangeMeStrong123!";
  const a = q.get(`SELECT * FROM admins WHERE username=?`, [user]);
  if (!a) {
    const hash = bcrypt.hashSync(pass, 10);
    q.run(`INSERT INTO admins (username, password_hash) VALUES (?,?)`, [user, hash]);
  }
}
