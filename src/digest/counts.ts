import type { Night } from './types.js';

export type Counts = { ok: number; retry: number; fail: number };

// DigestRow keeps no per-line statuses, so: ok/fail = jobs whose last status is that,
// retry = total retries across jobs.
export function countNight(night: Night): Counts {
  return {
    ok: night.rows.filter((r) => r.lastStatus === 'ok').length,
    retry: night.rows.reduce((sum, r) => sum + r.retries, 0),
    fail: night.rows.filter((r) => r.lastStatus === 'fail').length,
  };
}
