import "server-only";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";

import { SESSION_COOKIE, isValidSession } from "./session";

/**
 * The real authorization check, run next to every data access and in every
 * Server Action. `proxy.ts` redirects early, but it is only an optimisation:
 * Server Actions are reachable by POST whatever page they are called from.
 */
export const verifySession = cache(async (): Promise<void> => {
  const session = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!isValidSession(session)) {
    redirect("/login");
  }
});
