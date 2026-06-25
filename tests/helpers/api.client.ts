import type { Application } from 'express';
import supertest, { type SuperTest, type Test } from 'supertest';

import { buildExpressApp } from '@loaders/express.loader';

let cachedApp: Application | null = null;

export const getTestApp = (): Application => {
  if (!cachedApp) {
    cachedApp = buildExpressApp();
  }
  return cachedApp;
};

export const getAgent = (): SuperTest<Test> => supertest(getTestApp());

export type ApiAgent = SuperTest<Test>;
