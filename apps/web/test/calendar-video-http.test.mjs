// Exercise the real local HTTP server: browsers seek MP4s by byte range.
import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const movie = readFileSync(new URL('../public/media/nota-agenda-fr.mp4', import.meta.url));
let processUnderTest, base;

before(async () => {
  processUnderTest = spawn(process.execPath, [fileURLToPath(new URL('../run-local.mjs', import.meta.url))], {
    env: { ...process.env, PORT: '0', NOTA_API_BASE: '' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  let errors = '';
  processUnderTest.stderr.on('data', chunk => { errors += chunk; });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Local video server did not start: ' + errors)), 10000);
    processUnderTest.once('error', error => { clearTimeout(timer); reject(error); });
    processUnderTest.once('exit', code => { clearTimeout(timer); reject(new Error(`Local video server exited (${code}): ${errors}`)); });
    processUnderTest.stdout.on('data', chunk => {
      output += chunk;
      const match = /Nota web on http:\/\/localhost:(\d+)/.exec(output);
      if (match) { clearTimeout(timer); base = 'http://127.0.0.1:' + match[1]; resolve(); }
    });
  });
});

after(async () => {
  if (processUnderTest && processUnderTest.exitCode === null && processUnderTest.signalCode === null) {
    const stopped = once(processUnderTest, 'exit');
    processUnderTest.kill();
    await stopped;
  }
});

function requestMovie(options) { return fetch(base + '/media/nota-agenda-fr.mp4?test=range', options); }
async function body(response) { return Buffer.from(await response.arrayBuffer()); }

test('the complete MP4 and HEAD expose its size without caching development media', async () => {
  for (const method of ['GET', 'HEAD']) {
    const response = await requestMovie({ method });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-type'), 'video/mp4');
    assert.equal(response.headers.get('content-length'), String(movie.length));
    assert.equal(response.headers.get('accept-ranges'), 'bytes');
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal(response.headers.get('content-range'), null);
    assert.deepEqual(await body(response), method === 'HEAD' ? Buffer.alloc(0) : movie);
  }
});

test('byte ranges return the requested MP4 bytes and correct HTTP boundaries', async t => {
  const cases = [
    ['bytes=0-1023', 0, 1023],
    ['bytes=4096-8191', 4096, 8191],
    [`bytes=${movie.length - 128}-`, movie.length - 128, movie.length - 1],
    [`bytes=${movie.length - 64}-${movie.length + 1000}`, movie.length - 64, movie.length - 1],
    ['bytes=-256', movie.length - 256, movie.length - 1],
    [`bytes=-${movie.length + 1000}`, 0, movie.length - 1],
  ];
  for (const [range, start, end] of cases) {
    await t.test(range, async () => {
      const response = await requestMovie({ headers: { range } });
      assert.equal(response.status, 206);
      assert.equal(response.headers.get('content-range'), `bytes ${start}-${end}/${movie.length}`);
      assert.equal(response.headers.get('content-length'), String(end - start + 1));
      assert.equal(response.headers.get('accept-ranges'), 'bytes');
      assert.equal(response.headers.get('cache-control'), 'no-store');
      assert.deepEqual(await body(response), movie.subarray(start, end + 1));
    });
  }
});

test('unsatisfiable ranges return 416 with the complete representation size', async t => {
  for (const range of [`bytes=${movie.length}-`, `bytes=${movie.length + 100}-`, 'bytes=100-10', 'bytes=-0']) {
    await t.test(range, async () => {
      const response = await requestMovie({ headers: { range } });
      assert.equal(response.status, 416);
      assert.equal(response.headers.get('content-range'), `bytes */${movie.length}`);
      assert.equal(response.headers.get('content-length'), '0');
      assert.equal((await body(response)).length, 0);
    });
  }
});

test('unsupported ranges are ignored, and HEAD never returns a partial body', async () => {
  for (const range of ['items=0-1', 'bytes=invalid', 'bytes=0-1,8-9']) {
    const response = await requestMovie({ headers: { range } });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-range'), null);
    assert.deepEqual(await body(response), movie);
  }
  const response = await requestMovie({ method: 'HEAD', headers: { range: 'bytes=0-1023' } });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('content-length'), String(movie.length));
  assert.equal(response.headers.get('content-range'), null);
  assert.equal((await body(response)).length, 0);
});

test('local pages and scripts also bypass the browser cache on reload', async () => {
  for (const path of ['/', '/agenda-demo.html', '/notaire-refinancement-quebec.html', '/styles.css', '/agenda-demo.js', '/domain.js', '/signing-domain.js']) {
    const response = await fetch(base + path);
    assert.equal(response.status, 200, path);
    assert.equal(response.headers.get('cache-control'), 'no-store', path);
    await response.arrayBuffer();
  }
});
