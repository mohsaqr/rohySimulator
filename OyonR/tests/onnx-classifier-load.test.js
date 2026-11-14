import assert from 'node:assert/strict';
import {
  OnnxEmotionClassifier,
  loadModelBytes,
  modelUrlCandidates,
} from '../src/inference/OnnxEmotionClassifier.js';

// ---- helpers ------------------------------------------------------------

const PRIMARY = 'https://raw.githubusercontent.com/example/model.onnx';
const MIRROR = '/local/models/model.onnx';
const MODEL_BYTES = new Uint8Array([0x08, 0x07, 0x12, 0x00]);

function fakeResponse(status, body = MODEL_BYTES) {
  const buf = body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength);
  const res = {
    ok: status >= 200 && status < 300,
    status,
    statusText: { 200: 'OK', 404: 'Not Found', 429: 'Too Many Requests' }[status] ?? '',
    arrayBuffer: async () => buf.slice(0),
  };
  res.clone = () => ({ ...res });
  return res;
}

// fetch stub that answers per-URL and records every call.
function fakeFetch(table) {
  const calls = [];
  const fn = async (url) => {
    calls.push(url);
    const entry = table[url];
    if (entry === undefined) throw new TypeError('Failed to fetch');
    return typeof entry === 'function' ? entry() : entry;
  };
  fn.calls = calls;
  return fn;
}

// In-memory Cache API: caches.open(name) → { match, put }.
function fakeCaches() {
  const stores = new Map();
  const opened = [];
  return {
    opened,
    stores,
    async open(name) {
      opened.push(name);
      if (!stores.has(name)) stores.set(name, new Map());
      const store = stores.get(name);
      return {
        async match(url) { return store.get(url) ?? undefined; },
        async put(url, response) { store.set(url, response); },
      };
    },
  };
}

// Minimal ORT stand-in — records what InferenceSession.create received.
function fakeOrt() {
  const created = [];
  return {
    created,
    env: { wasm: {}, versions: { web: '1.25.1' } },
    Tensor: class { constructor(type, data, dims) { Object.assign(this, { type, data, dims }); } },
    InferenceSession: {
      async create(model, opts) {
        created.push({ model, opts });
        return { inputNames: ['input'], outputNames: ['output'], run: async () => ({}) };
      },
    },
  };
}

// ---- modelUrlCandidates -------------------------------------------------

assert.deepEqual(modelUrlCandidates({ modelUrl: PRIMARY }), [PRIMARY]);
assert.deepEqual(modelUrlCandidates({ modelUrl: PRIMARY, modelFallbackUrls: [MIRROR, PRIMARY, '', null] }), [PRIMARY, MIRROR],
  'fallbacks are appended in order, deduped, and non-strings dropped');
assert.deepEqual(modelUrlCandidates({ modelUrl: null }), []);

// ---- happy path: primary OK, bytes cached -------------------------------

{
  const fetchImpl = fakeFetch({ [PRIMARY]: fakeResponse(200) });
  const cachesImpl = fakeCaches();
  const out = await loadModelBytes({ modelUrl: PRIMARY, modelCache: 'oyon-models-v1' }, { fetchImpl, cachesImpl });
  assert.equal(out.source, PRIMARY);
  assert.deepEqual(Array.from(out.bytes), Array.from(MODEL_BYTES));
  assert.deepEqual(fetchImpl.calls, [PRIMARY]);
  assert.deepEqual(cachesImpl.opened, ['oyon-models-v1']);
  assert.ok(cachesImpl.stores.get('oyon-models-v1').has(PRIMARY), 'successful download is written to the Cache API');
}

// ---- cache hit: no network at all ---------------------------------------

{
  const cachesImpl = fakeCaches();
  const store = await cachesImpl.open('oyon-models-v1');
  await store.put(PRIMARY, fakeResponse(200));
  const fetchImpl = fakeFetch({ [PRIMARY]: fakeResponse(429) }); // would fail if reached
  const out = await loadModelBytes({ modelUrl: PRIMARY, modelCache: 'oyon-models-v1' }, { fetchImpl, cachesImpl });
  assert.equal(out.source, PRIMARY);
  assert.deepEqual(fetchImpl.calls, [], 'a cached model is never re-fetched (this is what keeps GitHub-raw from 429ing)');
}

// ---- rate-limited primary → mirror ---------------------------------------

{
  const fetchImpl = fakeFetch({ [PRIMARY]: fakeResponse(429), [MIRROR]: fakeResponse(200) });
  const out = await loadModelBytes({ modelUrl: PRIMARY, modelFallbackUrls: [MIRROR], modelCache: false }, { fetchImpl });
  assert.equal(out.source, MIRROR);
  assert.deepEqual(fetchImpl.calls, [PRIMARY, MIRROR]);
}

// ---- network error on primary (TypeError) → mirror -----------------------

{
  const fetchImpl = fakeFetch({ [MIRROR]: fakeResponse(200) }); // PRIMARY throws
  const out = await loadModelBytes({ modelUrl: PRIMARY, modelFallbackUrls: [MIRROR], modelCache: false }, { fetchImpl });
  assert.equal(out.source, MIRROR);
}

