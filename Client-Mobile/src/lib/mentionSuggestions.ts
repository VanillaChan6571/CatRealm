/**
 * @mention suggestions for the composer, mirroring the desktop client's
 * MessageInput: the realm alias (@everyone), mentionable roles (highest
 * first), then members. Mentions are plain text — `@username` / `@RoleName`.
 */

export type MentionSuggestion = {
  key: string;
  type: 'alias' | 'role' | 'user';
  label: string;
  insert: string;
  description?: string;
  avatar?: string | null;
  color?: string | null;
};

type MentionMember = { id: string; username: string; avatar?: string | null; isBot?: boolean };
type MentionRole = { id: string; name: string; position: number; color?: string | null; is_default?: number | boolean };

const MAX_ROLES = 6;
const MAX_MEMBERS = 6;
const MAX_TOTAL = 12;

/** The `@query` being typed right before the caret, or null when the caret isn't in a mention. */
export function activeMentionQuery(textBeforeCaret: string): string | null {
  const match = /(?:^|\s)@([^\s@]*)$/.exec(textBeforeCaret);
  return match ? match[1] : null;
}

export function buildMentionSuggestions(
  query: string,
  members: MentionMember[],
  roles: MentionRole[],
  mentionAlias: string | null | undefined,
): MentionSuggestion[] {
  const q = query.toLowerCase();
  const items: MentionSuggestion[] = [];

  const alias = mentionAlias ?? '@everyone';
  if (alias) {
    const label = alias.startsWith('@') ? alias : `@${alias}`;
    if (label.slice(1).toLowerCase().includes(q)) {
      items.push({ key: 'alias', type: 'alias', label, insert: label, description: 'Notify all members' });
    }
  }

  [...roles]
    .filter((role) => !role.is_default && role.name.toLowerCase().includes(q))
    .sort((a, b) => b.position - a.position)
    .slice(0, MAX_ROLES)
    .forEach((role) => items.push({
      key: `role:${role.id}`,
      type: 'role',
      label: `@${role.name}`,
      insert: `@${role.name}`,
      color: role.color ?? null,
    }));

  const seen = new Set<string>();
  members
    .filter((member) => {
      if (seen.has(member.id) || !member.username.toLowerCase().includes(q)) return false;
      seen.add(member.id);
      return true;
    })
    // Prefix matches read as the better guess while typing.
    .sort((a, b) => Number(!a.username.toLowerCase().startsWith(q)) - Number(!b.username.toLowerCase().startsWith(q)))
    .slice(0, MAX_MEMBERS)
    .forEach((member) => items.push({
      key: `user:${member.id}`,
      type: 'user',
      label: `@${member.username}`,
      insert: `@${member.username}`,
      avatar: member.avatar ?? null,
      description: member.isBot ? 'Bot' : undefined,
    }));

  return items.slice(0, MAX_TOTAL);
}
