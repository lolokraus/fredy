/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

/**
 * Willhaben provider (willhaben.at — the largest Austrian classifieds portal).
 *
 * Willhaben is a Next.js server-rendered site: both search and detail pages embed
 * their data as JSON inside a `<script id="__NEXT_DATA__">` tag, so the HTML is
 * fetched and that blob parsed instead of scraping the DOM or driving a browser.
 * Search listings live at `props.pageProps.searchResult.advertSummaryList
 * .advertSummary[]`; each advert exposes an `attributes.attribute[]` list of
 * `{ name, values }` pairs (`HEADING`, `PRICE`, `COORDINATES`, …). Coordinates
 * come from the payload, so these listings skip external geocoding.
 */

import * as cheerio from 'cheerio';
import { buildHash, isOneOf } from '../utils.js';
import { extractNumber } from '../utils/extract-number.js';
import logger from '../services/logger.js';
/** @import { ParsedListing } from '../types/listing.js' */
/** @import { ProviderConfig } from '../types/providerConfig.js' */

let appliedBlackList = [];

/**
 * Read the first value of a named attribute from a Willhaben advert.
 * @param {any} ad - A single `advertSummary` entry.
 * @param {string} name - Attribute name (e.g. `HEADING`).
 * @returns {string|null} The first value, or null when absent.
 */
function attr(ad, name) {
  const found = ad?.attributes?.attribute?.find((a) => a.name === name);
  return found?.values?.[0] ?? null;
}

/**
 * Convert the small HTML fragments Willhaben stores in text attributes
 * (`<p>`, `<br>`) into readable plain text.
 * @param {string|null|undefined} html
 * @returns {string}
 */
function stripHtml(html) {
  if (!html) return '';
  return html
    .replace(/<\s*br\s*\/?>/gi, '\n')
    .replace(/<\/\s*p\s*>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&nbsp;/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]+/g, ' ')
    .trim();
}

/**
 * Extract the advertiser's display name from a detail-page advert.
 * @param {any} ad - The `advertDetails` object from the detail page.
 * @returns {string} The contact name, or an empty string when unavailable.
 */
function contactName(ad) {
  const details = ad?.advertContactDetails?.contactDetail ?? [];
  const entry = details.find((d) => d.id === 'contactName');
  return (entry?.contactDetailField?.[0]?.value ?? '').trim();
}

/**
 * Build the free-text description for a detail-page advert: the main description
 * plus the separate location and "other" prose sections. Structured facts are
 * kept out of this and returned by buildAttributes instead.
 * @param {any} ad - The `advertDetails` object from the detail page.
 * @returns {string}
 */
function buildDescription(ad) {
  const description = stripHtml(attr(ad, 'DESCRIPTION'));
  const location = stripHtml(attr(ad, 'GENERAL_TEXT_ADVERT/Lage'));
  const other = stripHtml(attr(ad, 'GENERAL_TEXT_ADVERT/Sonstiges'));

  return [description || null, location ? `Lage:\n${location}` : null, other ? `Sonstiges:\n${other}` : null]
    .filter(Boolean)
    .join('\n\n')
    .trim();
}

// Ordered, labeled set of structured detail attributes shown separately from the
// free-text description. `code` is the Willhaben attribute name; `unit` appends a
// suffix, `euro` formats a raw number as currency, `list` joins all values,
// `skipZero` drops "0" values.
const ATTRIBUTE_FIELDS = [
  { code: 'PROPERTY_TYPE', label: 'Objekttyp' },
  { code: 'OWNAGETYPE', label: 'Besitzform' },
  { code: 'NO_OF_ROOMS', label: 'Zimmer' },
  { code: 'ESTATE_SIZE/LIVING_AREA', label: 'Wohnfläche', unit: 'm²' },
  { code: 'FLOOR', label: 'Stock' },
  { code: 'BUILDING_TYPE', label: 'Bautyp' },
  { code: 'BUILDING_CONDITION', label: 'Zustand' },
  { code: 'FLOOR_SURFACE', label: 'Böden' },
  { code: 'HEATING', label: 'Heizung' },
  { code: 'ESTATE_PREFERENCE', label: 'Ausstattung', list: true },
  { code: 'AVAILABLE_DATE', label: 'Verfügbar ab' },
  { code: 'DURATION/HASTERMLIMIT', label: 'Befristung' },
  { code: 'DURATION/TERMLIMITTEXT', label: 'Befristung (Jahre)' },
  { code: 'PRICE/SQUARE_METER_FOR_DISPLAY_WITH_UNIT', label: 'Preis pro m²' },
  { code: 'ADDITIONAL_COST/FEE', label: 'Betriebskosten' },
  { code: 'ADDITIONAL_COST/DEPOSIT', label: 'Kaution', euro: true },
  { code: 'RENTAL_PRICE/FURNITURE_COST', label: 'Möblierungskosten', euro: true, skipZero: true },
  { code: 'RENTAL_PRICE/PRICE_DESCRIPTION', label: 'Preisdetails' },
  { code: 'ENERGY_HWB', label: 'Energiekennwert (HWB)', unit: 'kWh/m²a' },
  { code: 'ENERGY_FGEE', label: 'fGEE' },
];

