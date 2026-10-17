import { describe, expect, it, vi } from 'vitest';

import { ReaderQuery } from '@/modules/reader/application/reader-query';

describe('Reader queries', () => {
  it('keeps one observation while multiple screens consume the same projection', () => {
    let next!: (items: readonly string[]) => void;
    const stop = vi.fn();
    const query = new ReaderQuery<readonly string[]>([], (listener) => {
      next = listener;
      return stop;
    });
    const first = vi.fn();
    const second = vi.fn();

    const unsubscribeFirst = query.subscribe(first);
    const unsubscribeSecond = query.subscribe(second);
    next(['一本书']);

    expect(first).toHaveBeenCalled();
    expect(second).toHaveBeenCalled();
    expect(query.getSnapshot()).toMatchObject({ data: ['一本书'], loading: false, error: null });
    expect(stop).not.toHaveBeenCalled();

    unsubscribeFirst();
    expect(stop).not.toHaveBeenCalled();
    unsubscribeSecond();
    expect(stop).toHaveBeenCalledExactlyOnceWith();
  });

  it('restarts an active observation on retry and drops stale callbacks', () => {
    const observers: ((items: readonly string[]) => void)[] = [];
    const stops: (() => void)[] = [];
    const query = new ReaderQuery<readonly string[]>([], (next) => {
      observers.push(next);
      const stop = vi.fn();
      stops.push(stop);
      return stop;
    });
    const unsubscribe = query.subscribe(() => undefined);

    observers[0]?.(['旧数据']);
    query.retry();
    observers[0]?.(['迟到数据']);
    observers[1]?.(['新数据']);

    expect(query.getSnapshot().data).toEqual(['新数据']);
    expect(stops[0]).toHaveBeenCalledExactlyOnceWith();
    unsubscribe();
  });
});
