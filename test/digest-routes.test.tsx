import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';

const runsDir = mkdtempSync(join(tmpdir(), 'rig-digest-routes-'));

// Real-looking night: file order differs from job order, one job retried.
const REAL = '2026-10-28';
const EMPTY = '2026-10-27';
const BAD = '2026-10-26';
const MISSING = '2026-01-01';

const line = (at: string, job: string, status: string, owner: string | null, error?: string) =>
  JSON.stringify(error === undefined ? { at, job, status, owner } : { at, job, status, owner, error });

beforeAll(() => {
  writeFileSync(
    join(runsDir, `${REAL}.jsonl`),
    [
      line('2026-10-28T22:00:00+01:00', 'notes/backup', 'ok', 'rook'),
      line('2026-10-28T22:05:00+01:00', 'digest/render', 'retry', 'rook', 'timeout'),
      line('2026-10-28T22:10:00+01:00', 'digest/render', 'ok', 'rook'),
      line('2026-10-28T23:00:00+01:00', 'lane/sync', 'fail', null, '401'),
      line('2026-10-28T23:30:00+01:00', 'fixtures/refresh', 'ok', null),
      '',
    ].join('\n'),
  );
  writeFileSync(join(runsDir, `${EMPTY}.jsonl`), '');
  writeFileSync(
    join(runsDir, `${BAD}.jsonl`),
    [line('2026-10-26T22:00:00+01:00', 'lane/sync', 'ok', null), '{not json', ''].join('\n'),
  );
});

afterAll(() => rmSync(runsDir, { recursive: true, force: true }));

const config = {
  adapter: 'shim',
  installed: '2026-10-29T14:06:00+01:00',
  beatEverySeconds: 60,
  runsDir,
};

// Job names in the order the page lists them (first cell of each body row).
function pageJobs(html: string): string[] {
  return [...html.matchAll(/<tr[^>]*>\s*<td>([^<]*)<\/td>/g)].map((m) => m[1] ?? '');
}

describe('GET /digest/:night', () => {
  it('200 for a real night, with its jobs', async () => {
    const res = await createApp(config).request(`/digest/${REAL}`);
    const html = await res.text();
    expect(res.status).toBe(200);
    expect(html).toContain(`digest ${REAL}`);
    expect(pageJobs(html)).toEqual(['digest/render', 'fixtures/refresh', 'lane/sync', 'notes/backup']);
  });

  it('404 for a night with no file', async () => {
    const res = await createApp(config).request(`/digest/${MISSING}`);
    const html = await res.text();
    expect(res.status).toBe(404);
    expect(html).toContain('no run log for that night');
  });

  it('empty night: nothing ran, no rows', async () => {
    const res = await createApp(config).request(`/digest/${EMPTY}`);
    const html = await res.text();
    expect(res.status).toBe(200);
    expect(html).toContain('nothing ran');
    expect(pageJobs(html)).toEqual([]);
  });

  it('night with a bad line: says so', async () => {
    const res = await createApp(config).request(`/digest/${BAD}`);
    const html = await res.text();
    expect(res.status).toBe(200);
    // hono/jsx escapes the apostrophe in the rendered text.
    expect(html).toContain('1 line didn&#39;t parse');
  });
});

describe('GET /api/digest/:night', () => {
  it('200 for a real night, with rows', async () => {
    const res = await createApp(config).request(`/api/digest/${REAL}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { night: string; rows: { job: string }[]; badLines: number };
    expect(body.night).toBe(REAL);
    expect(body.badLines).toBe(0);
    expect(body.rows.map((r) => r.job)).toEqual([
      'digest/render',
      'fixtures/refresh',
      'lane/sync',
      'notes/backup',
    ]);
  });

  it('404 for a night with no file', async () => {
    const res = await createApp(config).request(`/api/digest/${MISSING}`);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'no run log', night: MISSING });
  });

  it('empty night: rows []', async () => {
    const res = await createApp(config).request(`/api/digest/${EMPTY}`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ night: EMPTY, rows: [], badLines: 0 });
  });

  it('night with a bad line: badLines 1', async () => {
    const res = await createApp(config).request(`/api/digest/${BAD}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { badLines: number; rows: unknown[] };
    expect(body.badLines).toBe(1);
    expect(body.rows).toHaveLength(1);
  });
});

describe('page and JSON agree', () => {
  it('list the same jobs in the same order', async () => {
    const app = createApp(config);
    const html = await (await app.request(`/digest/${REAL}`)).text();
    const json = (await (await app.request(`/api/digest/${REAL}`)).json()) as { rows: { job: string }[] };
    expect(pageJobs(html)).toEqual(json.rows.map((r) => r.job));
  });
});
