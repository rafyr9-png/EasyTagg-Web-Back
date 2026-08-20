import Database from 'better-sqlite3';
import { v4 as uuid } from 'uuid';
import fs from 'fs';

const DB_PATH = 'data/easytagg.sqlite';
const BACKUP_PATH = `data/easytagg.sqlite.bak.${Date.now()}`;

try {
  fs.copyFileSync(DB_PATH, BACKUP_PATH);
  console.log('Backup created at', BACKUP_PATH);
} catch (e) {
  console.error('Could not create backup, aborting.', e.message);
  process.exit(1);
}

const db = new Database(DB_PATH);
function now(){return new Date().toISOString();}

const snapshots = db.prepare('SELECT user_id,data_json FROM snapshots').all();
if(!snapshots.length){
  console.log('No snapshots found. Nothing to migrate.');
  process.exit(0);
}

for(const s of snapshots){
  const userId = s.user_id;
  console.log('\nMigrating snapshot for user:', userId);
  let parsedRaw = {};
  try{ parsedRaw = JSON.parse(s.data_json || '{}'); }catch(e){ console.warn('Snapshot parse error', e.message); parsedRaw = {}; }
  const parsed = {};
  for(const k of Object.keys(parsedRaw)){
    try{ parsed[k]=JSON.parse(parsedRaw[k]); }catch{ parsed[k]=parsedRaw[k]; }
  }

  let gamesInserted=0, playersInserted=0, tagsInserted=0;
  const nowTs = now();

  // Games
  const gamesArr = Array.isArray(parsed['etd_games'])?parsed['etd_games']:[];
  const gameStmt = db.prepare('INSERT OR IGNORE INTO games(id,user_id,name,date,home,away,game_type,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)');
  for(const g of gamesArr){
    const id = String(g.id || uuid());
    gameStmt.run(id,userId,String(g.name||'Activity'),String(g.date||new Date().toISOString().slice(0,10)),String(g.home||''),String(g.away||''),String(g.game_type||'game'),nowTs,nowTs);
    gamesInserted++;
  }

  // Players
  const playersArr = Array.isArray(parsed['etd_players'])?parsed['etd_players']:[];
  const playerStmt = db.prepare('INSERT OR IGNORE INTO players(id,user_id,num,name,team,role,side,bat,thr,position,db_player_code,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)');
  for(const p of playersArr){
    const id = String(p.id || uuid());
    playerStmt.run(id,userId,String(p.num||''),String(p.name||''),String(p.team||''),String(p.role||''),String(p.side||''),String(p.bat||''),String(p.thr||''),String(p.position||''),String(p.db_player_code||p.player_code||''),nowTs,nowTs);
    playersInserted++;
  }

  // Tags
  const tagsArr = Array.isArray(parsed['etd_tags'])?parsed['etd_tags']:[];
  const tagCols = ['tag_id','user_id','game_id','game_name','game_date','home_team','away_team','game_seconds','game_time','clip_start_seconds','clip_start_time','clip_end_seconds','clip_end_time','inning','half','batting_side','balls_before','strikes_before','outs_before','count_before','pitcher_id','pitcher','pitcher_hand','pitcher_pitch_number','batter_id','batter','batter_hand','pitch_type','pitch_mph','zone_status','zone_x','zone_y','result','final_result','contact_quality','trajectory','spray_location','exit_velocity','note','created_at'];
  const tagPlaceholders = tagCols.map(()=>'?').join(',');
  const tagStmt = db.prepare(`INSERT OR IGNORE INTO tags(${tagCols.join(',')}) VALUES(${tagPlaceholders})`);
  for(const t of tagsArr){
    const tag = Object.assign({}, t);
    tag.tag_id = String(tag.tag_id || uuid());
    tag.user_id = userId;
    tag.created_at = String(tag.created_at || nowTs);
    const vals = tagCols.map(c => (tag[c] === undefined ? null : tag[c]));
    tagStmt.run(...vals);
    tagsInserted++;
  }

  console.log('Inserted — games:',gamesInserted,'players:',playersInserted,'tags:',tagsInserted);
}

console.log('\nMigration complete for all snapshots.');
process.exit(0);
