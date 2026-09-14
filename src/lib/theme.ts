import { Platform } from 'react-native';

// Koyu, sade ve yüksek kontrastlı bir bahis arayüzü paleti
export const colors = {
  bg: '#0B0F14',
  surface: '#121821',
  surface2: '#1A222E',
  surface3: '#232D3B',
  border: '#243041',
  text: '#F1F5F9',
  textMuted: '#8B98AB',
  textDim: '#5D6B7E',
  primary: '#22C55E',
  primaryDark: '#15803D',
  primaryText: '#04140A',
  live: '#EF4444',
  warn: '#F59E0B',
  info: '#38BDF8',
  danger: '#F87171',
  success: '#4ADE80',
  gold: '#FBBF24',
  overlay: 'rgba(0,0,0,0.6)',
};

export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;
export const radius = { sm: 8, md: 12, lg: 16, xl: 24, full: 999 } as const;

export const fonts = Platform.select({
  ios: { regular: 'System', mono: 'Menlo' },
  android: { regular: 'Roboto', mono: 'monospace' },
  default: { regular: 'System', mono: 'monospace' },
})!;

export const shadow = Platform.select({
  ios: {
    shadowColor: '#000',
    shadowOpacity: 0.35,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
  },
  android: { elevation: 8 },
  default: {},
})!;
