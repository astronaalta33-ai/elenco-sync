import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';

const PORT = Number(process.env.PORT || 4173);
const ROOT = join(process.cwd(), 'public');
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.zip': 'application/zip',
  '.svg': 'image/svg+xml'
};

function json(res, status, body) {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff'
  });function json(res, status, body) {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'GET, OPTIONS',
    'access-control-allow-headers': 'Content-Type'
  });
  res.end(JSON.stringify(body));
}

function extractTeamId(raw) {
  let url;
  try { url = new URL(raw); } catch { throw new Error('Cole um link válido do SofaScore.'); }
  if (!['www.sofascore.com', 'sofascore.com'].includes(url.hostname)) {
    throw new Error('A origem precisa ser um link do sofascore.com.');
  }
  const match = url.pathname.match(/\/team\/[^/]+\/(\d+)/i);
  if (!match) throw new Error('Não encontrei o ID do time nesse link. Use o link da página do time.');
  return match[1];
}

function teamNameFromSofaUrl(raw, teamId) {
  if (teamId === '2817') return 'FC Barcelona';
  try {
    const url = new URL(raw);
    const match = url.pathname.match(/\/team\/([^/]+)\//i);
    if (match) return match[1].replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  } catch { /* validated separately */ }
  return 'Equipe do SofaScore';
}

function normalizePlayer(entry) {
  const p = entry?.player ?? entry;
  if (!p || (!p.name && !p.id)) return null;
  const posMap = { G: 'Goleiro', D: 'Defensor', M: 'Meio-campista', F: 'Atacante' };
  const rawPos = p.position ?? p.positionName ?? '';
  const pos = posMap[String(rawPos).toUpperCase()] || rawPos || 'Não informada';
  const id = p.id ?? entry?.id ?? null;
  return {
    id: id == null ? null : String(id),
    name: String(p.name ?? p.shortName ?? 'Jogador sem nome'),
    number: p.jerseyNumber == null ? '' : String(p.jerseyNumber),
    position: String(pos),
    photo: id == null ? '' : `https://img.sofascore.com/api/v1/player/${encodeURIComponent(id)}/image`,
    source: 'SofaScore'
  };
}

async function getSofaScorePlayers(teamId) {
  const upstream = `https://www.sofascore.com/api/v1/team/${encodeURIComponent(teamId)}/players`;
  const response = await fetch(upstream, {
    headers: {
      'accept': 'application/json, text/plain, */*',
      'user-agent': 'Mozilla/5.0 (compatible; ElencoSync/1.2)',
      'referer': 'https://www.sofascore.com/'
    },
    signal: AbortSignal.timeout(12000)
  });
  if (!response.ok) {
    throw new Error(`O SofaScore respondeu HTTP ${response.status}. Pode ter bloqueado a consulta automática; tente importar um JSON de elenco.`);
  }
  const payload = await response.json();
  const entries = payload?.players ?? payload?.team?.players ?? payload?.data?.players;
  if (!Array.isArray(entries)) throw new Error('O formato recebido do SofaScore mudou ou não contém a lista de jogadores.');
  const players = entries.map(normalizePlayer).filter(Boolean);
  if (!players.length) throw new Error('Nenhum jogador foi encontrado para esse time.');
  return players;
}

function extractChallengeUrl(raw) {
  let url;
  try { url = new URL(raw); } catch { throw new Error('Cole um link válido do Challenge Place.'); }
  if (!['challenge.place', 'www.challenge.place'].includes(url.hostname)) {
    throw new Error('O destino precisa ser um link de challenge.place.');
  }
  const match = url.pathname.match(/^\/c\/([a-f0-9]{16,32})(?:\/(?:competitors)?)?\/?$/i);
  if (!match) throw new Error('Não encontrei o identificador do challenge no link informado.');
  return {
    id: match[1],
    competitorsUrl: `https://challenge.place/c/${match[1]}/competitors`
  };
}

function decodeHtml(value) {
  return String(value)
    .replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)));
}

function stripTags(value) {
  return decodeHtml(String(value).replace(/<script\b[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]*>/g, ' '))
    .replace(/\s+/g, ' ').trim();
}

