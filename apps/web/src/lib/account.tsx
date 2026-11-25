"use client";

import type { MeResponse, MyOrganization } from "@fleettrust/types";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

import { useSession } from "./session";

export interface Account {
  me: MeResponse;
  organizations: MyOrganization[];
  /** Platform staff (trust and safety or verification): the shared dashboard answered. */
  isStaff: boolean;
  refresh: () => Promise<void>;
}

export type AccountState =
  { status: "loading" } | { status: "error"; error: unknown } | ({ status: "ready" } & Account);

type LoadedState =
  | { status: "loading" }
  | { status: "error"; error: unknown }
  | ({ status: "ready" } & Omit<Account, "refresh">);

export const AccountContext = createContext<AccountState | null>(null);

/**
 * Loads the signed-in person's profile and memberships for the /app area. The first call to
 * /v1/me also creates the account on first sign-in.
 */
export function AccountProvider({ children }: { children: ReactNode }) {
  const { api, status } = useSession();
  const [state, setState] = useState<LoadedState>({ status: "loading" });

  const fetchAccount = useCallback(async (): Promise<LoadedState> => {
    try {
      const me = await api.me();
      const [organizations, isStaff] = await Promise.all([
        api.myOrganizations(),
        // Everyone else gets 404: staff areas are invisible, not forbidden. /v1/admin/me
        // answers before MFA, so staff can still reach the console to set it up.
        api.adminMe().then(
          () => true,
          () => false,
        ),
      ]);
      return { status: "ready", me, organizations, isStaff };
    } catch (error) {
      return { status: "error", error };
    }
  }, [api]);

  const load = useCallback(async () => {
    setState(await fetchAccount());
  }, [fetchAccount]);

  useEffect(() => {
    if (status !== "signed-in") return;
    let active = true;
    void fetchAccount().then((next) => {
      if (active) setState(next);
    });
    return () => {
      active = false;
    };
  }, [status, fetchAccount]);

  const value = useMemo<AccountState>(
    () => (state.status === "ready" ? { ...state, refresh: load } : state),
    [state, load],
  );
  return <AccountContext value={value}>{children}</AccountContext>;
}

export function useAccountState(): AccountState {
  const state = useContext(AccountContext);
  if (!state) throw new Error("useAccountState() needs an AccountProvider");
  return state;
}

/** For pages inside the ready /app shell. */
export function useAccount(): Account {
  const state = useAccountState();
  if (state.status !== "ready") throw new Error("useAccount() used before the account loaded");
  return state;
}

export function useMembership(organizationId: string): MyOrganization | undefined {
  return useAccount().organizations.find((entry) => entry.organization.id === organizationId);
}
