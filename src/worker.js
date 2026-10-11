// BAGMAN leaderboard API (Cloudflare Worker + D1).
// The game itself is static files in /public; only requests that don't match a file reach this code.

const MAX_POINTS_PER_LEVEL = 14010; // 181 coins x 10 + 4 rockets x 50 + 4 power-ups x (200 + 400 + 800 + 1600)
const MIN_SECONDS_PER_LEVEL = 20;   // faster than any real level clear
const SUBMITS_PER_HOUR = 30;        // per IP
const TOP_N = 10;
const RANK_SCAN_LIMIT = 1000;       // ranks past this show as "1000+" (keeps D1 reads cheap)
const NAME_RE = /^[A-Z0-9_]{1,12}$/;
const PLAYER_ID_RE = /^[a-f0-9-]{16,40}$/;

// Not allowed anywhere in a name, checked after mapping look-alike digits to letters (0->O, 1->I, ...).
const BLOCKED = ['FUCK', 'SHIT', 'CUNT', 'BITCH', 'DICK', 'COCK', 'PUSSY', 'NIGG', 'FAGG', 'RETARD',
  'WHORE', 'SLUT', 'NAZI', 'HITLER', 'KKK', 'PORN', 'ASSHOLE', 'TWAT', 'WANK', 'KIKE', 'CHINK'];

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith('/api/')) return env.ASSETS.fetch(request);
    try {
      if (url.pathname === '/api/leaderboard' && request.method === 'GET') return await getLeaderboard(url, env, ctx);
      if (url.pathname === '/api/score' && request.method === 'POST') return await postScore(request, env);
      if (url.pathname === '/api/admin/delete' && request.method === 'POST') return await adminDelete(request, env);
      return json({ error: 'not_found' }, 404);
    } catch (err) {
      console.error(err);
      return json({ error: 'server' }, 500);
    }
  },
};

function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...headers },
  });
}

const today = () => new Date().toISOString().slice(0, 10);

function isBlocked(name) {
  const plain = name.replace(/_/g, '').replace(/0/g, 'O').replace(/1/g, 'I').replace(/3/g, 'E')
    .replace(/4/g, 'A').replace(/5/g, 'S').replace(/7/g, 'T').replace(/8/g, 'B');
  return BLOCKED.some(w => plain.includes(w));
}

async function sha256Hex(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].slice(0, 16).map(b => b.toString(16).padStart(2, '0')).join('');
}

async function topList(env, board) {
  const { results } = await env.DB.prepare(
    'SELECT name, score, level FROM best WHERE board = ? ORDER BY score DESC, updated_at ASC LIMIT ?'
  ).bind(board, TOP_N).all();
  return results.map((r, i) => ({ rank: i + 1, name: r.name, score: r.score, level: r.level }));
}

async function rankOf(env, board, playerId) {
  const mine = await env.DB.prepare('SELECT score FROM best WHERE board = ? AND player_id = ?')
    .bind(board, playerId).first('score');
  if (mine == null) return null;
  const better = await env.DB.prepare('SELECT COUNT(*) AS n FROM (SELECT 1 FROM best WHERE board = ? AND score > ? LIMIT ?)')
    .bind(board, mine, RANK_SCAN_LIMIT).first('n');
  return better >= RANK_SCAN_LIMIT ? `${RANK_SCAN_LIMIT}+` : better + 1;
}

// GET /api/leaderboard -> today's and all-time top 10, cached at the edge for 15 seconds
async function getLeaderboard(url, env, ctx) {
  const cache = caches.default;
  const key = new Request(url.origin + '/api/leaderboard');
  const hit = await cache.match(key);
  if (hit) return hit;
  const day = today();
  const [todayRows, allRows] = await Promise.all([topList(env, day), topList(env, 'all')]);
  const res = json({ day, today: todayRows, all: allRows }, 200, { 'Cache-Control': 'public, max-age=15' });
  ctx.waitUntil(cache.put(key, res.clone()));
  return res;
}

// POST /api/score {name, playerId, score, level, duration} -> ranks + fresh top 10s
async function postScore(request, env) {
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== 'object') return json({ error: 'bad_request' }, 400);
  const name = String(body.name ?? '').toUpperCase().replace(/[^A-Z0-9_]/g, '').slice(0, 12);
  const playerId = String(body.playerId ?? '').toLowerCase();
  const { score, level, duration } = body;
  if (!NAME_RE.test(name)) return json({ error: 'bad_name' }, 400);
  if (isBlocked(name)) return json({ error: 'blocked_name' }, 400);
  if (!PLAYER_ID_RE.test(playerId) || ![score, level, duration].every(Number.isInteger)) return json({ error: 'bad_request' }, 400);
  if (score <= 0 || score % 10 !== 0 || level < 1 || level > 99 || duration < 1 || duration > 6 * 3600) {
    return json({ error: 'bad_request' }, 400);
  }
  if (score > level * MAX_POINTS_PER_LEVEL || duration < (level - 1) * MIN_SECONDS_PER_LEVEL) {
    return json({ error: 'implausible' }, 422);
  }

  const ipHash = await sha256Hex((env.SALT || '') + (request.headers.get('CF-Connecting-IP') || 'local'));
  const now = Date.now();
  const recent = await env.DB.prepare('SELECT COUNT(*) AS n FROM scores WHERE ip_hash = ? AND created_at > ?')
    .bind(ipHash, now - 3600 * 1000).first('n');
  if (recent >= SUBMITS_PER_HOUR) return json({ error: 'rate_limited' }, 429);

  // Keep each player's best per board; a new name always replaces the old one.
  const upsert = () => env.DB.prepare(
    `INSERT INTO best (board, player_id, name, score, level, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)
     ON CONFLICT (board, player_id) DO UPDATE SET
       name = excluded.name,
       level = CASE WHEN excluded.score > best.score THEN excluded.level ELSE best.level END,
       updated_at = CASE WHEN excluded.score > best.score THEN excluded.updated_at ELSE best.updated_at END,
       score = MAX(best.score, excluded.score)`);
  const day = today();
  await env.DB.batch([
    env.DB.prepare('INSERT INTO scores (player_id, name, score, level, duration, day, ip_hash, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .bind(playerId, name, score, level, duration, day, ipHash, now),
    upsert().bind(day, playerId, name, score, level, now),
    upsert().bind('all', playerId, name, score, level, now),
  ]);
  const [rankToday, rankAll, todayRows, allRows] = await Promise.all([
    rankOf(env, day, playerId), rankOf(env, 'all', playerId), topList(env, day), topList(env, 'all'),
  ]);
  return json({ ok: true, day, rankToday, rankAll, today: todayRows, all: allRows });
}

// POST /api/admin/delete {name} with header X-Admin-Key -> removes that name from every board
async function adminDelete(request, env) {
  if (!env.ADMIN_KEY || request.headers.get('X-Admin-Key') !== env.ADMIN_KEY) return json({ error: 'forbidden' }, 403);
  const body = await request.json().catch(() => ({}));
  const name = String(body.name ?? '').toUpperCase();
  if (!NAME_RE.test(name)) return json({ error: 'bad_name' }, 400);
  const { meta } = await env.DB.prepare('DELETE FROM best WHERE name = ?').bind(name).run();
  return json({ ok: true, deleted: meta.changes });
}
