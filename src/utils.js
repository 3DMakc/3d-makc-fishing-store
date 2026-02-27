import bcrypt from "bcryptjs";
import dotenv from "dotenv";
import { q } from "./db.js";
dotenv.config();

export function money(v){
  const n = Number(v || 0);
  return new Intl.NumberFormat("uk-UA", { style: "currency", currency: "UAH", maximumFractionDigits: 0 }).format(n);
}

export function safe(v){
  return String(v ?? "").trim();
}

// Minimal CSV parser (comma-separated, supports quotes)
export function parseCsv(text){
  const lines = text.replace(/\r/g,"").split("\n").filter(l => l.trim().length);
  if (!lines.length) return [];
  const header = splitCsvLine(lines[0]).map(h => h.trim());
  const rows = [];
  for (let i=1;i<lines.length;i++){
    const cols = splitCsvLine(lines[i]);
    const obj = {};
    for (let j=0;j<header.length;j++){
      obj[header[j]] = (cols[j] ?? "").trim();
    }
    rows.push(obj);
  }
  return rows;
}

function splitCsvLine(line){
  const out = [];
  let cur = "";
  let inQ = false;
  for (let i=0;i<line.length;i++){
    const ch = line[i];
    if (ch === '"'){
      if (inQ && line[i+1] === '"'){ cur += '"'; i++; }
      else inQ = !inQ;
    } else if (ch === "," && !inQ){
      out.push(cur); cur = "";
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out;
}

export function isAuthed(req){
  return Boolean(req.session?.admin?.username);
}

export function requireAuth(req, user, pass){
  const u = String(user||"").trim();
  const p = String(pass||"");
  const admin = q.get(`SELECT * FROM admins WHERE username=?`, [u]);
  if (!admin) return false;
  const ok = bcrypt.compareSync(p, admin.password_hash);
  if (!ok) return false;
  req.session.admin = { username: u };
  return true;
}
