import { Global, Module, NestModule, MiddlewareConsumer } from '@nestjs/common';
import { CustomLogger } from './logger.service';
import { LoggerMiddleware } from './logger.middleware';

@Global()
@Module({
  providers: [CustomLogger],
  exports: [CustomLogger],
})
export class LoggerModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(LoggerMiddleware).forRoutes('*');
  }
}
