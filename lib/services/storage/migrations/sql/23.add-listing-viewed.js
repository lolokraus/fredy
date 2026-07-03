/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

// Tracks whether a listing has been opened/viewed, so it can be filtered.
export function up(db) {
  db.exec(`
    ALTER TABLE listings ADD COLUMN viewed INTEGER NOT NULL DEFAULT 0;
  `);
}
