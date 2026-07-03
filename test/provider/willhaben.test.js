/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { expect } from 'vitest';
import * as similarityCache from '../../lib/services/similarity-check/similarityCache.js';
import { mockFredy, providerConfig } from '../utils.js';
import { get } from '../mocks/mockNotification.js';
import * as provider from '../../lib/provider/willhaben.js';

// Willhaben is fetch-based: it retrieves the search page HTML and parses the
// embedded __NEXT_DATA__ JSON. In offline mode the global fetch is mocked to
// serve test/testFixtures/willhaben.html.
const TEST_TIMEOUT = 120_000;

describe('#willhaben provider testsuite()', () => {
  provider.init(providerConfig.willhaben, [], []);

  it(
    'should test willhaben provider',
    async () => {
      const Fredy = await mockFredy();
      const mockedJob = {
        id: '',
        notificationAdapter: null,
        spatialFilter: null,
        specFilter: null,
      };

      return await new Promise((resolve, reject) => {
        const fredy = new Fredy(provider.config, mockedJob, provider.metaInformation.id, similarityCache, undefined);
        fredy.execute().then((listings) => {
          if (listings == null || listings.length === 0) {
            reject('Listings is empty!');
            return;
          }

          expect(listings).toBeInstanceOf(Array);
          const notificationObj = get();
          expect(notificationObj).toBeTypeOf('object');

          // check if there is at least one valid notification
          const hasValidNotification = notificationObj.payload.some((notify) => {
            return (
              typeof notify.id === 'string' &&
              typeof notify.price === 'string' &&
              notify.price.includes('€') &&
              typeof notify.size === 'string' &&
              notify.size.includes('m²') &&
              typeof notify.title === 'string' &&
              notify.title !== '' &&
              typeof notify.link === 'string' &&
              notify.link.includes('https://www.willhaben.at/iad/') &&
              typeof notify.address === 'string'
            );
          });

          expect(hasValidNotification).toBe(true);
          resolve();
        }, reject);
      });
    },
    TEST_TIMEOUT,
  );

  describe('with provider_details enabled', () => {
    it('should enrich a listing with the full detail-page description, gallery and attributes', async () => {
      const enriched = await provider.config.fetchDetails({
        id: 'test',
        link: 'https://www.willhaben.at/iad/immobilien/d/mietwohnungen/wien/wien-1120-meidling/helle-2-zimmer-872068672/',
        description: 'short teaser',
        images: ['https://cache.willhaben.at/one.jpg'],
      });

      expect(enriched).toBeTruthy();
      expect(enriched.description).toBeTypeOf('string');
      // The detail page carries a much richer description than the list teaser.
      expect(enriched.description.length).toBeGreaterThan('short teaser'.length);
      // The detail page carries the full gallery (more than the single preview).
      expect(Array.isArray(enriched.images)).toBe(true);
      expect(enriched.images.length).toBeGreaterThan(1);
      expect(enriched.images.every((url) => typeof url === 'string' && url.startsWith('http'))).toBe(true);
    });

    it('should extract structured attributes separately from the description', async () => {
      const enriched = await provider.config.fetchDetails({
        id: 'test',
        link: 'https://www.willhaben.at/iad/immobilien/d/mietwohnungen/wien/wien-1120-meidling/helle-2-zimmer-872068672/',
        description: 'short teaser',
      });

      expect(Array.isArray(enriched.attributes)).toBe(true);
      const byLabel = Object.fromEntries(enriched.attributes.map((a) => [a.label, a.value]));
      expect(byLabel['Heizung']).toBe('Etagenheizung');
      expect(byLabel['Wohnfläche']).toBe('48 m²');
      expect(byLabel['Kaution']).toBe('€ 3.536');
      // Multi-value attributes list every value.
      expect(byLabel['Ausstattung']).toContain('Keller');
      expect(byLabel['Ausstattung']).toContain('Fahrstuhl');
      // Structured facts must not leak into the free-text description.
      expect(enriched.description).not.toContain('Heizung:');
      expect(enriched.description).not.toContain('Kaution:');
    });
  });

  it('should populate coordinates from the payload (no external geocoding)', () => {
    const normalized = provider.config.normalize({
      id: '872068672',
      title: 'helle 2 Zimmer Whg',
      price: '884.58',
      size: '48',
      rooms: '2',
      seoUrl: 'immobilien/d/mietwohnungen/wien/wien-1120-meidling/whg-872068672/',
      address: 'Rauchgasse 36/8, 1120 Wien, 12. Bezirk, Meidling',
      coordinates: '48.17821,16.33155',
      description: 'schöne helle 2 Zimmer',
      image: 'https://cache.willhaben.at/mmo/2/872/068/672_-580781789_hoved.jpg',
    });

    expect(normalized.id).toBeTypeOf('string');
    expect(normalized.link).toBe(
      'https://www.willhaben.at/iad/immobilien/d/mietwohnungen/wien/wien-1120-meidling/whg-872068672/',
    );
    expect(normalized.price).toBe(885);
    expect(normalized.size).toBe(48);
    expect(normalized.rooms).toBe(2);
    expect(normalized.latitude).toBeCloseTo(48.17821);
    expect(normalized.longitude).toBeCloseTo(16.33155);
  });
});
