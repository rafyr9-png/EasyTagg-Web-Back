import {fileURLToPath} from 'url';
import path from 'path';

const token = process.argv[2];
if(!token){ console.error('Usage: node test_migration.mjs <JWT>'); process.exit(2) }
const BASE = 'http://localhost:4000';
const headers = { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' };

const games = [{ id: 'game1', name: 'Test Game', date: new Date().toISOString().slice(0,10), home:'Home', away:'Away' }];
const players = [{ id: 'player1', num:'1', name:'Alice', team:'T1' }];
const tags = [{ tag_id: 'tag1', game_id: 'game1', game_name: 'Test Game', created_at: new Date().toISOString(), result: 'Hit', batter_id: 'player1', batter: 'Alice' }];

async function run(){
  try{
    console.log('PUT /api/sync/snapshot');
    let res = await fetch(`${BASE}/api/sync/snapshot`, { method: 'PUT', headers, body: JSON.stringify({ data: { etd_games: JSON.stringify(games), etd_players: JSON.stringify(players), etd_tags: JSON.stringify(tags) } }) });
    console.log(' =>', await res.json());

    console.log('POST /api/tags (create sample tag)');
    res = await fetch(`${BASE}/api/tags`, { method: 'POST', headers, body: JSON.stringify({ tag_id: 'tag2', game_id: 'game1', game_name: 'Test Game', created_at: new Date().toISOString(), result: 'Strike', batter_id: 'player1', batter: 'Alice' }) });
    console.log(' =>', await res.json());

    console.log('GET /api/migrate/preview');
    res = await fetch(`${BASE}/api/migrate/preview`, { headers });
    console.log(' =>', await res.json());

    console.log('POST /api/migrate/snapshot');
    res = await fetch(`${BASE}/api/migrate/snapshot`, { method: 'POST', headers });
    console.log(' =>', await res.json());
  }catch(e){ console.error('Error',e) }
}

run();
