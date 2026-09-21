// A small bounded-concurrency map, used in place of an unbounded Promise.all.
//
// scheduled-staging-sweep.ts used to fan out one getSessionMeta call per open
// session -- up to MAX_RECONCILE (500) of them -- through a single
// `Promise.all(sessions.map(...))`. RTDB does not bill operations, so this was
// never a cost problem, but it is still 500 concurrent reads launched at once
// from a single 256MiB function instance with nothing bounding how many are
// in flight together. This runs the same work with at most `concurrency`
// promises outstanding at a time.
//
// Deliberately not a dependency (p-limit and friends): the whole thing is a
// worker-pool over a shared cursor, and pulling in a package for it would cost
// every future importer of this module a transitive dependency for a dozen
// lines of code.
//
// Pure and infrastructure-free on purpose -- same reasoning as
// staging-assembly.ts's split from staging.ts -- so it is testable without an
// emulator.

/**
 * Run `fn` over `items` with at most `concurrency` calls in flight at once.
 *
 * Results are returned in the same order as `items`, regardless of which
 * call finishes first -- callers can treat this as a drop-in replacement for
 * `Promise.all(items.map(fn))`.
 */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let nextIndex = 0;

  async function worker(): Promise<void> {
    for (;;) {
      const index = nextIndex++;
      if (index >= items.length) return;
      results[index] = await fn(items[index], index);
    }
  }

  const workerCount = Math.max(1, Math.min(concurrency, items.length));
  await Promise.all(Array.from({ length: workerCount }, worker));

  return results;
}
