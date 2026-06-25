import { buildExpressApp } from '@loaders/express.loader';

/**
 * Builds the Express application. Kept side-effect-free so tests can
 * import the app without booting a server.
 */
export const app = buildExpressApp();
