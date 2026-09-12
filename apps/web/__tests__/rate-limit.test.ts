import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { clientKey, rateLimit } from '@/lib/rate-limit';

describe('rateLimit', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  // Each test uses its own key so the module-level map never bleeds state.
  const key = () => `k-${Math.random()}`;

  it('allows up to the limit and then blocks', () => {
    const k = key();
    for (let i = 0; i < 3; i++) {
      expect(rateLimit(k, 3, 60_000).allowed).toBe(true);
    }
    const blocked = rateLimit(k, 3, 60_000);
    expect(blocked.allowed).toBe(false);
    expect(blocked.remaining).toBe(0);
    expect(blocked.retryAfterSeconds).toBeGreaterThan(0);
    expect(blocked.retryAfterSeconds).toBeLessThanOrEqual(60);
  });

  it('reports remaining quota', () => {
    const k = key();
    expect(rateLimit(k, 5, 60_000).remaining).toBe(4);
    expect(rateLimit(k, 5, 60_000).remaining).toBe(3);
  });

  it('resets once the window has elapsed', () => {
    const k = key();
    rateLimit(k, 1, 10_000);
    expect(rateLimit(k, 1, 10_000).allowed).toBe(false);
    vi.advanceTimersByTime(10_001);
    expect(rateLimit(k, 1, 10_000).allowed).toBe(true);
  });

  it('keeps separate keys separate', () => {
    const a = key();
    const b = key();
    rateLimit(a, 1, 60_000);
    expect(rateLimit(a, 1, 60_000).allowed).toBe(false);
    expect(rateLimit(b, 1, 60_000).allowed).toBe(true);
  });

  it('retryAfter counts down as the window ages', () => {
    const k = key();
    rateLimit(k, 1, 60_000);
    vi.advanceTimersByTime(45_000);
    expect(rateLimit(k, 1, 60_000).retryAfterSeconds).toBe(15);
  });
});

describe('clientKey', () => {
  it('uses only the first x-forwarded-for hop', () => {
    const h = new Headers({ 'x-forwarded-for': '203.0.113.5, 10.0.0.1, 10.0.0.2' });
    expect(clientKey(h)).toBe('203.0.113.5');
  });

  it('cannot be multiplied by prepending fake hops', () => {
    // An attacker controls what they *append* behind a real proxy that
    // prepends the true peer; they cannot change the left-most entry.
    const h = new Headers({ 'x-forwarded-for': '203.0.113.5, 1.2.3.4' });
    expect(clientKey(h)).toBe('203.0.113.5');
  });

  it('falls back to x-real-ip, then to a shared bucket', () => {
    expect(clientKey(new Headers({ 'x-real-ip': '198.51.100.7' }))).toBe('198.51.100.7');
    expect(clientKey(new Headers())).toBe('unknown');
    expect(clientKey(new Headers({ 'x-forwarded-for': '  ' }))).toBe('unknown');
  });
});
