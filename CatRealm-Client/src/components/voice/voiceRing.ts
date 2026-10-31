/** Avatar ring for a voice participant: deafened > muted > speaking > none. */
export function getVoiceRingClass(user: { muted: boolean; deafened: boolean }, speaking?: boolean, forceMuted?: boolean, forceDeafened?: boolean) {
  const muted = forceMuted ?? user.muted;
  const deafened = forceDeafened ?? user.deafened;
  if (deafened) return 'ring-4 ring-warning/70';
  if (muted) return 'ring-4 ring-danger/70';
  if (speaking) return 'ring-4 ring-success/80';
  return 'ring-4 ring-transparent';
}
