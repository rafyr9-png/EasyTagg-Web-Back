import Database from 'better-sqlite3';
import { v4 as uuid } from 'uuid';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';

const email = process.argv[2] || 'tester@local';
const password = process.argv[3] || 'Test1234!';
const name = process.argv[4] || 'Tester';
const db = new Database('data/easytagg.sqlite');
const now = () => new Date().toISOString();
try {
  const existing = db.prepare('SELECT id FROM users WHERE email=?').get(email);
  if (existing) {
    console.log(JSON.stringify({ error: 'exists', id: existing.id, email }));
    process.exit(0);
  }
  const id = uuid();
  const hash = bcrypt.hashSync(password, 12);
  db.prepare(
    'INSERT INTO users(id,email,name,password_hash,email_verified,google_id,created_at) VALUES(?,?,?,?,?,?,?)'
  ).run(id, email, name, hash, 1, null, now());
  const SECRET = process.env.JWT_SECRET || 'dev-change-me';
  const token = jwt.sign({ sub: id, email }, SECRET, { expiresIn: '60m' });
  console.log(JSON.stringify({ id, email, name, password, token }));
} catch (e) {
  console.error(JSON.stringify({ error: e && e.message }));
  process.exit(1);
}
