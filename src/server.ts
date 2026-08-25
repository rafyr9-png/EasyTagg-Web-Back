import 'dotenv/config';
import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import Database from 'better-sqlite3';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import nodemailer from 'nodemailer';
import passport from 'passport';
import { Strategy as GoogleStrategy } from 'passport-google-oauth20';
import { v4 as uuid } from 'uuid';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import { signAccessToken } from './lib/jwt.js';

const isProduction = process.env.NODE_ENV === 'production';
const PORT = Number(process.env.PORT || 4000);
const serviceUrl = process.env.RENDER_EXTERNAL_URL || '';
const FRONTEND = process.env.FRONTEND_URL || serviceUrl || `http://localhost:5173`;
const PUBLIC_API = process.env.PUBLIC_API_URL || serviceUrl || `http://localhost:${PORT}`;
const SECRET = process.env.JWT_SECRET || (isProduction ? '' : 'dev-change-me');
const DB_FILE = process.env.DB_FILE || 'data/easytagg.sqlite';

const smtpConfigured = Boolean(
  process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS && process.env.SMTP_FROM
);

// Demo-only escape hatch: skip email verification when there's no SMTP provider set up.
// Never enable this for a deployment that holds real user data.
const skipEmailVerification = process.env.SKIP_EMAIL_VERIFICATION === 'true';

const allowedOrigins = new Set(
  (process.env.ALLOWED_ORIGINS || FRONTEND)
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean)
);

if (isProduction && SECRET.length < 32) {
  throw new Error('JWT_SECRET must contain at least 32 characters in production');
}

fs.mkdirSync(path.dirname(DB_FILE), { recursive: true });
const db = new Database(DB_FILE);
db.pragma('journal_mode = WAL');
db.exec(`CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY,email TEXT UNIQUE NOT NULL,name TEXT,password_hash TEXT,email_verified INTEGER DEFAULT 0,google_id TEXT UNIQUE,created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS tokens(id TEXT PRIMARY KEY,user_id TEXT NOT NULL,type TEXT NOT NULL,token_hash TEXT NOT NULL,expires_at TEXT NOT NULL,used_at TEXT,created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS snapshots(user_id TEXT PRIMARY KEY,data_json TEXT NOT NULL,updated_at TEXT NOT NULL);

-- Migration tables for structured backend storage
CREATE TABLE IF NOT EXISTS games(id TEXT PRIMARY KEY,user_id TEXT NOT NULL,name TEXT,date TEXT,home TEXT,away TEXT,game_type TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS players(id TEXT PRIMARY KEY,user_id TEXT NOT NULL,num TEXT,name TEXT,team TEXT,role TEXT,side TEXT,bat TEXT,thr TEXT,position TEXT,db_player_code TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS tags(tag_id TEXT PRIMARY KEY,user_id TEXT NOT NULL,game_id TEXT,game_name TEXT,game_date TEXT,home_team TEXT,away_team TEXT,game_seconds REAL,game_time TEXT,clip_start_seconds REAL,clip_start_time TEXT,clip_end_seconds REAL,clip_end_time TEXT,inning INTEGER,half TEXT,batting_side TEXT,balls_before INTEGER,strikes_before INTEGER,outs_before INTEGER,count_before TEXT,pitcher_id TEXT,pitcher TEXT,pitcher_hand TEXT,pitcher_pitch_number INTEGER,batter_id TEXT,batter TEXT,batter_hand TEXT,pitch_type TEXT,pitch_mph TEXT,zone_status TEXT,zone_x REAL,zone_y REAL,result TEXT,final_result TEXT,contact_quality TEXT,trajectory TEXT,spray_location TEXT,exit_velocity TEXT,note TEXT,created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS lineups(id TEXT PRIMARY KEY,user_id TEXT NOT NULL,game_id TEXT,player_id TEXT,slot INTEGER,role TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS history_events(id TEXT PRIMARY KEY,user_id TEXT NOT NULL,game_id TEXT,type TEXT,payload_json TEXT,created_at TEXT NOT NULL);
`);