// ---- everything fails → one error naming every URL + status --------------

{
  const fetchImpl = fakeFetch({ [PRIMARY]: fakeResponse(429), [MIRROR]: fakeResponse(404) });
  await assert.rejects(
    () => loadModelBytes({ modelUrl: PRIMARY, modelFallbackUrls: [MIRROR], modelCache: false }, { fetchImpl }),
    (err) => {
      assert.match(err.message, /could not download the emotion model \(2 URLs tried\)/);
      assert.match(err.message, /raw\.githubusercontent\.com\/example\/model\.onnx → HTTP 429 Too Many Requests/);
      assert.match(err.message, /\/local\/models\/model\.onnx → HTTP 404 Not Found/);
      assert.match(err.message, /npx oyon download-models/, 'error tells the host how to self-host');
      assert.doesNotMatch(err.message, /external data file/, 'never surface ORT\'s misleading wording');
      return true;
    },
  );
}

// ---- Cache API absent / broken → still loads -----------------------------

{
  const fetchImpl = fakeFetch({ [PRIMARY]: fakeResponse(200) });
  const out = await loadModelBytes({ modelUrl: PRIMARY, modelCache: 'oyon-models-v1' }, { fetchImpl, cachesImpl: undefined });
  assert.equal(out.source, PRIMARY);
}
{
  const fetchImpl = fakeFetch({ [PRIMARY]: fakeResponse(200) });
  const throwing = { open: async () => { throw new DOMException('quota', 'SecurityError'); } };
  const out = await loadModelBytes({ modelUrl: PRIMARY, modelCache: 'oyon-models-v1' }, { fetchImpl, cachesImpl: throwing });
  assert.equal(out.source, PRIMARY, 'a throwing Cache API is treated as absent, not fatal');
}
{
  const fetchImpl = fakeFetch({ [PRIMARY]: fakeResponse(200) });
  const cachesImpl = fakeCaches();
  await loadModelBytes({ modelUrl: PRIMARY, modelCache: false }, { fetchImpl, cachesImpl });
  assert.deepEqual(cachesImpl.opened, [], 'modelCache:false never touches the Cache API');
}

// ---- host-supplied bytes pass straight through ---------------------------

{
  const fetchImpl = fakeFetch({});
  const viaView = await loadModelBytes({ modelUrl: MODEL_BYTES }, { fetchImpl });
  assert.equal(viaView.source, 'bytes');
  assert.equal(viaView.bytes, MODEL_BYTES);
  const viaBuffer = await loadModelBytes({ modelUrl: MODEL_BYTES.buffer.slice(0) }, { fetchImpl });
  assert.ok(viaBuffer.bytes instanceof Uint8Array);
  assert.deepEqual(fetchImpl.calls, []);
}

// ---- no URL configured -----------------------------------------------------

await assert.rejects(() => loadModelBytes({ modelUrl: '' }, { fetchImpl: async () => fakeResponse(200) }), /no modelUrl configured/);

// ---- init(): fetches via the resolver, hands ORT bytes not a URL ---------

{
  const ort = fakeOrt();
  const previousFetch = globalThis.fetch;
  const previousCaches = globalThis.caches;
  globalThis.fetch = fakeFetch({ [PRIMARY]: fakeResponse(429), [MIRROR]: fakeResponse(200) });
  globalThis.caches = undefined;
  try {
    const classifier = new OnnxEmotionClassifier({
      ortModule: ort,
      modelUrl: PRIMARY,
      modelFallbackUrls: [MIRROR],
      wasmPaths: '/vendor/ort/',
    });
    await classifier.init();
    assert.equal(classifier.modelSource, MIRROR, 'init() records where the weights came from');
    assert.equal(ort.created.length, 1);
    assert.ok(ort.created[0].model instanceof Uint8Array, 'ORT receives bytes, so its URL-fetch error path is never hit');
    assert.deepEqual(ort.created[0].opts.executionProviders, ['wasm']);
    assert.equal(ort.env.wasm.wasmPaths, '/vendor/ort/');
    assert.equal(classifier.options.inputName, 'input');
    assert.equal(classifier.options.outputName, 'output');
  } finally {
    globalThis.fetch = previousFetch;
    globalThis.caches = previousCaches;
  }
}

// ---- init(): total failure surfaces the descriptive error ------------------

{
  const ort = fakeOrt();
  const previousFetch = globalThis.fetch;
  globalThis.fetch = fakeFetch({ [PRIMARY]: fakeResponse(429) });
  try {
    const classifier = new OnnxEmotionClassifier({ ortModule: ort, modelUrl: PRIMARY, modelCache: false });
    await assert.rejects(() => classifier.init(), /HTTP 429 Too Many Requests/);
    assert.equal(ort.created.length, 0);
    assert.equal(classifier.session, null);
  } finally {
    globalThis.fetch = previousFetch;
  }
}

console.log('onnx-classifier-load.test.js: all assertions passed');
