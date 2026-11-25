"use client";

import type { AdminMe } from "@fleettrust/types";
import { createContext, useContext } from "react";

export const AdminContext = createContext<AdminMe | null>(null);

/** The signed-in staff member's roles and MFA state (inside the admin console). */
export function useAdmin(): AdminMe {
  const me = useContext(AdminContext);
  if (!me) throw new Error("useAdmin() outside the admin console");
  return me;
}
