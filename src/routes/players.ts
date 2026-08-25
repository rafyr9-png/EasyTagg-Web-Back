import express from 'express';
import { v4 as uuid } from 'uuid';

export default function createPlayersRouter(db: any, auth: any) {
  const r = express.Router();
  r.get('/players', auth, (req, res) => {
    const rows = db
      .prepare('SELECT * FROM players WHERE user_id=? ORDER BY name')
      .all((req as any).auth.sub);
    res.json(rows);
  });
  r.post('/players', auth, (req, res) => {
    const id = uuid();
    const nowTs = new Date().toISOString();
    const p = {
      id,
      user_id: (req as any).auth.sub,
      num: String(req.body.num || ''),
      name: String(req.body.name || ''),
      team: String(req.body.team || ''),
      role: String(req.body.role || ''),
      side: String(req.body.side || ''),
      bat: String(req.body.bat || ''),
      thr: String(req.body.thr || ''),
      position: String(req.body.position || ''),
      db_player_code: String(req.body.db_player_code || ''),
      created_at: nowTs,
      updated_at: nowTs,
    };
    db.prepare(
      'INSERT INTO players(id,user_id,num,name,team,role,side,bat,thr,position,db_player_code,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)'
    ).run(
      p.id,
      p.user_id,
      p.num,
      p.name,
      p.team,
      p.role,
      p.side,
      p.bat,
      p.thr,
      p.position,
      p.db_player_code,
      p.created_at,
      p.updated_at
    );
    res.json(p);
  });
  r.put('/players/:id', auth, (req, res) => {
    const id = String(req.params.id || '');
    const nowTs = new Date().toISOString();
    const result = db
      .prepare(
        'UPDATE players SET num=?,name=?,team=?,role=?,side=?,bat=?,thr=?,position=?,db_player_code=?,updated_at=? WHERE id=? AND user_id=?'
      )
      .run(
        String(req.body.num || ''),
        String(req.body.name || ''),
        String(req.body.team || ''),
        String(req.body.role || ''),
        String(req.body.side || ''),
        String(req.body.bat || ''),
        String(req.body.thr || ''),
        String(req.body.position || ''),
        String(req.body.db_player_code || ''),
        nowTs,
        id,
        (req as any).auth.sub
      );
    if (result.changes === 0) return res.status(404).json({ error: 'Player not found' });
    const p = db
      .prepare('SELECT * FROM players WHERE id=? AND user_id=?')
      .get(id, (req as any).auth.sub);
    res.json(p);
  });
  r.delete('/players/:id', auth, (req, res) => {
    db.prepare('DELETE FROM players WHERE id=? AND user_id=?').run(
      String(req.params.id || ''),
      (req as any).auth.sub
    );
    res.json({ ok: true });
  });
  return r;
}
