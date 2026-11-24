const assert = require('assert');
const handler = require('../api/save.js');

function call(method, headers, body) {
  return new Promise(resolve => {
    const res = { code: 200, headers: {}, setHeader(k, v) { this.headers[k] = v; }, status(c) { this.code = c; return this; },
      json(o) { resolve({ code: this.code, body: o, headers: this.headers }); }, end() { resolve({ code: this.code, headers: this.headers }); } };
    handler({ method, headers: headers || {}, body }, res);
  });
}
const good = { title: 'Hotel Nepal', source: 'Uploaded file', whenText: 'Nov 24, 2026, 3:05 PM', key: 'D major', durationSec: 222, use7: false,
  chords: [{ t: 0, label: 'D' }, { t: 2, label: 'G' }, { t: 4, label: 'A' }, { t: 6, label: 'F#m' }, { t: 8, label: 'D' }], lyrics: null };

(async () => {
  let sent = null;
  global.fetch = async (url, opts) => { sent = { url, opts }; return { ok: true, status: 200, json: async () => ({}) }; };
  delete process.env.NOTION_TOKEN;
  assert.equal((await call('POST', {}, good)).code, 500, 'missing env');
  Object.assign(process.env, { NOTION_TOKEN: 'secret_x', NOTION_PAGE_ID: '42235af8-2481-81ea-bec9-c2be3397b435', APP_PASSCODE: 'letmein' });
  assert.equal((await call('GET', {}, null)).code, 405, 'only POST');
  assert.equal((await call('OPTIONS', { origin: 'https://devkotadai.github.io' })).headers['Access-Control-Allow-Origin'], 'https://devkotadai.github.io', 'cors for github pages');
  assert.equal((await call('OPTIONS', { origin: 'https://evil.example' })).headers['Access-Control-Allow-Origin'], undefined, 'cors blocks others');
  assert.equal((await call('POST', {}, good)).code, 401, 'no passcode');
  assert.equal((await call('POST', { 'x-save-key': 'nope' }, good)).code, 401, 'wrong passcode');
  assert.equal(sent, null, 'nothing sent to Notion without passcode');
  assert.equal((await call('POST', { 'x-save-key': 'letmein' }, { ...good, title: '' })).code, 400, 'empty title');
  assert.equal((await call('POST', { 'x-save-key': 'letmein' }, { ...good, chords: [] })).code, 400, 'no chords');
  assert.equal((await call('POST', { 'x-save-key': 'letmein' }, { ...good, source: 'x' })).code, 400, 'bad source');

  const ok = await call('POST', { 'x-save-key': 'letmein' }, good);
  assert.equal(ok.code, 200); assert.equal(ok.body.ok, true);
  assert.equal(sent.url, 'https://api.notion.com/v1/blocks/42235af8248181eabec9c2be3397b435/children');
  assert.equal(sent.opts.method, 'PATCH');
  assert.equal(sent.opts.headers.Authorization, 'Bearer secret_x');
  assert.equal(sent.opts.headers['Notion-Version'], '2022-06-28');
  const kids = JSON.parse(sent.opts.body).children;
  assert.deepEqual(kids.map(b => b.type), ['divider', 'heading_2', 'paragraph', 'callout', 'toggle']);
  assert.equal(kids[1].heading_2.rich_text[0].text.content, 'Hotel Nepal');
  assert.match(kids[2].paragraph.rich_text[0].text.content, /Nov 24, 2026, 3:05 PM {2}\| {2}Uploaded file {2}\| {2}Key: D major {2}\| {2}Length 3:42/);
  assert.equal(kids[3].callout.rich_text[0].text.content, 'D  |  G  |  A  |  F♯m  |  D');   // consecutive repeats collapsed, sharps pretty
  assert.equal(kids[4].toggle.children[0].code.rich_text[0].text.content.split('\n')[3], '0:06  F♯m');

  const withLyrics = { ...good, lyrics: 'x'.repeat(4500) };
  await call('POST', { 'x-save-key': 'letmein' }, withLyrics);
  const k2 = JSON.parse(sent.opts.body).children;
  assert.equal(k2.length, 6, 'lyrics toggle added');
  const parts = k2[5].toggle.children[0].code.rich_text;
  assert.ok(parts.length === 3 && parts.every(p => p.text.content.length <= 2000), 'long text split under the 2000 limit');

  global.fetch = async () => ({ ok: false, status: 404, json: async () => ({ message: 'Could not find block' }) });
  const nf = await call('POST', { 'x-save-key': 'letmein' }, good);
  assert.equal(nf.code, 502); assert.match(nf.body.error, /shared with your integration/);
  global.fetch = async () => { throw new Error('offline'); };
  assert.equal((await call('POST', { 'x-save-key': 'letmein' }, good)).code, 502, 'network failure handled');
  console.log('save function: all checks passed');
})().catch(e => { console.error('FAILED:', e.message); process.exit(1); });
