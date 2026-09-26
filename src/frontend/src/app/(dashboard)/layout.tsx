import Link from "next/link";

import { logout } from "@/app/actions/auth";
import { verifySession } from "@/lib/dal";

export default async function DashboardLayout({ children }: LayoutProps<"/">) {
  await verifySession();

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-6 sm:px-6">
      <header className="mb-8 flex items-center justify-between">
        <Link href="/" className="text-lg font-semibold">
          Wireless Devices
        </Link>
        <form action={logout}>
          <button type="submit" className="text-sm text-muted hover:text-foreground">
            Sign out
          </button>
        </form>
      </header>
      {children}
    </div>
  );
}
