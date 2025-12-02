import pino from 'pino';
import type { Config } from '../config.js';

const isProduction = process.env.NODE_ENV === 'production';

export function createLogger(config: Config) {
  if (isProduction) {
    // JSON output for production (better for log aggregation)
    return pino({
      level: config.logging.level,
      formatters: {
        level: (label) => ({ level: label }),
      },
      timestamp: pino.stdTimeFunctions.isoTime,
    });
  }

  // Pretty output for development
  return pino({
    level: config.logging.level,
    transport: {
      target: 'pino-pretty',
      options: {
        colorize: true,
        translateTime: 'SYS:standard',
        ignore: 'pid,hostname',
      },
    },
  });
}

export type Logger = ReturnType<typeof createLogger>;
