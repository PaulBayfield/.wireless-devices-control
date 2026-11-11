// Computers running the agent.

/** Whether the computer's agent has reported recently (three polls, at least 90 s). */
export function hostOnline(host: { lastSeenAt: Date | null; pollInterval: number }): boolean {
  if (!host.lastSeenAt) return false;
  return Date.now() - host.lastSeenAt.getTime() < Math.max(3 * host.pollInterval, 90) * 1000;
}
