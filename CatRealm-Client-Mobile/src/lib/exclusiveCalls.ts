/**
 * Voice channels and theaters share one call at a time, as on desktop: joining
 * one leaves the other. Each store registers how to leave its session here, so
 * neither store has to import the other.
 */

type CallKind = 'voice' | 'theater';

const leavers = new Map<CallKind, () => void>();

export function registerCallLeaver(kind: CallKind, leave: () => void): void {
  leavers.set(kind, leave);
}

/** Leave every registered call except the one being joined. */
export function leaveOtherCalls(joining: CallKind): void {
  for (const [kind, leave] of leavers) {
    if (kind !== joining) leave();
  }
}