function parseChallengeTeams(html, challengeId) {
  const results = [];
  const seen = new Set();
  const anchorRe = /<a\b[^>]*href\s*=\s*(["'])(.*?)\1[^>]*>([\s\S]*?)<\/a>/gi;
  let match;
  while ((match = anchorRe.exec(html)) !== null) {
    const href = decodeHtml(match[2]);
    let pathname;
    try { pathname = new URL(href, 'https://challenge.place').pathname; } catch { continue; }
    const pathMatch = pathname.match(new RegExp(`^/c/${challengeId}/competitor/([a-f0-9]{16,32})/?$`, 'i'));
    if (!pathMatch) continue;
    const competitorId = pathMatch[1];
    if (seen.has(competitorId)) continue;
    const rawLabel = stripTags(match[3]);
    const name = rawLabel
      .replace(/\s+\d+\s+(?:players?|jogadores?)$/i, '')
      .replace(/\s+[A-Z0-9À-ÖØ-Þ]{2,5}$/u, '')
      .trim();
    if (!name || name.length > 100) continue;
    seen.add(competitorId);
    results.push({
      id: competitorId,
      name,
      url: `https://challenge.place/c/${challengeId}/competitor/${competitorId}`
    });
  }
  return results;
}

async function searchChallengeTeams(challengeId, teamName) {
  const competitorsUrl = `https://challenge.place/c/${challengeId}/competitors`;
  const response = await fetch(competitorsUrl, {
    headers: {
      'accept': 'text/html,application/xhtml+xml',
      'user-agent': 'Mozilla/5.0 (compatible; ElencoSync/1.2)',
      'referer': 'https://challenge.place/'
    },
    redirect: 'manual',
    signal: AbortSignal.timeout(12000)
  });
  if (response.status >= 300 && response.status < 400) {
    throw new Error('O Challenge Place redirecionou a consulta. Abra o challenge no navegador e confirme que ele está público; o app não usa sua senha nem cookies.');
  }
  if (!response.ok) throw new Error(`O Challenge Place respondeu HTTP ${response.status} ao listar as equipes.`);
  const html = await response.text();
  const teams = parseChallengeTeams(html, challengeId);
  if (!teams.length) {
    throw new Error('Não consegui ler a lista pública de equipes deste challenge. Ele pode exigir login ou carregar os dados apenas no aplicativo. A busca automática ficará indisponível para este challenge até haver um método de integração autorizado.');
  }
  return { teams, teamName, competitorsUrl };
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'GET, OPTIONS',
      'access-control-allow-headers': 'Content-Type',
      'access-control-max-age': '86400'
    });
    return res.end();
    }
  if (req.method === 'GET' && url.pathname === '/api/health') {
    return json(res, 200, { ok: true, name: 'Elenco Sync', version: '1.2.0' });
  }
  if (req.method === 'GET' && url.pathname === '/api/sofascore/players') {
    try {
      const teamUrl = url.searchParams.get('url') || 'https://www.sofascore.com/pt/football/team/barcelona/2817';
      const teamId = extractTeamId(teamUrl);
      const players = await getSofaScorePlayers(teamId);
      return json(res, 200, {
        teamId,
        teamName: teamNameFromSofaUrl(teamUrl, teamId),
        count: players.length,
        players,
        fetchedAt: new Date().toISOString()
      });
    } catch (error) {
      return json(res, 502, { error: error?.message || 'Falha ao consultar o SofaScore.' });
    }
  }
  if (req.method === 'GET' && url.pathname === '/api/challenge/search-team') {
    try {
      const destination = extractChallengeUrl(url.searchParams.get('url') || '');
      const teamName = (url.searchParams.get('name') || '').trim();
      if (!teamName) throw new Error('O nome da equipe do SofaScore não foi informado.');
      const result = await searchChallengeTeams(destination.id, teamName);
      return json(res, 200, { challengeId: destination.id, ...result, count: result.teams.length });
    } catch (error) {
      return json(res, 502, { error: error?.message || 'Falha ao pesquisar equipes no Challenge Place.' });
    }
  }

  if (req.method === 'GET') {
    const requested = url.pathname === '/' ? '/index.html' : url.pathname;
    const safePath = normalize(requested).replace(/^([.][.][/\\])+/, '');
    try {
      const filePath = join(ROOT, safePath);
      const data = await readFile(filePath);
      res.writeHead(200, {
        'content-type': MIME[extname(filePath)] || 'application/octet-stream',
        'x-content-type-options': 'nosniff',
        'cache-control': 'no-cache'
      });
      return res.end(data);
    } catch {
      return json(res, 404, { error: 'Arquivo não encontrado.' });
    }
  }
  return json(res, 405, { error: 'Método não permitido.' });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Elenco Sync disponível em http://localhost:${PORT}`);
});
