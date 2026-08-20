import Database from 'better-sqlite3';
import { v4 as uuid } from 'uuid';
import jwt from 'jsonwebtoken';

const db = new Database('data/easytagg.sqlite');
const email = process.argv[2] || 'dev@local';
const id = uuid();
const now = () => new Date().toISOString();
try{
  db.prepare('INSERT INTO users(id,email,name,password_hash,email_verified,google_id,created_at) VALUES(?,?,?,?,?,?,?)').run(id,email,'Dev User',null,1,null,now());
  const SECRET = process.env.JWT_SECRET || 'dev-change-me';
  const token = jwt.sign({ sub: id, email }, SECRET, { expiresIn: '60m' });
  console.log(token);
}catch(e){ console.error('ERROR',e); process.exit(1) }
