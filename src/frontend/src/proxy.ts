import { NextResponse, type NextRequest } from "next/server";

import { SESSION_COOKIE, isValidSession } from "@/lib/session";

/**
 * Optimistic check: send anyone without a valid session to /login before a
 * page renders, and a logged-in visitor away from it. The real check is
 * `verifySession()` in the data access layer, next to every API call.
 */
export function proxy(request: NextRequest) {
  const authenticated = isValidSession(request.cookies.get(SESSION_COOKIE)?.value);
  const onLogin = request.nextUrl.pathname === "/login";

  if (!authenticated && !onLogin) {
    return NextResponse.redirect(new URL("/login", request.url));
  }
  if (authenticated && onLogin) {
    return NextResponse.redirect(new URL("/", request.url));
  }
  return NextResponse.next();
}

export const config = {
  // Everything but Next's own assets and the public files.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|glb)$).*)"],
};
