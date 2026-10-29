import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { readNight } from '../src/digest/read.js';

const tmp = mkdtempSync(join(tmpdir(), 'rig-digest-'));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

describe('readNight', () => {
  it('reads runs/2026-10-28: 5 jobs, 1 bad line', () => {
    const n = readNight('runs', '2026-10-28');
    expect(n).not.toBeNull();
    if (!n) return;
    expect(n.badLines).toBe(1);
    expect(n.rows.map((r) => r.job)).toEqual([
      'digest/render',
      'fixtures/refresh',
      'lane/sync',
      'notes/backup',
      'rig/rotate-logs',
    ]);
    const refresh = n.rows.find((r) => r.job === 'fixtures/refresh');
    expect(refresh).toEqual({
      job: 'fixtures/refresh',
      owner: 'rook',
      runs: 4,
      retries: 3,
      lastStatus: 'ok',
      lastError: null,
      firstAt: '2026-10-29T01:30:00+01:00',
      lastAt: '2026-10-29T01:37:00+01:00',
    });
    const backup = n.rows.find((r) => r.job === 'notes/backup');
    expect(backup?.lastStatus).toBe('fail');
    expect(backup?.lastError).toBe('quota exceeded');
    const sync = n.rows.find((r) => r.job === 'lane/sync');
    expect(sync?.runs).toBe(8);
    expect(sync?.retries).toBe(1);
    expect(sync?.firstAt).toBe('2026-10-28T23:00:06+01:00');
  });

  it('keeps a row whose owner is null', () => {
    const n = readNight('runs', '2026-10-28');
    const render = n?.rows.find((r) => r.job === 'digest/render');
    expect(render?.owner).toBeNull();

    writeFileSync(
      join(tmp, '2026-01-01.jsonl'),
      '{"at":"2026-01-01T01:00:00+01:00","job":"a","status":"ok","owner":null}\n',
    );
    expect(readNight(tmp, '2026-01-01')?.rows[0]?.owner).toBeNull();
  });

  it('returns null for a night with no file', () => {
    expect(readNight(tmp, '2026-01-09')).toBeNull();
  });

  it('returns no rows for an empty file', () => {
    writeFileSync(join(tmp, '2026-01-02.jsonl'), '');
    expect(readNight(tmp, '2026-01-02')).toEqual({ night: '2026-01-02', rows: [], badLines: 0 });
  });

  it('ignores blank lines and counts lines of the wrong shape', () => {
    writeFileSync(
      join(tmp, '2026-01-03.jsonl'),
      [
        '',
        '{"at":"2026-01-03T01:00:00+01:00","job":"a","status":"retry","owner":"x","error":"e1"}',
        '   ',
        '{"at":"2026-01-03T01:01:00+01:00","job":"a","status":"maybe","owner":"x"}',
        '{"at":"2026-01-03T01:02:00+01:00","job":"a","status":"ok"}',
        '[1,2]',
        'not json',
        '{"at":"2026-01-03T01:03:00+01:00","job":"a","status":"fail","owner":"x","error":"e2"}',
      ].join('\n'),
    );
    const n = readNight(tmp, '2026-01-03');
    expect(n?.badLines).toBe(4);
    expect(n?.rows).toEqual([
      {
        job: 'a',
        owner: 'x',
        runs: 2,
        retries: 1,
        lastStatus: 'fail',
        lastError: 'e2',
        firstAt: '2026-01-03T01:00:00+01:00',
        lastAt: '2026-01-03T01:03:00+01:00',
      },
    ]);
  });

  it('rejects a night that is not a date', () => {
    expect(readNight('runs', '../package')).toBeNull();
  });
});
