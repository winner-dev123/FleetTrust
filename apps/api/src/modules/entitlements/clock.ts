/** Time source for entitlements (daily periods, grace periods). Tests substitute a fixed clock. */
export interface Clock {
  now(): Date;
}

export const CLOCK = Symbol("CLOCK");

export const systemClock: Clock = { now: () => new Date() };
