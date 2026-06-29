export const colors = {
  primary: '#047857',
  primaryLight: '#ECFDF5',
  background: '#F2F4F6',
  card: '#FFFFFF',
  text: '#191919',
  textSecondary: '#8B95A1',
  textTertiary: '#C4C9D1',
  divider: '#F2F4F6',
  danger: '#F04452',
  success: '#00C073',
  kakao: '#FEE500',
};

export const spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
};

export const radius = {
  sm: 8,
  md: 12,
  lg: 20,
};

export const typography = {
  hero: { fontSize: 48, fontWeight: '800' as const, color: colors.text },
  title: { fontSize: 22, fontWeight: '700' as const, color: colors.text },
  heading: { fontSize: 17, fontWeight: '700' as const, color: colors.text },
  body: { fontSize: 15, fontWeight: '400' as const, color: colors.text },
  label: { fontSize: 13, fontWeight: '400' as const, color: colors.textSecondary },
  caption: { fontSize: 11, fontWeight: '400' as const, color: colors.textTertiary },
};
