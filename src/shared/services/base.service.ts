import type { Logger } from 'pino';

import { createChildLogger } from '@config/logger.config';

/**
 * Lightweight base class for feature services.
 * Provides a scoped logger so every service inherits structured logging
 * with consistent module bindings.
 */
export abstract class BaseService {
  protected readonly logger: Logger;

  protected constructor(module: string) {
    this.logger = createChildLogger({ module });
  }
}
