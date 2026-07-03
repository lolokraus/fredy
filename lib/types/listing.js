/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

/**
 * @typedef {Object} ParsedListing
 * @property {string} id Stable unique identifier (hash) of the listing.
 * @property {string} link Link to the listing detail page.
 * @property {string} image Link to the listing's cover image (used for list/grid thumbnails).
 * @property {string[]} [images] Optional full image gallery (URLs); shown as a carousel in the detail view.
 * @property {string} title Title or headline of the listing.
 * @property {string} [description] Description of the listing.
 * @property {{label: string, value: string}[]} [attributes] Optional structured detail attributes (label/value), shown separately from the description.
 * @property {string} [address] Optional address/location text.
 * @property {number} [price] Optional price of the listing.
 * @property {number} [size] Optional size of the listing.
 * @property {number} [rooms] Optional number of rooms.
 * @property {number} [latitude] Optional latitude.
 * @property {number} [longitude] Optional longitude.
 * @property {number} [distance_to_destination] Optional distance to destination.
 */

export {};
