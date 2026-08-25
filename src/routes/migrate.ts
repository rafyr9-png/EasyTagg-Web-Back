import express from 'express';
import { v4 as uuid } from 'uuid';
import { TAG_COLUMNS } from '../lib/tagColumns.js';

export default function createMigrateRouter(db: any, auth: any) {
  const r = express.Router();
  r.post('/migrate/snapshot', auth, (req, res) => {
    try {
      const row: any = db
        .prepare('SELECT data_json FROM snapshots WHERE user_id=?')
        .get((req as any).auth.sub);
      if (!row || !row.data_json)
        return res.status(400).json({ error: 'No snapshot available for user' });
      const raw: any = JSON.parse(row.data_json || '{}');
      const parsed: Record<string, any> = {};
      for (const k of Object.keys(raw)) {
        try {
          parsed[k] = JSON.parse(raw[k]);
        } catch {
          parsed[k] = raw[k];
        }
      }

      let gamesInserted = 0,
        playersInserted = 0,
        tagsInserted = 0;
      const nowTs = new Date().toISOString();

      const gamesArr = Array.isArray(parsed['etd_games']) ? parsed['etd_games'] : [];
      const gameStmt = db.prepare(
        'INSERT OR IGNORE INTO games(id,user_id,name,date,home,away,game_type,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)'
      );
      for (const g of gamesArr) {
        const id = String(g.id || uuid());
        gameStmt.run(
          id,
          (req as any).auth.sub,
          String(g.name || 'Activity'),
          String(g.date || new Date().toISOString().slice(0, 10)),
          String(g.home || ''),
          String(g.away || ''),
          String(g.game_type || 'game'),
          nowTs,
          nowTs
        );
        gamesInserted++;
      }

      const playersArr = Array.isArray(parsed['etd_players']) ? parsed['etd_players'] : [];
      const playerStmt = db.prepare(
        'INSERT OR IGNORE INTO players(id,user_id,num,name,team,role,side,bat,thr,position,db_player_code,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)'
      );
      for (const p of playersArr) {
        const id = String(p.id || uuid());
        playerStmt.run(
          id,
          (req as any).auth.sub,
          String(p.num || ''),
          String(p.name || ''),
          String(p.team || ''),
          String(p.role || ''),
          String(p.side || ''),
          String(p.bat || ''),
          String(p.thr || ''),
          String(p.position || ''),
          String(p.db_player_code || p.player_code || ''),
          nowTs,
          nowTs
        );
        playersInserted++;
      }

      const tagsArr = Array.isArray(parsed['etd_tags']) ? parsed['etd_tags'] : [];
      const tagPlaceholders = TAG_COLUMNS.map(() => '?').join(',');
      const tagStmt = db.prepare(
        `INSERT OR IGNORE INTO tags(${TAG_COLUMNS.join(',')}) VALUES(${tagPlaceholders})`
      );
      for (const t of tagsArr) {
        const tag = Object.assign({}, t);
        tag.tag_id = String(tag.tag_id || uuid());
        tag.user_id = (req as any).auth.sub;
        tag.created_at = String(tag.created_at || nowTs);
        const vals = TAG_COLUMNS.map((c) => (tag[c] === undefined ? null : tag[c]));
        tagStmt.run(...vals);
        tagsInserted++;
      }

      return res.json({
        ok: true,
        inserted: { games: gamesInserted, players: playersInserted, tags: tagsInserted },
      });
    } catch (e: any) {
      console.error('Migration error', e);
      return res.status(500).json({ error: e.message || 'Migration failed' });
    }
  });

  r.get('/migrate/preview', auth, (req, res) => {
    try {
      const row: any = db
        .prepare('SELECT data_json FROM snapshots WHERE user_id=?')
        .get((req as any).auth.sub);
      if (!row || !row.data_json)
        return res.status(400).json({ error: 'No snapshot available for user' });
      const raw: any = JSON.parse(row.data_json || '{}');
      const parsed: Record<string, any> = {};
      for (const k of Object.keys(raw)) {
        try {
          parsed[k] = JSON.parse(raw[k]);
        } catch {
          parsed[k] = raw[k];
        }
      }

      const gamesArr = Array.isArray(parsed['etd_games']) ? parsed['etd_games'] : [];
      const playersArr = Array.isArray(parsed['etd_players']) ? parsed['etd_players'] : [];
      const tagsArr = Array.isArray(parsed['etd_tags']) ? parsed['etd_tags'] : [];

      const existingGames = new Set(
        db
          .prepare('SELECT id FROM games WHERE user_id=?')
          .all((req as any).auth.sub)
          .map((r: any) => r.id)
      );
      const existingPlayers = new Set(
        db
          .prepare('SELECT id FROM players WHERE user_id=?')
          .all((req as any).auth.sub)
          .map((r: any) => r.id)
      );
      const existingTags = new Set(
        db
          .prepare('SELECT tag_id FROM tags WHERE user_id=?')
          .all((req as any).auth.sub)
          .map((r: any) => r.tag_id)
      );

      const conflictGames = gamesArr.filter((g: any) =>
        existingGames.has(String(g.id || ''))
      ).length;
      const conflictPlayers = playersArr.filter((p: any) =>
        existingPlayers.has(String(p.id || ''))
      ).length;
      const conflictTags = tagsArr.filter((t: any) =>
        existingTags.has(String(t.tag_id || ''))
      ).length;

      return res.json({
        ok: true,
        counts: { games: gamesArr.length, players: playersArr.length, tags: tagsArr.length },
        conflicts: { games: conflictGames, players: conflictPlayers, tags: conflictTags },
        samples: {
          games: gamesArr.slice(0, 5),
          players: playersArr.slice(0, 5),
          tags: tagsArr.slice(0, 5),
        },
      });
    } catch (e: any) {
      console.error('Preview migration error', e);
      return res.status(500).json({ error: e.message || 'Preview failed' });
    }
  });

  return r;
}
