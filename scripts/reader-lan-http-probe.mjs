import assert from 'node:assert/strict';
import { createConnection } from 'node:net';

/** Real wire requests exercise the engine parser as well as the application guards. */
function rawStatus(address, method, path, headers, body = '') {
  return new Promise((resolve, reject) => {
    const socket = createConnection({ host: address.hostname, port: Number(address.port) });
    let response = '';
    const finish = (error, status) => {
      socket.destroy();
      if (error) reject(error); else resolve(status);
    };
    socket.setTimeout(3000, () => finish(new Error('HTTP boundary probe timed out')));
    socket.once('error', () => finish(new Error('HTTP boundary probe connection failed')));
    socket.once('end', () => { if (!response.includes('\r\n')) finish(new Error('HTTP closed before a status line')); });
    socket.on('data', (chunk) => {
      response += chunk.toString('ascii');
      const match = /^HTTP\/1\.[01] (\d{3}) /u.exec(response);
      if (match) finish(null, Number(match[1]));
      else if (response.length > 8192) finish(new Error('Invalid HTTP response'));
    });
    socket.once('connect', () => {
      socket.write(`${method} ${path} HTTP/1.1\r\n${headers.map(([name, value]) => `${name}: ${value}\r\n`).join('')}Connection: close\r\n\r\n${body}`);
    });
  });
}

export async function checkNativeHttpBoundaries(origin) {
  const address = new URL(origin);
  const host = ['Host', address.host];
  const source = ['Origin', origin];
  const cases = [
    { name: 'Host must match the listening address', method: 'GET', path: '/', headers: [['Host', 'untrusted.invalid']], status: 403 },
    { name: 'session POST requires Origin', method: 'POST', path: '/api/v1/session', headers: [host], status: 403 },
    { name: 'duplicate Origin is rejected', method: 'POST', path: '/api/v1/session', headers: [host, source, ['Origin', 'http://untrusted.invalid']], status: 403 },
    { name: 'session requires JSON', method: 'POST', path: '/api/v1/session', headers: [host, source, ['Content-Type', 'text/plain']], status: 400 },
    { name: 'GET cannot carry a body', method: 'GET', path: '/', headers: [host, ['Content-Length', '1']], body: 'x', status: 400 },
    { name: 'session body is capped before buffering', method: 'POST', path: '/api/v1/session', headers: [host, source, ['Content-Type', 'application/json'], ['Content-Length', '1025']], status: 413 },
    { name: 'chunked upload is rejected', method: 'POST', path: '/api/v1/session', headers: [host, source, ['Transfer-Encoding', 'chunked']], body: '0\r\n\r\n', status: 413 },
    { name: 'URL is capped at 4 KiB', method: 'GET', path: `/${'x'.repeat(4100)}`, headers: [host], status: 414 },
    { name: 'headers in total are capped at 8 KiB', method: 'GET', path: '/', headers: [host, ['X-Padding-One', 'x'.repeat(4150)], ['X-Padding-Two', 'x'.repeat(4150)]], status: 431 },
    { name: 'encoded asset traversal is rejected', method: 'GET', path: '/assets/%2e%2e/manifest.json', headers: [host], status: 404 },
  ];
  for (const item of cases) {
    assert.equal(await rawStatus(address, item.method, item.path, item.headers, item.body), item.status, item.name);
  }
  return cases.length;
}
