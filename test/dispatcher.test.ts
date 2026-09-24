import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'events';
import type { Socket } from 'net';
import { attachDispatcher } from '../src/dispatcher';
import { MAX_FRAME_BYTES } from '../src/protocol';

/** Minimal stand-in for `net.Socket` — dispatcher only ever calls `.on`,
 *  `.write` and `.destroy` on it. */
class FakeSocket extends EventEmitter {
  written: Buffer[] = [];
  destroyed = false;
  write(data: Buffer): boolean {
    this.written.push(data);
    return true;
  }
  destroy(): void {
    this.destroyed = true;
  }
  feed(text: string): void {
    this.emit('data', Buffer.from(text, 'utf8'));
  }
  repliesAsJson(): unknown[] {
    return this.written.map((b) => JSON.parse(b.toString('utf8').trimEnd()));
  }
}

test('answers a request via the matching handler', async () => {
  const socket = new FakeSocket();
  attachDispatcher(
    socket as unknown as Socket,
    { hello: async () => ({ manifest: {}, token: 'abc' }) },
    {},
  );
  socket.feed('{"i":1,"m":"hello","p":{}}\n');
  await new Promise((r) => setImmediate(r));

  assert.deepEqual(socket.repliesAsJson(), [{ i: 1, r: { manifest: {}, token: 'abc' } }]);
});

test('replies with an error frame when the handler rejects', async () => {
  const socket = new FakeSocket();
  attachDispatcher(
    socket as unknown as Socket,
    {
      health: async () => {
        throw new Error('boom');
      },
    },
    {},
  );
  socket.feed('{"i":2,"m":"health"}\n');
  await new Promise((r) => setImmediate(r));

  assert.deepEqual(socket.repliesAsJson(), [{ i: 2, e: { c: 'ERR', m: 'boom' } }]);
});

test('still replies when the handler rejects with a non-Error value', async () => {
  const socket = new FakeSocket();
  attachDispatcher(socket as unknown as Socket, { health: () => Promise.reject('plain string') }, {});
  socket.feed('{"i":4,"m":"health"}\n');
  await new Promise((r) => setImmediate(r));

  assert.deepEqual(socket.repliesAsJson(), [{ i: 4, e: { c: 'ERR', m: 'plain string' } }]);
});

test('replies ERR_RESULT_TOO_LARGE instead of sending an oversize result', async () => {
  const socket = new FakeSocket();
  attachDispatcher(socket as unknown as Socket, { http: async () => 'a'.repeat(MAX_FRAME_BYTES) }, {});
  socket.feed('{"i":5,"m":"http"}\n');
  await new Promise((r) => setImmediate(r));

  const replies = socket.repliesAsJson() as { i: number; e: { c: string } }[];
  assert.equal(replies.length, 1);
  assert.equal(replies[0]?.e.c, 'ERR_RESULT_TOO_LARGE');
});

test('replies with ERR_NO_METHOD for an unknown method', async () => {
  const socket = new FakeSocket();
  attachDispatcher(socket as unknown as Socket, {}, {});
  socket.feed('{"i":3,"m":"nope"}\n');
  await new Promise((r) => setImmediate(r));

  const replies = socket.repliesAsJson() as { e: { c: string } }[];
  assert.equal(replies[0]?.e.c, 'ERR_NO_METHOD');
});

test('routes a note to its handler and never replies to it', async () => {
  const socket = new FakeSocket();
  let received: unknown = null;
  attachDispatcher(socket as unknown as Socket, {}, { event: (p) => (received = p) });
  socket.feed('{"m":"event","p":{"name":"media.imported","payload":{"id":1}}}\n');
  await new Promise((r) => setImmediate(r));

  assert.deepEqual(received, { name: 'media.imported', payload: { id: 1 } });
  assert.equal(socket.written.length, 0);
});

test('destroys the socket on a malformed line', async () => {
  const socket = new FakeSocket();
  attachDispatcher(socket as unknown as Socket, {}, {});
  socket.feed('not json\n');
  assert.equal(socket.destroyed, true);
});

test('destroys the socket on an oversize frame', async () => {
  const socket = new FakeSocket();
  attachDispatcher(socket as unknown as Socket, {}, {});
  socket.feed('x'.repeat(4 * 1024 * 1024 + 1) + '\n');
  assert.equal(socket.destroyed, true);
});
