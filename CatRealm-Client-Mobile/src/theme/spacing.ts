export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
} as const;

export const radius = {
  sm: 6,
  md: 10,
  lg: 14,
  xl: 18,
  pill: 999,
} as const;

export const shadow = {
  // Use sparingly — RN shadows are expensive on Android. Components prefer
  // a subtle elevation rim (1px border + alpha bg) over a true drop shadow.
  card: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
    elevation: 4,
  },
  sheet: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -8 },
    shadowOpacity: 0.4,
    shadowRadius: 16,
    elevation: 12,
  },
} as const;

export const z = {
  base: 0,
  raised: 1,
  sticky: 5,
  drawer: 80,
  sheet: 90,
  modal: 100,
  toast: 200,
} as const;

export const hit = {
  /** iOS HIG: 44pt minimum hit target. */
  min: 44,
} as const;
