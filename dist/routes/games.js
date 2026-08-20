import express from 'express';
import { v4 as uuid } from 'uuid';
export default function createGamesRouter(db, auth) {
    const r = express.Router();
    r.get('/games', auth, (req, res) => {
        const rows = db
            .prepare('SELECT * FROM games WHERE user_id=? ORDER BY created_at DESC')
            .all(req.auth.sub);
        res.json(rows);
    });
    r.post('/games', auth, (req, res) => {
        const id = uuid();
        const nowTs = new Date().toISOString();
        const g = {
            id,
            user_id: req.auth.sub,
            name: String(req.body.name || 'Activity'),
            date: String(req.body.date || new Date().toISOString().slice(0, 10)),
            home: String(req.body.home || ''),
            away: String(req.body.away || ''),
            game_type: String(req.body.game_type || 'game'),
            created_at: nowTs,
            updated_at: nowTs,
        };
        db.prepare('INSERT INTO games(id,user_id,name,date,home,away,game_type,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)').run(g.id, g.user_id, g.name, g.date, g.home, g.away, g.game_type, g.created_at, g.updated_at);
        res.json(g);
    });
    r.put('/games/:id', auth, (req, res) => {
        const id = String(req.params.id || '');
        const nowTs = new Date().toISOString();
        db.prepare('UPDATE games SET name=?,date=?,home=?,away=?,game_type=?,updated_at=? WHERE id=? AND user_id=?').run(String(req.body.name || ''), String(req.body.date || ''), String(req.body.home || ''), String(req.body.away || ''), String(req.body.game_type || ''), nowTs, id, req.auth.sub);
        const g = db
            .prepare('SELECT * FROM games WHERE id=? AND user_id=?')
            .get(id, req.auth.sub);
        res.json(g);
    });
    r.delete('/games/:id', auth, (req, res) => {
        db.prepare('DELETE FROM games WHERE id=? AND user_id=?').run(String(req.params.id || ''), req.auth.sub);
        res.json({ ok: true });
    });
    return r;
}
