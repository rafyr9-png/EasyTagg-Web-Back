import express from 'express';
import { v4 as uuid } from 'uuid';
import { signAccessToken } from '../lib/jwt.js';

export default function createDevRouter(db: any, SECRET: string) {
  const r = express.Router();

  // Dev-only: create or return a test user and issue an access token
  r.post('/dev/login', async (req, res) => {
    try {
      if (process.env.NODE_ENV === 'production' && !process.env.ALLOW_DEV_LOGIN)
        return res.status(403).json({ error: 'Not allowed' });
      const email = 'dev@local';
      let u: any = db.prepare('SELECT * FROM users WHERE email=?').get(email);
      if (!u) {
        const id = uuid();
        const now = new Date().toISOString();
        db.prepare(
          'INSERT INTO users(id,email,name,password_hash,email_verified,google_id,created_at) VALUES(?,?,?,?,?,?,?)'
        ).run(id, email, 'Dev User', null, 1, null, now);
        u = db.prepare('SELECT * FROM users WHERE id=?').get(id);
      }
      const token = signAccessToken(u, SECRET);
      return res.json({
        accessToken: token,
        user: { id: u.id, email: u.email, name: u.name || '' },
      });
    } catch (e: any) {
      return res.status(500).json({ error: e.message || 'dev login failed' });
    }
  });

  return r;
}