const euroFormatter = new Intl.NumberFormat('de-DE');

/**
 * Format a raw numeric string as a euro amount (e.g. "3536" -> "€ 3.536").
 * Returns the input unchanged when it is not numeric.
 * @param {string} raw
 * @returns {string}
 */
function formatEuro(raw) {
  const num = Number(raw);
  return Number.isNaN(num) ? raw : `€ ${euroFormatter.format(num)}`;
}

/**
 * Build the structured attribute list (label/value) for a detail-page advert,
 * covering all meaningful fields plus the advertiser. Empty and internal fields
 * are skipped.
 * @param {any} ad - The `advertDetails` object from the detail page.
 * @returns {{label: string, value: string}[]}
 */
function buildAttributes(ad) {
  const attributes = [];
  for (const field of ATTRIBUTE_FIELDS) {
    const found = ad?.attributes?.attribute?.find((a) => a.name === field.code);
    const values = (found?.values ?? []).map((v) => String(v).trim()).filter(Boolean);
    if (values.length === 0) continue;
    let value = field.list ? values.join(', ') : values[0];
    if (field.skipZero && Number(value) === 0) continue;
    if (field.euro) value = formatEuro(value);
    if (field.unit) value = `${value} ${field.unit}`;
    attributes.push({ label: field.label, value });
  }

  const name = contactName(ad);
  if (name) {
    const suffix = attr(ad, 'ISPRIVATE') === '1' ? ' (privat)' : '';
    attributes.push({ label: 'Anbieter', value: `${name}${suffix}` });
  }
  return attributes;
}

/**
 * Enrich a listing with data from its Willhaben detail page. Like the search
 * page, the detail page is a Next.js document embedding the advert as JSON in
 * `__NEXT_DATA__` (`props.pageProps.advertDetails`), so no browser is required.
 * Always resolves — on any failure the original listing is returned unchanged.
 *
 * @param {ParsedListing} listing - The listing to enrich.
 * @returns {Promise<ParsedListing>}
 */
async function fetchDetails(listing) {
  try {
    if (!listing.link) return listing;
    const response = await fetch(listing.link, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'de-AT,de;q=0.9,en;q=0.8',
      },
    });
    if (!response.ok) {
      logger.warn(`Willhaben: detail request failed for '${listing.id}' (status ${response.status}).`);
      return listing;
    }

    const html = await response.text();
    const $ = cheerio.load(html);
    const raw = $('#__NEXT_DATA__').text();
    if (!raw) return listing;

    const ad = JSON.parse(raw)?.props?.pageProps?.advertDetails;
    if (!ad) return listing;

    const description = buildDescription(ad);
    // The detail page carries the full gallery; the search page only had previews.
    const gallery = imageUrls(ad);
    return {
      ...listing,
      description: description || listing.description,
      images: gallery.length > 0 ? gallery : listing.images,
      attributes: buildAttributes(ad),
    };
  } catch (error) {
    logger.warn(`Could not fetch Willhaben detail page for listing '${listing.id}'.`, error?.message || error);
    return listing;
  }
}

/**
 * Collect the gallery image URLs from an advert's `advertImageList`.
 * Prefers the full-resolution `referenceImageUrl`; `mainImageUrl` is only a small
 * cover-cropped preview (`_hoved`) and looks pixelated when shown large.
 * @param {any} ad - An advert (search summary or detail) carrying `advertImageList`.
 * @returns {string[]} Ordered list of image URLs (empty when none).
 */
function imageUrls(ad) {
  const images = ad?.advertImageList?.advertImage ?? [];
  return images.map((img) => img?.referenceImageUrl ?? img?.mainImageUrl).filter(Boolean);
}

/**
 * Flatten a single Willhaben advert into the raw shape consumed by `normalize`.
 * @param {any} ad - A single `advertSummary` entry.
 * @returns {any} Raw listing fields.
 */