const now = () => new Date().toISOString();
const sign = (u: any) => signAccessToken(u, SECRET);
const hashToken = (s: string) => bcrypt.hashSync(s, 10);
const publicUser = (u: any) => ({
  id: u.id,
  email: u.email,
  name: u.name || '',
  emailVerified: !!u.email_verified,
});

function refresh(res: Response, u: any) {
  const raw = uuid() + uuid();
  db.prepare('INSERT INTO tokens VALUES(?,?,?,?,?,?,?)').run(
    uuid(),
    u.id,
    'refresh',
    hashToken(raw),
    new Date(Date.now() + Number(process.env.REFRESH_TOKEN_DAYS || 30) * 864e5).toISOString(),
    null,
    now()
  );
  res.cookie('et_refresh', raw, {
    httpOnly: true,
    sameSite: 'lax',
    secure: isProduction,
    maxAge: Number(process.env.REFRESH_TOKEN_DAYS || 30) * 864e5,
  });
  return raw;
}

async function sendMail(to: string, subject: string, html: string) {
  if (!process.env.SMTP_HOST) {
    if (isProduction) throw new Error('SMTP is not configured');
    console.log('\n[DEV EMAIL]', to, subject, html, '\n');
    return;
  }
  const tr = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: process.env.SMTP_SECURE === 'true' || Number(process.env.SMTP_PORT) === 465,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  });
  await tr.sendMail({ from: process.env.SMTP_FROM, to, subject, html });
}

function issueOneTime(userId: string, type: string) {
  const raw = uuid() + uuid();
  db.prepare('INSERT INTO tokens VALUES(?,?,?,?,?,?,?)').run(
    uuid(),
    userId,
    type,
    hashToken(raw),
    new Date(Date.now() + 30 * 60e3).toISOString(),
    null,
    now()
  );
  return raw;
}

async function consume(raw: string, type: string) {
  const rows: any[] = db
    .prepare('SELECT * FROM tokens WHERE type=? AND used_at IS NULL AND expires_at>?')
    .all(type, now()) as any;
  for (const r of rows)
    if (await bcrypt.compare(raw, r.token_hash)) {
      db.prepare('UPDATE tokens SET used_at=? WHERE id=?').run(now(), r.id);
      return r.user_id;
    }
  return null;
}

passport.use(
  new GoogleStrategy(
    {
      clientID: process.env.GOOGLE_CLIENT_ID || 'disabled',
      clientSecret: process.env.GOOGLE_CLIENT_SECRET || 'disabled',
      callbackURL:
        process.env.GOOGLE_CALLBACK_URL || `http://localhost:${PORT}/api/auth/google/callback`,
    },
    (_a, _r, p, done) => {
      try {
        const email = p.emails?.[0]?.value?.toLowerCase();
        if (!email) return done(new Error('Google account has no email'));
        let u: any = db.prepare('SELECT * FROM users WHERE email=?').get(email);
        if (!u) {
          u = {
            id: uuid(),
            email,
            name: p.displayName || '',
            password_hash: null,
            email_verified: 1,
            google_id: p.id,
            created_at: now(),
          };
          db.prepare(
            'INSERT INTO users(id,email,name,password_hash,email_verified,google_id,created_at) VALUES(@id,@email,@name,@password_hash,@email_verified,@google_id,@created_at)'
          ).run(u);
        } else
          db.prepare('UPDATE users SET google_id=?,email_verified=1 WHERE id=?').run(p.id, u.id);
        done(null, u);
      } catch (e) {
        done(e as Error);
      }
    }
  )
);

const app = express();

const isLocalhostOrigin = (origin: string) => /^https?:\/\/(localhost|127\.0\.0\.1):\d+$/.test(origin);

