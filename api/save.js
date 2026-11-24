// Vercel serverless function: appends one analysed song to a Notion page.
// Secrets live in Vercel environment variables, never in the repo or the web page:
//   NOTION_TOKEN    the Notion integration secret
//   NOTION_PAGE_ID  the page that collects all songs
//   APP_PASSCODE    a passcode you choose; the app sends it so strangers cannot write to your page
//   ALLOWED_ORIGINS (optional) comma-separated sites allowed to call this from another address
const crypto = require('crypto');

const NOTION_VERSION = '2022-06-28';
const DEFAULT_ORIGINS = ['https://devkotadai.github.io'];

const fail = (res, code, error) => res.status(code).json({ ok: false, error });
const safeEqual = (a, b) => {
  const A = Buffer.from(String(a)), B = Buffer.from(String(b));
  return A.length === B.length && crypto.timingSafeEqual(A, B);
};
const mmss = t => { t = Math.round(t); return Math.floor(t / 60) + ':' + String(t % 60).padStart(2, '0'); };
const pretty = s => String(s).replace('#', '♯');

// Notion allows 2000 characters per text object, so long text is split into pieces
function richText(str, bold) {
  const out = [];
  for (let i = 0; i < str.length; i += 1900) {
    const item = { type: 'text', text: { content: str.slice(i, i + 1900) } };
    if (bold) item.annotations = { bold: true };
    out.push(item);
  }
  return out.length ? out : [{ type: 'text', text: { content: ' ' } }];
}

function validate(p) {
  if (!p || typeof p !== 'object') return 'Missing data.';
  if (typeof p.title !== 'string' || !p.title.trim() || p.title.length > 200) return 'Song name must be 1 to 200 characters.';
  if (!['Uploaded file', 'Recording'].includes(p.source)) return 'Unknown source.';
  if (typeof p.whenText !== 'string' || p.whenText.length > 80) return 'Bad date.';
  if (p.key != null && (typeof p.key !== 'string' || p.key.length > 40)) return 'Bad key.';
  if (!Array.isArray(p.chords) || p.chords.length < 1 || p.chords.length > 3000) return 'No chords to save.';
  for (const c of p.chords) if (!c || typeof c.t !== 'number' || typeof c.label !== 'string' || c.label.length > 12) return 'Bad chord list.';
  if (p.lyrics != null && (typeof p.lyrics !== 'string' || p.lyrics.length > 60000)) return 'Lyrics are too long.';
  return null;
}

function buildBlocks(p) {
  const progression = [];
  for (const c of p.chords) { const l = pretty(c.label); if (progression[progression.length - 1] !== l) progression.push(l); }
  const timed = p.chords.map(c => mmss(c.t).padEnd(6) + pretty(c.label)).join('\n');
  const dur = Number.isFinite(p.durationSec) && p.durationSec > 0 ? mmss(p.durationSec) : '';
  const meta = [p.whenText, p.source, p.key ? 'Key: ' + pretty(p.key) : '', dur ? 'Length ' + dur : '',
    p.use7 ? 'with 7th chords' : ''].filter(Boolean).join('  |  ');
  const blocks = [
    { object: 'block', type: 'divider', divider: {} },
    { object: 'block', type: 'heading_2', heading_2: { rich_text: richText(p.title.trim()) } },
    { object: 'block', type: 'paragraph', paragraph: { rich_text: richText(meta) } },
    { object: 'block', type: 'callout', callout: { icon: { type: 'emoji', emoji: '🎸' }, rich_text: richText(progression.join('  |  '), true) } },
    { object: 'block', type: 'toggle', toggle: { rich_text: richText('Chords by time'), children: [
      { object: 'block', type: 'code', code: { language: 'plain text', rich_text: richText(timed) } }] } },
  ];
  if (p.lyrics && p.lyrics.trim()) blocks.push({ object: 'block', type: 'toggle', toggle: { rich_text: richText('Lyrics with chords'), children: [
    { object: 'block', type: 'code', code: { language: 'plain text', rich_text: richText(p.lyrics) } }] } });
  return blocks;
}

function cors(req, res) {
  const allowed = (process.env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
  const list = allowed.length ? allowed : DEFAULT_ORIGINS, origin = req.headers && req.headers.origin;
  if (origin && list.includes(origin)) res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'content-type, x-save-key');
}

async function handler(req, res) {
  cors(req, res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return fail(res, 405, 'Use POST.');
  const { NOTION_TOKEN, NOTION_PAGE_ID, APP_PASSCODE } = process.env;
  if (!NOTION_TOKEN || !NOTION_PAGE_ID || !APP_PASSCODE) return fail(res, 500, 'The server is missing NOTION_TOKEN, NOTION_PAGE_ID or APP_PASSCODE.');
  if (!safeEqual((req.headers && req.headers['x-save-key']) || '', APP_PASSCODE)) return fail(res, 401, 'Wrong passcode.');
  const problem = validate(req.body);
  if (problem) return fail(res, 400, problem);
  let r;
  try {
    r = await fetch('https://api.notion.com/v1/blocks/' + NOTION_PAGE_ID.replace(/-/g, '') + '/children', {
      method: 'PATCH',
      headers: { Authorization: 'Bearer ' + NOTION_TOKEN, 'Notion-Version': NOTION_VERSION, 'Content-Type': 'application/json' },
      body: JSON.stringify({ children: buildBlocks(req.body) }),
    });
  } catch (e) { return fail(res, 502, 'Could not reach Notion.'); }
  if (!r.ok) {
    let msg = ''; try { msg = (await r.json()).message || ''; } catch (e) {}
    const hint = r.status === 404 ? ' Make sure the page is shared with your integration (page menu, Connections).' : '';
    return fail(res, 502, 'Notion refused the save (' + r.status + '). ' + msg + hint);
  }
  return res.status(200).json({ ok: true });
}

module.exports = handler;
module.exports.buildBlocks = buildBlocks;
module.exports.validate = validate;
