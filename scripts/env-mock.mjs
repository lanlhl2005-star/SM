/**
 * Preload for npm test / smoke: force mock fixtures.
 * Usage: node --import ./scripts/env-mock.mjs …
 * Must load before src/config.js so USE_MOCK is already set.
 */
process.env.USE_MOCK = "true";
