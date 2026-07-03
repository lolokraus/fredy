/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { vi, describe, it, expect, beforeEach } from 'vitest';

// SqliteConnection is mocked to assert the SQL/params the storage layer runs
// without a real SQLite DB (mirrors listingStatus.test.js).

const calls = {
  execute: [],
  query: [],
};

const sqliteMock = {
  execute: (sql, params) => {
    calls.execute.push({ sql, params });
    return { changes: 1 };
  },
  query: (sql, params) => {
    calls.query.push({ sql, params });
    if (sqliteMock.__queryHandler) return sqliteMock.__queryHandler(sql, params);
    return [];
  },
  __queryHandler: null,
};

vi.mock('../../lib/services/storage/SqliteConnection.js', () => ({
  default: sqliteMock,
}));

describe('listingsStorage.markListingViewed', () => {
  let listingsStorage;

  beforeEach(async () => {
    calls.execute.length = 0;
    calls.query.length = 0;
    sqliteMock.__queryHandler = null;
    listingsStorage = await import('../../lib/services/storage/listingsStorage.js');
  });

  it('runs an UPDATE setting viewed = 1 for the given id', () => {
    const changes = listingsStorage.markListingViewed('listing-1');
    expect(changes).toBe(1);
    expect(calls.execute).toHaveLength(1);
    expect(calls.execute[0].sql).toMatch(/UPDATE listings SET viewed = 1 WHERE id = @id/);
    expect(calls.execute[0].params).toEqual({ id: 'listing-1' });
  });

  it('returns 0 when no id is supplied (no SQL is run)', () => {
    const result = listingsStorage.markListingViewed(null);
    expect(result).toBe(0);
    expect(calls.execute).toHaveLength(0);
  });
});

describe('listingsStorage.queryListings viewedFilter', () => {
  let listingsStorage;

  beforeEach(async () => {
    calls.execute.length = 0;
    calls.query.length = 0;
    sqliteMock.__queryHandler = (sql) => {
      if (/COUNT\(1\)/.test(sql)) return [{ cnt: 0 }];
      return [];
    };
    listingsStorage = await import('../../lib/services/storage/listingsStorage.js');
  });

  it('adds (l.viewed = 1) when viewedFilter is true', () => {
    listingsStorage.queryListings({ viewedFilter: true, userId: 'u1', isAdmin: true });
    const pageQuery = calls.query.find((c) => !/COUNT\(1\)/.test(c.sql));
    expect(pageQuery.sql).toMatch(/\(l\.viewed = 1\)/);
  });

  it('adds (l.viewed = 0) when viewedFilter is false', () => {
    listingsStorage.queryListings({ viewedFilter: false, userId: 'u1', isAdmin: true });
    const pageQuery = calls.query.find((c) => !/COUNT\(1\)/.test(c.sql));
    expect(pageQuery.sql).toMatch(/\(l\.viewed = 0\)/);
  });

  it('does not filter by viewed when viewedFilter is undefined', () => {
    listingsStorage.queryListings({ userId: 'u1', isAdmin: true });
    const pageQuery = calls.query.find((c) => !/COUNT\(1\)/.test(c.sql));
    expect(pageQuery.sql).not.toMatch(/l\.viewed/);
  });
});
