import express from 'express';
import { v4 as uuid } from 'uuid';
export default function createTagsRouter(db, auth) {
    const r = express.Router();
    r.get('/tags', auth, (req, res) => {
        const gameId = String(req.query.game_id || '');
        if (gameId)
            return res.json(db
                .prepare('SELECT * FROM tags WHERE user_id=? AND game_id=? ORDER BY created_at DESC')
                .all(req.auth.sub, gameId));
        const rows = db
            .prepare('SELECT * FROM tags WHERE user_id=? ORDER BY created_at DESC')
            .all(req.auth.sub);
        res.json(rows);
    });
    r.post('/tags', auth, (req, res) => {
        const t = Object.assign({}, req.body || {});
        const id = uuid();
        t.tag_id = id;
        t.user_id = req.auth.sub;
        t.created_at = new Date().toISOString();
        const cols = [
            'tag_id',
            'user_id',
            'game_id',
            'game_name',
            'game_date',
            'home_team',
            'away_team',
            'game_seconds',
            'game_time',
            'clip_start_seconds',
            'clip_start_time',
            'clip_end_seconds',
            'clip_end_time',
            'inning',
            'half',
            'batting_side',
            'balls_before',
            'strikes_before',
            'outs_before',
            'count_before',
            'pitcher_id',
            'pitcher',
            'pitcher_hand',
            'pitcher_pitch_number',
            'batter_id',
            'batter',
            'batter_hand',
            'pitch_type',
            'pitch_mph',
            'zone_status',
            'zone_x',
            'zone_y',
            'result',
            'final_result',
            'contact_quality',
            'trajectory',
            'spray_location',
            'exit_velocity',
            'note',
            'created_at',
        ];
        const vals = cols.map((c) => t[c] ?? null);
        const placeholders = cols.map(() => '?').join(',');
        db.prepare(`INSERT INTO tags(${cols.join(',')}) VALUES(${placeholders})`).run(...vals);
        res.json(t);
    });
    r.put('/tags/:id', auth, (req, res) => {
        const id = String(req.params.id || '');
        const t = req.body || {};
        db.prepare('UPDATE tags SET result=?,final_result=?,contact_quality=?,trajectory=?,note=? WHERE tag_id=? AND user_id=?').run(String(t.result || ''), String(t.final_result || ''), String(t.contact_quality || ''), String(t.trajectory || ''), String(t.note || ''), id, req.auth.sub);
        const row = db
            .prepare('SELECT * FROM tags WHERE tag_id=? AND user_id=?')
            .get(id, req.auth.sub);
        res.json(row);
    });
    r.delete('/tags/:id', auth, (req, res) => {
        db.prepare('DELETE FROM tags WHERE tag_id=? AND user_id=?').run(String(req.params.id || ''), req.auth.sub);
        res.json({ ok: true });
    });
    return r;
}
