// Re-exports from unified expressions module with DM-prefixed aliases for backwards compatibility
export {
  type ExpressionType as DMExpressionType,
  type ExpressionItem as DMExpressionItem,
  type ExpressionManifest as DMExpressionManifest,
  type PickerServer as DMPickerServer,
  type PickerExpressionItem as DMPickerExpressionItem,
  type EmoteSuggestion as DMEmoteSuggestion,
  EMPTY_EXPRESSION_MANIFEST as EMPTY_DM_EXPRESSION_MANIFEST,
  formatPresenceStatusLabel as formatDMPresenceStatusLabel,
  presenceDotClass as dmPresenceDotClass,
  resolveServerIcon as resolveDMServerIcon,
  hasBigIntPermission,
  normalizeServerOrigin,
  sanitizeCompactEmoteTokens,
  buildExpressionToken,
} from './expressions';
