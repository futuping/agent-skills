import net from 'node:net';
import { chmod, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes, timingSafeEqual } from 'node:crypto';

export async function serveOnce(payload, timeoutMs = 30000) {
  const directory = await mkdtemp(join(tmpdir(), 'bwlogin-'));
  await chmod(directory, 0o700);
  const socketPath = join(directory, 'c.sock');
  const nonce = randomBytes(32).toString('hex');
  let consumed = false;
  const peers = new Set();
  const server = net.createServer(socket => {
    peers.add(socket);
    socket.on('close', () => peers.delete(socket));
    socket.on('error', () => {});
    socket.setTimeout(3000, () => socket.destroy());
    let buffer = '';
    socket.on('data', data => {
      buffer += data.toString('utf8');
      if (buffer.length > 128) return socket.destroy();
      if (!buffer.endsWith('\n')) return;
      const provided = Buffer.from(buffer.trim());
      const expected = Buffer.from(nonce);
      if (consumed || provided.length !== expected.length || !timingSafeEqual(provided, expected)) return socket.destroy();
      consumed = true;
      socket.end(JSON.stringify(payload));
      server.close();
    });
  });
  const close = async () => {
    clearTimeout(timer);
    for (const peer of peers) peer.destroy();
    if (server.listening) await new Promise(resolve => server.close(resolve));
    await rm(directory, { recursive: true, force: true });
  };
  let timer;
  try {
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(socketPath, resolve);
    });
    await chmod(socketPath, 0o600);
    timer = setTimeout(() => { close().catch(() => {}); }, timeoutMs);
    timer.unref();
    return { socketPath, nonce, close };
  } catch (error) { await close(); throw error; }
}

export function receiveOnce({ socketPath, nonce }) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(socketPath);
    let buffer = '';
    socket.setTimeout(5000, () => socket.destroy(new Error('channel_timeout')));
    socket.once('connect', () => socket.write(`${nonce}\n`));
    socket.on('data', data => {
      buffer += data.toString('utf8');
      if (buffer.length > 131072) socket.destroy(new Error('channel_limit'));
    });
    socket.once('error', reject);
    socket.once('end', () => {
      try { resolve(JSON.parse(buffer)); } catch { reject(new Error('channel_failed')); }
    });
  });
}
