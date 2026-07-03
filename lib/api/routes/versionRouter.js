/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { getPackageVersion } from '../../utils.js';

/**
 * @param {import('fastify').FastifyInstance} fastify
 */
export default async function versionPlugin(fastify) {
  // This is a fork, so the upstream (orangecoding/fredy) GitHub releases are
  // intentionally not checked. Only the local version is reported; no update is
  // ever advertised.
  fastify.get('/', async () => {
    const localFredyVersion = await getPackageVersion();
    return { newVersion: false, localFredyVersion };
  });
}
