export function mergeAndDeduplicateMessages<T extends { id: string; createdAt: number }>(
  existing: T[],
  incoming: T[],
): T[] {
  const byId = new Map<string, T>();
  for (const msg of existing) byId.set(msg.id, msg);
  for (const msg of incoming) byId.set(msg.id, msg);
  return Array.from(byId.values()).sort((a, b) => a.createdAt - b.createdAt);
}