app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin || allowedOrigins.has(origin)) return callback(null, true);
      if (!isProduction && isLocalhostOrigin(origin)) return callback(null, true);
      return callback(new Error('Origin is not allowed'));
    },
    credentials: true,
  })
);
app.use(express.json({ limit: '25mb' }));
app.use(cookieParser());
app.use(passport.initialize());

function auth(req: Request, res: Response, next: NextFunction) {
  const h = req.headers.authorization;
  if (!h?.startsWith('Bearer ')) return res.status(401).json({ error: 'Unauthorized' });
  try {
    (req as any).auth = jwt.verify(h.slice(7), SECRET);
    next();
  } catch {
    return res.status(401).json({ error: 'Session expired' });
  }
}

app.post('/api/auth/register', async (req, res) => {
  try {
    if (isProduction && !smtpConfigured && !skipEmailVerification)
      return res.status(503).json({ error: 'Email delivery is not configured' });
    const email = String(req.body.email || '')
        .trim()
        .toLowerCase(),
      password = String(req.body.password || ''),
      name = String(req.body.name || '').trim();
    if (!email || password.length < 8)
      return res
        .status(400)
        .json({ error: 'Use a valid email and password of at least 8 characters' });
    if (db.prepare('SELECT id FROM users WHERE email=?').get(email))
      return res.status(409).json({ error: 'Email already registered' });
    const u = {
      id: uuid(),
      email,
      name,
      password_hash: await bcrypt.hash(password, 12),
      email_verified: skipEmailVerification ? 1 : 0,
      google_id: null,
      created_at: now(),
    };
    db.prepare(
      'INSERT INTO users(id,email,name,password_hash,email_verified,google_id,created_at) VALUES(@id,@email,@name,@password_hash,@email_verified,@google_id,@created_at)'
    ).run(u);
    if (skipEmailVerification) {
      res.json({ ok: true, skippedVerification: true });
      return;
    }
    const t = issueOneTime(u.id, 'verify');
    await sendMail(
      email,
      'Verify your Easy Tagg account',
      `<p>Verify your account:</p><a href="${PUBLIC_API}/api/auth/verify?token=${t}">Verify email</a>`
    );
    res.json({ ok: true });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/auth/verify', async (req, res) => {
  const id = await consume(String(req.query.token || ''), 'verify');
  if (!id) return res.status(400).send('Invalid or expired verification link');
  db.prepare('UPDATE users SET email_verified=1 WHERE id=?').run(id);
  res.redirect(FRONTEND + '/?verified=1');
});

app.post('/api/auth/login', async (req, res) => {
  const email = String(req.body.email || '').toLowerCase(),
    u: any = db.prepare('SELECT * FROM users WHERE email=?').get(email);
  if (
    !u?.password_hash ||
    !(await bcrypt.compare(String(req.body.password || ''), u.password_hash))
  )
    return res.status(401).json({ error: 'Invalid email or password' });
  if (!u.email_verified)
    return res.status(403).json({ error: 'Verify your email before signing in' });
  refresh(res, u);
  res.json({ accessToken: sign(u), user: publicUser(u) });
});

app.post('/api/auth/magic/request', async (req, res) => {
  if (isProduction && !smtpConfigured)
    return res.status(503).json({ error: 'Email delivery is not configured' });
  const email = String(req.body.email || '').toLowerCase(),
    u: any = db.prepare('SELECT * FROM users WHERE email=?').get(email);
  if (u) {
    const t = issueOneTime(u.id, 'magic');
    await sendMail(
      email,
      'Easy Tagg magic sign-in link',
      `<a href="${PUBLIC_API}/api/auth/magic/consume?token=${t}">Sign in to Easy Tagg</a>`
    );
  }
  res.json({ ok: true });
});

app.get('/api/auth/magic/consume', async (req, res) => {
  const id = await consume(String(req.query.token || ''), 'magic');
  if (!id) return res.status(400).send('Invalid or expired magic link');
  const u: any = db.prepare('SELECT * FROM users WHERE id=?').get(id);
  db.prepare('UPDATE users SET email_verified=1 WHERE id=?').run(id);
  res.redirect(`${FRONTEND}/?token=${encodeURIComponent(sign(u))}`);
});

// RUTA GOOGLE OAUTH CORREGIDA (evalúa variables en tiempo real)
app.get(
  '/api/auth/google',
  (_req, res, next) => {
    const isGoogleConfigured = Boolean(
      process.env.GOOGLE_CLIENT_ID && 
      process.env.GOOGLE_CLIENT_SECRET &&
      process.env.GOOGLE_CLIENT_ID !== 'disabled'
    );

    if (!isGoogleConfigured) {
      console.error('[OAuth Error] GOOGLE_CLIENT_ID no configurado correctamente en .env');
      return res.status(503).send('Google OAuth is not configured');
    }
    next();
  },
  passport.authenticate('google', { scope: ['profile', 'email'], session: false })
);

app.get(
  '/api/auth/google/callback',
  passport.authenticate('google', { session: false, failureRedirect: FRONTEND + '/?oauth=failed' }),
  (req, res) => {
    const u: any = req.user;
    refresh(res, u);
    res.redirect(`${FRONTEND}/?token=${encodeURIComponent(sign(u))}`);
  }
);

app.get('/api/auth/me', auth, (req, res) => {
  const u: any = db.prepare('SELECT * FROM users WHERE id=?').get((req as any).auth.sub);
  if (!u) return res.status(404).json({ error: 'User not found' });
  res.json({ user: publicUser(u) });
});

app.post('/api/auth/logout', (_req, res) => {
  res.clearCookie('et_refresh');
  res.json({ ok: true });
});

app.get('/api/sync/snapshot', auth, (req, res) => {
  const row: any = db
    .prepare('SELECT data_json,updated_at FROM snapshots WHERE user_id=?')
    .get((req as any).auth.sub);
  res.json({ data: row ? JSON.parse(row.data_json) : {}, updatedAt: row?.updated_at || null });
});

app.put('/api/sync/snapshot', auth, (req, res) => {
  const data = req.body?.data;
  if (!data || typeof data !== 'object') return res.status(400).json({ error: 'Invalid snapshot' });
  db.prepare(
    'INSERT INTO snapshots(user_id,data_json,updated_at) VALUES(?,?,?) ON CONFLICT(user_id) DO UPDATE SET data_json=excluded.data_json,updated_at=excluded.updated_at'
  ).run((req as any).auth.sub, JSON.stringify(data), now());
  res.json({ ok: true, updatedAt: now() });
});

// mount modular routers
import createGamesRouter from './routes/games.js';
import createPlayersRouter from './routes/players.js';
import createTagsRouter from './routes/tags.js';
import createMigrateRouter from './routes/migrate.js';
import createDevRouter from './routes/dev.js';
app.use('/api', createGamesRouter(db, auth));
app.use('/api', createPlayersRouter(db, auth));
app.use('/api', createTagsRouter(db, auth));
app.use('/api', createMigrateRouter(db, auth));
app.use('/api', createDevRouter(db, SECRET));
app.get('/api/health', (_req, res) => res.json({ ok: true }));

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../');
const frontendDist = path.join(projectRoot, 'frontend', 'dist');
app.use(express.static(frontendDist));
app.use((req, res, next) => {
  if (req.method !== 'GET' || req.path.startsWith('/api/')) return next();
  res.sendFile(path.join(frontendDist, 'index.html'), (error) => {
    if (error) next(error);
  });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Easy Tagg API http://localhost:${PORT}`);
  console.log(`Google OAuth status: ${process.env.GOOGLE_CLIENT_ID ? 'Configurado ✅' : 'No detectado ❌'}`);
});