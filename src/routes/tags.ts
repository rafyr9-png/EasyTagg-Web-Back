import express from 'express';
import { v4 as uuid } from 'uuid';
import { TAG_COLUMNS } from '../lib/tagColumns.js';

export default function createTagsRouter(db: any, auth: any) {
  const r = express.Router();
  r.get('/tags', auth, (req, res) => {
    const gameId = String(req.query.game_id || '');
    if (gameId)
      return res.json(
        db
          .prepare('SELECT * FROM tags WHERE user_id=? AND game_id=? ORDER BY created_at DESC')
          .all((req as any).auth.sub, gameId)
      );
    const rows = db
      .prepare('SELECT * FROM tags WHERE user_id=? ORDER BY created_at DESC')
      .all((req as any).auth.sub);
    res.json(rows);
  });
  r.post('/tags', auth, (req, res) => {
    const t = Object.assign({}, req.body || {});
    const gameId = String(t.game_id || '');
    if (!gameId) return res.status(400).json({ error: 'game_id is required' });
    const game = db
      .prepare('SELECT id FROM games WHERE id=? AND user_id=?')
      .get(gameId, (req as any).auth.sub);
    if (!game) return res.status(404).json({ error: 'Game not found' });
    const id = uuid();
    t.tag_id = id;
    t.user_id = (req as any).auth.sub;
    t.created_at = new Date().toISOString();
    const vals = TAG_COLUMNS.map((c) => t[c] ?? null);
    const placeholders = TAG_COLUMNS.map(() => '?').join(',');
    db.prepare(`INSERT INTO tags(${TAG_COLUMNS.join(',')}) VALUES(${placeholders})`).run(...vals);
    res.json(t);
  });
  r.put('/tags/:id', auth, (req, res) => {
    const id = String(req.params.id || '');
    const t = req.body || {};
    const result = db
      .prepare(
        'UPDATE tags SET result=?,final_result=?,contact_quality=?,trajectory=?,note=? WHERE tag_id=? AND user_id=?'
      )
      .run(
        String(t.result || ''),
        String(t.final_result || ''),
        String(t.contact_quality || ''),
        String(t.trajectory || ''),
        String(t.note || ''),
        id,
        (req as any).auth.sub
      );
    if (result.changes === 0) return res.status(404).json({ error: 'Tag not found' });
    const row = db
      .prepare('SELECT * FROM tags WHERE tag_id=? AND user_id=?')
      .get(id, (req as any).auth.sub);
    res.json(row);
  });
  r.delete('/tags/:id', auth, (req, res) => {
    db.prepare('DELETE FROM tags WHERE tag_id=? AND user_id=?').run(
      String(req.params.id || ''),
      (req as any).auth.sub
    );
    res.json({ ok: true });
  });
  return r;
}
