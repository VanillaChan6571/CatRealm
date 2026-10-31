export type ActivityType = 'Playing' | 'Listening' | 'Watching' | 'Custom' | null;
export type CropKind = 'profile-avatar' | 'profile-banner' | 'server-avatar' | 'server-banner';

export type EmotePreviewItem = {
  id: string;
  label: string;
  src?: string;
  emoji?: string;
};

export type PersonalExpressionSummary = {
  animatedEmotes: number;
  animatedStickers: number;
  emoteLimit: number;
  stickerLimit: number;
};

export type PersonalExpressionType = 'emotes' | 'anim-emotes' | 'stickers' | 'anim-stickers';

export type PersonalExpressionItem = {
  id: string;
  owner_id: string;
  name: string;
  type: PersonalExpressionType;
  file_url: string;
  absolute_url?: string;
  token_alias?: string;
  variants?: Record<string, string>;
  absolute_variants?: Record<string, string>;
};

export type PersonalExpressionGroups = Record<PersonalExpressionType, PersonalExpressionItem[]>;

export type ContentSocialPrefsPayload = {
  allowNsfw: boolean;
  nsfwLewds: boolean;
  nsfwBlood: boolean;
  nsfwGore: boolean;
  dmFilter: 'all' | 'non-friends' | 'none';
  allowDms: boolean;
  frEveryone: boolean;
  frFriendOfFriends: boolean;
  frServerMembers: boolean;
  customAllowedDomains: string[];
};
