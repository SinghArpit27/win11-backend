import swaggerJsdoc, { Options } from 'swagger-jsdoc';

import { appIdentity, env } from './env.config';

const options: Options = {
  definition: {
    openapi: '3.0.3',
    info: {
      title: `${appIdentity.name} API`,
      version: appIdentity.version,
      description: `${appIdentity.name} fantasy sports backend API — modular monolith. PHASE 1 exposes health + bootstrap endpoints, PHASE 2 ships authentication / RBAC / sessions / audit, PHASE 3 adds wallet + ledger + transactions.`,
    },
    servers: [{ url: `http://localhost:${env.PORT}${env.API_PREFIX}`, description: 'Local' }],
    components: {
      securitySchemes: {
        bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
      },
    },
    security: [{ bearerAuth: [] }],
  },
  apis: ['./src/modules/**/*.routes.ts', './src/modules/**/*.controller.ts'],
};

export const swaggerSpec = swaggerJsdoc(options);
