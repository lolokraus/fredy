/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

// Structured detail attributes per listing (JSON array of {label, value}), shown
// separately from the free-text description.
export function up(db) {
  db.exec(`
    ALTER TABLE listings ADD COLUMN attributes TEXT;
  `);
}
