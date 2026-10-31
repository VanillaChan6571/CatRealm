import type { BotScope } from '../../types';

// Per-user consent scopes a bot can request. Mirrors the server's
// src/bots/scopes.js vocabulary — these are privacy gates each user grants
// individually, not server permissions (those come from roles).
export interface BotScopeDefinition {
  scope: BotScope;
  label: string;
  description: string;
  /** interactions is the baseline scope; it's always requested. */
  alwaysRequested?: boolean;
}

export const BOT_SCOPE_DEFINITIONS: BotScopeDefinition[] = [
  {
    scope: 'interactions',
    label: 'Use commands',
    description: 'Lets you invoke this bot’s slash commands. Denying blocks all of your interactions with the bot.',
    alwaysRequested: true,
  },
  {
    scope: 'profile',
    label: 'Read your profile',
    description: 'The bot can see your bio, pronouns, status and activity.',
  },
  {
    scope: 'mentions',
    label: 'Mention you',
    description: 'The bot can @mention you, which highlights the message and can send you a push notification.',
  },
  {
    scope: 'private_messages',
    label: 'Message you privately',
    description: 'The bot can send you messages in your Bot DMs channel.',
  },
];

export function scopeDefinition(scope: BotScope): BotScopeDefinition | undefined {
  return BOT_SCOPE_DEFINITIONS.find((d) => d.scope === scope);
}
