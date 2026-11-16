import { Injectable, NestMiddleware } from '@nestjs/common';
import type { Request, Response, NextFunction } from 'express';
import { redactCredentialPath } from '@repo/shared/logger';
import { getRequestId } from '../../common/context/request-context';
import { createAppLogger } from './logger.service';

const logger = createAppLogger('HTTP');

@Injectable()
export class LoggerMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction): void {
    if (req.path === '/health') {
      next();
      return;
    }

    const start = Date.now();

    res.on('finish', () => {
      const duration = Date.now() - start;
      const status = res.statusCode;
      const method = req.method;
      const reqId = getRequestId();
      // A route that authenticates by path segment (CREDENTIAL_PATH_PREFIXES)
      // makes the raw path a credential. Redact before it reaches the access log.
      const path = redactCredentialPath(req.path);
      const fields = {
        ...(reqId !== 'no-context' && { requestId: reqId }),
        method,
        path,
        status,
        durationMs: duration,
      };

      if (status >= 500) {
        logger.error('HTTP request', fields);
      } else if (status >= 400) {
        logger.warn('HTTP request', fields);
      } else {
        logger.info('HTTP request', fields);
      }
    });

    next();
  }
}
