import type { Metadata } from "next";

import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Sign in · Wireless Devices" };

export default function LoginPage() {
  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm rounded-2xl border border-border bg-surface p-8 shadow-sm">
        <h1 className="text-lg font-semibold">Wireless Devices</h1>
        <p className="mt-1 text-sm text-muted">Enter the API token to continue.</p>
        <LoginForm />
      </div>
    </main>
  );
}
