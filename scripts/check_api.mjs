const token = process.argv[2];
if(!token){ console.error('Usage: node check_api.mjs <JWT>'); process.exit(2) }
const BASE = 'http://localhost:4000';
const headers = { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' };
async function r(path){ const res = await fetch(BASE+path,{headers}); const j = await res.json().catch(()=>null); console.log(path, JSON.stringify(j,null,2)); }
(async ()=>{
  try{
    await r('/api/games');
    await r('/api/players');
    await r('/api/tags?game_id=game1');
  }catch(e){ console.error('ERR',e) }
})();
