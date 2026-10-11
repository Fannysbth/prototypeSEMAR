import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createStore } from '../shared/store.js';

const drivers = ['memory', 'file'];
if (process.env.TEST_DATABASE_URL) drivers.push('postgres');

for (const driver of drivers) {
  test(`store[${driver}]: put/get/insertIfAbsent/update/delete`, async () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'samar-store-'));
    const ns = `t${Date.now().toString(36)}${Math.floor(Math.random() * 1000)}`;
    const store = await createStore({ driver, namespace: ns, dataDir, databaseUrl: process.env.TEST_DATABASE_URL });
    try {
      const col = await store.collection('items', { indexes: ['k'], numericIndexes: ['n'] });
      await col.put('a', { k: 'x', n: 1, nested: { v: 1 } });
      assert.equal((await col.get('a')).k, 'x');
      assert.equal(await col.insertIfAbsent('a', { k: 'dup' }), false);
      assert.equal(await col.insertIfAbsent('b', { k: 'y', n: 2 }), true);
      const up = await col.update('a', { n: 5, extra: true });
      assert.equal(up.n, 5); assert.equal(up.k, 'x'); assert.equal(up.extra, true);
      assert.equal(await col.update('zzz', { n: 1 }), null);
      assert.equal(await col.get('nope'), null);
      assert.equal(await col.delete('b'), true);
      assert.equal(await col.get('b'), null);
    } finally { await store.close(); }
  });

  test(`store[${driver}]: filter eq/ne/in/gte/lte + order + limit + count`, async () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'samar-store-'));
    const ns = `t${Date.now().toString(36)}${Math.floor(Math.random() * 1000)}`;
    const store = await createStore({ driver, namespace: ns, dataDir, databaseUrl: process.env.TEST_DATABASE_URL });
    try {
      const col = await store.collection('obs', { indexes: ['ref'], numericIndexes: ['ts'] });
      for (let i = 1; i <= 10; i += 1) await col.put(`d${i}`, { ref: i % 2 ? 'odd' : 'even', ts: i * 100, status: i <= 3 ? 'new' : 'old', maybe: i === 1 ? null : 'v' });
      assert.equal((await col.find({ eq: { ref: 'odd' } })).length, 5);
      assert.equal((await col.find({ eq: { ref: 'odd' }, ne: { id: 'd1' } })).length, 4);
      assert.equal((await col.find({ in: { status: ['new'] } })).length, 3);
      assert.equal((await col.find({ gte: { ts: 300 }, lte: { ts: 600 } })).length, 4);
      const top = await col.find({}, { orderBy: 'ts', dir: 'desc', limit: 3 });
      assert.deepEqual(top.map((d) => d.id), ['d10', 'd9', 'd8']);
      const asc = await col.find({ eq: { ref: 'even' } }, { orderBy: 'ts', dir: 'asc', limit: 2 });
      assert.deepEqual(asc.map((d) => d.id), ['d2', 'd4']);
      assert.equal(await col.count({ eq: { status: 'old' } }), 7);
      assert.equal((await col.find({ eq: { maybe: null } })).length, 1);
      assert.equal((await col.find({ ne: { maybe: 'v' } })).length, 1); // NULL dianggap berbeda dari 'v'
    } finally { await store.close(); }
  });
}

test('store: nama field berbahaya ditolak (cegah SQL injection)', async () => {
  const store = await createStore({ driver: 'memory', namespace: 'inj' });
  const col = await store.collection('x');
  await col.put('1', { a: 1 });
  assert.ok(await col.find({ eq: { a: 1 } }));
  await assert.rejects(() => store.collection("x'; DROP TABLE y;--"));
});

test('store[file]: data bertahan setelah restart', async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'samar-store-'));
  const s1 = await createStore({ driver: 'file', namespace: 'persist', dataDir });
  await (await s1.collection('c')).put('1', { v: 42 });
  await s1.close();
  const s2 = await createStore({ driver: 'file', namespace: 'persist', dataDir });
  assert.equal((await (await s2.collection('c')).get('1')).v, 42);
  await s2.close();
});
