import { afterEach, describe, expect, it, vi } from 'vitest';

import { READER_LAN_PROTOCOL_VERSION } from '@/modules/reader/lan/contracts';
import { LanClient } from '../web/src/client';

afterEach(() => vi.restoreAllMocks());

describe('LAN web client', () => {
  it('evicts the least recently used inactive query when the cache is full', () => {
    const client = new LanClient();
    const first = client.query('/api/v1/items/0');
    const recent = client.query('/api/v1/items/1');

    for (let index = 2; index < 32; index += 1) {
      client.query(`/api/v1/items/${index}`);
    }
    expect(client.query('/api/v1/items/1')).toBe(recent);

    client.query('/api/v1/items/32');

    expect(client.query('/api/v1/items/1')).toBe(recent);
    expect(client.query('/api/v1/items/0')).not.toBe(first);
  });

  it('keeps evicted observed queries available for invalidation', () => {
    const client = new LanClient();
    const observed = Array.from({ length: 32 }, (_, index) => client.query(`/api/v1/items/${index}`));
    let notifications = 0;
    const unsubscribe = observed.map((query) => query.subscribe(() => { notifications += 1; }));

    client.query('/api/v1/items/new');

    expect(client.query('/api/v1/items/0')).not.toBe(observed[0]);
    client.dispose();
    expect(notifications).toBeGreaterThan(0);
    unsubscribe.forEach((stop) => stop());
  });

  it('accepts an idempotent logout response when the session is already gone', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 204 }));
    const client = new LanClient();

    await client.logout();

    expect(fetch).toHaveBeenCalledWith('/api/v1/session', expect.objectContaining({ method: 'DELETE' }));
    expect(client.getSnapshot().phase).toBe('login');
  });

  it('can resume a client after it has been disposed', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      if (String(input) === '/api/v1/session') {
        return new Response(JSON.stringify({
          protocolVersion: READER_LAN_PROTOCOL_VERSION,
          serviceId: 'service-1',
          data: { authenticated: true },
        }), { headers: { 'Content-Type': 'application/json' } });
      }
      return new Response(null, { status: 503 });
    });
    const client = new LanClient();
    client.dispose();

    await client.resume();
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/v1/events?'),
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    ));

    await vi.waitFor(() => expect(client.getSnapshot().phase).toBe('offline'));
  });
});
