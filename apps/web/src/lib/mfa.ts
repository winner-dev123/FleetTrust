"use client";

import {
  getMultiFactorResolver,
  type MultiFactorError,
  TotpMultiFactorGenerator,
} from "@firebase/auth";

import { firebaseAuth } from "./firebase";

export interface PendingMfa {
  /** The account has an authenticator-app (TOTP) factor. */
  available: boolean;
  /** Finishes the sign-in with a code from the app. */
  resolve: (code: string) => Promise<void>;
}

/** Turns Firebase's "second factor needed" error into what the challenge form needs. */
export function pendingMfa(error: unknown): PendingMfa {
  const resolver = getMultiFactorResolver(firebaseAuth(), error as MultiFactorError);
  const hint = resolver.hints.find((h) => h.factorId === TotpMultiFactorGenerator.FACTOR_ID);
  return {
    available: hint !== undefined,
    resolve: async (code) => {
      if (!hint) throw new Error("no authenticator app enrolled");
      await resolver.resolveSignIn(TotpMultiFactorGenerator.assertionForSignIn(hint.uid, code));
    },
  };
}
