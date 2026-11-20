import { Global, Module } from "@nestjs/common";

/** Time source (quota periods, grace periods, opening hours). Tests substitute a fixed clock. */
export interface Clock {
  now(): Date;
}

export const CLOCK = Symbol("CLOCK");

export const systemClock: Clock = { now: () => new Date() };

/** Provides CLOCK everywhere, so modules don't depend on each other just to read the time. */
@Global()
@Module({
  providers: [{ provide: CLOCK, useValue: systemClock }],
  exports: [CLOCK],
})
export class ClockModule {}
