const http = require('http'), fs = require('fs'), path = require('path');
const { WebSocketServer } = require('ws');
const PORT = process.env.PORT || 3000;
const SAVE = process.env.SAVE_FILE || path.join(__dirname, 'worlds.json');
const VOL = 224 * 224 * 64, MAX_WORLDS = 500, MAX_PLAYERS = 12;
const worlds = new Map();
try {
  const d = JSON.parse(fs.readFileSync(SAVE, 'utf8'));
  for (const [c, arr] of Object.entries(d)) {
    const e = new Map(); for (let i = 0; i < arr.length; i += 2) e.set(arr[i], arr[i + 1]);
    worlds.set(c, { edits: e, clients: new Set(), last: Date.now() });
  }
} catch (e) {}
function save() {
  try {
    const o = {};
    for (const [c, w] of worlds) { if (!w.edits.size) continue; const a = []; w.edits.forEach((v, k) => a.push(k, v)); o[c] = a; }
    fs.writeFileSync(SAVE, JSON.stringify(o));
  } catch (e) {}
}
setInterval(save, 30000);
process.on('SIGTERM', () => { save(); process.exit(0); });
const INDEX = fs.readFileSync(path.join(__dirname, 'index.html'));
const server = http.createServer((req, res) => {
  const u = req.url.split('?')[0];
  if (u === '/' || u === '/index.html') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' }); res.end(INDEX);
  } else if (u === '/robots.txt') {
    res.writeHead(200, { 'Content-Type': 'text/plain' }); res.end('User-agent: *\nAllow: /\n');
  } else if (u === '/health') { res.writeHead(200); res.end('ok'); }
  else { res.writeHead(404); res.end('Introuvable'); }
});
const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 4096 });
let nextId = 1;
const num = (v, lo, hi) => (typeof v === 'number' && isFinite(v) ? Math.max(lo, Math.min(hi, v)) : 0);
wss.on('connection', (ws, req) => {
  const q = new URL(req.url, 'http://x').searchParams;
  const code = String(q.get('code') || '').toUpperCase();
  const create = q.get('create') === '1';
  if (!/^[A-Z0-9]{4,8}$/.test(code)) { ws.send(JSON.stringify({ t: 'err', msg: 'Code invalide.' })); return ws.close(); }
  let w = worlds.get(code);
  if (!w) {
    if (!create) { ws.send(JSON.stringify({ t: 'err', msg: 'Monde introuvable : verifie le code.' })); return ws.close(); }
    if (worlds.size >= MAX_WORLDS) { ws.send(JSON.stringify({ t: 'err', msg: 'Serveur plein, reessaie plus tard.' })); return ws.close(); }
    w = { edits: new Map(), clients: new Set(), last: Date.now() }; worlds.set(code, w);
  }
  if (w.clients.size >= MAX_PLAYERS) { ws.send(JSON.stringify({ t: 'err', msg: 'Ce monde est plein (12 joueurs).' })); return ws.close(); }
  const me = { id: 'p' + nextId++, ws, name: 'Joueur', x: 0, y: 0, z: 0, yaw: 0, has: false, tokens: 60, tick: Date.now() };
  const bc = (obj, skip) => { const t = JSON.stringify(obj); for (const c of w.clients) if (c !== skip && c.ws.readyState === 1) c.ws.send(t); };
  const flat = []; w.edits.forEach((v, k) => flat.push(k, v));
  ws.send(JSON.stringify({ t: 'init', id: me.id, edits: flat, peers: [...w.clients].filter(c => c.has).map(c => ({ id: c.id, name: c.name, x: c.x, y: c.y, z: c.z, yaw: c.yaw })) }));
  w.clients.add(me); w.last = Date.now();
  ws.on('message', (raw) => {
    const now = Date.now(); me.tokens = Math.min(60, me.tokens + (now - me.tick) / 1000 * 60); me.tick = now;
    if (me.tokens < 1) return; me.tokens--;
    let m; try { m = JSON.parse(raw); } catch (e) { return; }
    if (m.t === 'pos') {
      me.name = String(m.name || 'Joueur').replace(/[^\p{L}\p{N} _-]/gu, '').slice(0, 16) || 'Joueur';
      me.x = num(m.x, -10, 300); me.y = num(m.y, -10, 100); me.z = num(m.z, -10, 300); me.yaw = num(m.yaw, -20, 20); me.has = true;
      bc({ t: 'peer', id: me.id, name: me.name, x: me.x, y: me.y, z: me.z, yaw: me.yaw }, me);
    } else if (m.t === 'edit') {
      const i = m.i | 0, id = m.id | 0;
      if (i < 0 || i >= VOL || id < 0 || id > 255) return;
      w.edits.set(i, id); w.last = now; bc({ t: 'edit', i, id }, me);
    }
  });
  ws.on('close', () => { w.clients.delete(me); bc({ t: 'left', id: me.id }); if (!w.clients.size && !w.edits.size) worlds.delete(code); });
});
server.listen(PORT, () => console.log('Cubera sur le port ' + PORT));