function mapAd(ad) {
  const street = attr(ad, 'ADDRESS');
  const postcode = attr(ad, 'POSTCODE');
  const location = attr(ad, 'LOCATION');
  const cityLine = [postcode, location].filter(Boolean).join(' ');
  const address = [street, cityLine].filter(Boolean).join(', ') || null;

  return {
    id: attr(ad, 'ADID'),
    title: attr(ad, 'HEADING'),
    // PRICE is a machine-readable decimal (dot = decimal separator), unlike the
    // localized PRICE_FOR_DISPLAY ("€ 884,58"), and is preferred for parsing.
    price: attr(ad, 'PRICE'),
    size: attr(ad, 'ESTATE_SIZE/LIVING_AREA') ?? attr(ad, 'ESTATE_SIZE'),
    rooms: attr(ad, 'NUMBER_OF_ROOMS'),
    seoUrl: attr(ad, 'SEO_URL'),
    address,
    coordinates: attr(ad, 'COORDINATES'),
    description: attr(ad, 'BODY_DYN'),
    image: ad?.advertImageList?.advertImage?.[0]?.mainImageUrl ?? null,
    // The search payload carries only a few preview images per advert; the full
    // gallery is fetched later in fetchDetails from the detail page.
    images: imageUrls(ad),
  };
}

/**
 * Fetch the Willhaben search page and extract listings from the embedded
 * `__NEXT_DATA__` JSON blob.
 * @param {string} url - The user-provided Willhaben search URL.
 * @returns {Promise<any[]>} Raw listings (pre-normalization).
 */
async function getListings(url) {
  const response = await fetch(url, {
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'de-AT,de;q=0.9,en;q=0.8',
    },
  });
  if (!response.ok) {
    logger.error('Error fetching data from Willhaben:', response.statusText);
    return [];
  }

  const html = await response.text();
  const $ = cheerio.load(html);
  const raw = $('#__NEXT_DATA__').text();
  if (!raw) {
    logger.error('Willhaben: could not find __NEXT_DATA__ payload in page.');
    return [];
  }

  let data;
  try {
    data = JSON.parse(raw);
  } catch (error) {
    logger.error('Willhaben: failed to parse __NEXT_DATA__ JSON.', error?.message || error);
    return [];
  }

  const ads = data?.props?.pageProps?.searchResult?.advertSummaryList?.advertSummary;
  if (!Array.isArray(ads)) {
    logger.warn('Willhaben: no advertSummary list found in payload.');
    return [];
  }

  return ads.map(mapAd);
}

/**
 * @param {any} o
 * @returns {ParsedListing}
 */
function normalize(o) {
  const id = o.id != null ? buildHash(o.id, o.price) : null;
  const link = o.seoUrl ? `https://www.willhaben.at/iad/${o.seoUrl}` : null;

  const parsedPrice = o.price != null ? parseFloat(o.price) : NaN;
  const price = Number.isNaN(parsedPrice) ? null : Math.round(parsedPrice);

  let latitude;
  let longitude;
  if (o.coordinates) {
    const [lat, lng] = o.coordinates.split(',').map((v) => parseFloat(v));
    if (!Number.isNaN(lat) && !Number.isNaN(lng)) {
      latitude = lat;
      longitude = lng;
    }
  }

  return {
    id,
    link,
    title: o.title || '',
    price,
    size: extractNumber(o.size),
    rooms: extractNumber(o.rooms),
    address: o.address || 'NO ADDRESS FOUND',
    image: o.image,
    images: Array.isArray(o.images) ? o.images : [],
    description: o.description,
    latitude,
    longitude,
  };
}

/**
 * @param {ParsedListing} o
 * @returns {boolean}
 */
function applyBlacklist(o) {
  const titleNotBlacklisted = !isOneOf(o.title, appliedBlackList);
  const descNotBlacklisted = !isOneOf(o.description, appliedBlackList);
  return o.id != null && titleNotBlacklisted && descNotBlacklisted;
}

/** @type {ProviderConfig} */
const config = {
  requiredFieldNames: ['id', 'link', 'title', 'price', 'size', 'rooms', 'address', 'image', 'description'],
  url: null,
  crawlFields: {
    id: 'id',
    title: 'title',
    price: 'price',
    size: 'size',
    rooms: 'rooms',
    link: 'link',
    address: 'address',
  },
  // published.descending ("Aktualität") — newest first.
  sortByDateParam: 'sort=1',
  normalize,
  filter: applyBlacklist,
  getListings,
  fetchDetails,
};

export const init = (sourceConfig, blacklist) => {
  config.enabled = sourceConfig.enabled;
  config.url = sourceConfig.url;
  appliedBlackList = blacklist || [];
};

export const metaInformation = {
  name: 'Willhaben',
  baseUrl: 'https://www.willhaben.at/',
  id: 'willhaben',
  // Country the provider serves; drives map centering. German providers omit it (default 'de').
  country: 'at',
};

export { config };
