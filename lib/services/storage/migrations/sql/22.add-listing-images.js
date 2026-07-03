/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

// Full image gallery per listing (JSON array of URLs); image_url stays the cover.
export function up(db) {
  db.exec(`
    ALTER TABLE listings ADD COLUMN images TEXT;
  `);
}
