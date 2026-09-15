/**
 * @jest-environment node
 *
 * mapWithConcurrency (functions/src/concurrency-limit.ts): the bounded-
 * concurrency helper that replaced the unbounded Promise.all in
 * scheduled-staging-sweep.ts's live-sessions reconciliation pass. Pure and
 * infrastructure-free, so no emulator is needed.
 */

import { mapWithConcurrency } from '../../lib/concurrency-limit.js';

describe('mapWithConcurrency', () => {
  it('returns results in input order regardless of completion order', async () => {
    const delays = [30, 10, 20, 0, 15];

    const results = await mapWithConcurrency(delays, 3, async (delay, index) => {
      await new Promise((resolve) => setTimeout(resolve, delay));
      return index;
    });

    expect(results).toEqual([0, 1, 2, 3, 4]);
  });

  it('never runs more than `concurrency` calls at once', async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const items = Array.from({ length: 20 }, (_, i) => i);

    await mapWithConcurrency(items, 4, async (item) => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 5));
      inFlight--;
      return item * 2;
    });

    expect(maxInFlight).toBeLessThanOrEqual(4);
  });

  it('runs every item exactly once', async () => {
    const seen = [];
    const items = Array.from({ length: 37 }, (_, i) => i);

    await mapWithConcurrency(items, 5, async (item) => {
      seen.push(item);
    });

    expect(seen.slice().sort((a, b) => a - b)).toEqual(items);
  });

  it('propagates a rejection rather than swallowing it', async () => {
    await expect(
      mapWithConcurrency([1, 2, 3], 2, async (item) => {
        if (item === 2) throw new Error('boom');
        return item;
      })
    ).rejects.toThrow('boom');
  });

  it('handles concurrency higher than the item count', async () => {
    const results = await mapWithConcurrency([1, 2], 20, async (item) => item + 1);
    expect(results).toEqual([2, 3]);
  });

  it('handles an empty list', async () => {
    const results = await mapWithConcurrency([], 5, async (item) => item);
    expect(results).toEqual([]);
  });

  it('handles a concurrency of 1 by running strictly sequentially', async () => {
    const order = [];
    await mapWithConcurrency([1, 2, 3], 1, async (item) => {
      order.push(`start-${item}`);
      await new Promise((resolve) => setTimeout(resolve, 5));
      order.push(`end-${item}`);
    });

    expect(order).toEqual(['start-1', 'end-1', 'start-2', 'end-2', 'start-3', 'end-3']);
  });
});
