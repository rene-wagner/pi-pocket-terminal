import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createInputQueue } from '../terminal/input-queue.mjs';
const tick = () => new Promise(resolve => setImmediate(resolve));

test('input is ordered, chunked, and bound to one sender', async () => {
  const sent = [], release = [];
  const queue = createInputQueue({ send: data => { sent.push(data); return new Promise(resolve => release.push(resolve)); }, onError: assert.fail, chunkSize: 3 });
  assert.equal(queue.enqueue('offline'), false);
  queue.setConnected(true);
  queue.enqueue('abcde'); queue.enqueue('fg');
  assert.deepEqual(sent, ['abc']);
  release.shift()(); await tick(); assert.deepEqual(sent, ['abc', 'def']);
  release.shift()(); await tick(); assert.deepEqual(sent, ['abc', 'def', 'g']);
  release.shift()(); await tick(); queue.dispose();
});
test('failed or uncertain requests are not retried and pending input is discarded', async () => {
  const sent = [], errors = [];
  let reject;
  const queue = createInputQueue({ send: data => { sent.push(data); return new Promise((_, no) => { reject = no; }); }, onError: error => errors.push(error) });
  queue.setConnected(true); queue.enqueue('c'); queue.enqueue('unsafe');
  reject(new Error('network')); await tick();
  assert.deepEqual(sent, ['c']); assert.equal(errors.length, 1); assert.equal(queue.enqueue('d'), false);
  queue.setConnected(true); queue.enqueue('fresh'); assert.deepEqual(sent, ['c', 'fresh']);
  queue.dispose(); reject(new Error('abort')); await tick(); assert.equal(errors.length, 1);
});
test('disconnect and disposal never flush pending input into another tab', async () => {
  const a = [], b = []; let release;
  const first = createInputQueue({ send: data => { a.push(data); return new Promise(resolve => { release = resolve; }); }, onError: assert.fail });
  const second = createInputQueue({ send: async data => b.push(data), onError: assert.fail });
  first.setConnected(true); first.enqueue('first'); first.enqueue('discard'); first.setConnected(false); first.dispose();
  second.setConnected(true); second.enqueue('second'); release(); await tick();
  assert.deepEqual(a, ['first']); assert.deepEqual(b, ['second']); assert.equal(first.enqueue('late'), false); second.dispose();
});
test('UTF-16 surrogate pairs are never split between requests', async () => {
  const sent = [];
  const queue = createInputQueue({ send: async data => sent.push(data), onError: assert.fail, chunkSize: 3 });
  queue.setConnected(true); queue.enqueue('ab😀cd'); await tick();
  assert.deepEqual(sent, ['ab', '😀c', 'd']); assert.equal(sent.join(''), 'ab😀cd'); queue.dispose();
});
test('bounded queue rejects excess input and drops pending data', async () => {
  const sent = [], errors = []; let release;
  const queue = createInputQueue({ send: data => { sent.push(data); return new Promise(resolve => { release = resolve; }); }, onError: error => errors.push(error), maxPending: 3 });
  queue.setConnected(true); queue.enqueue('a'); queue.enqueue('123'); assert.equal(queue.enqueue('4'), false);
  release(); await tick(); assert.deepEqual(sent, ['a']); assert.equal(errors.length, 1); queue.dispose();
});
