import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { useTheme } from '@/hooks/use-theme';

type Props = {
  hex: string;
  // A second color makes a two-tone dot, split diagonally ("White/Black")
  hex2?: string | null;
  size: number;
  style?: StyleProp<ViewStyle>;
};

// A round color swatch, one color or two split corner to corner
export function ColorSwatch({ hex, hex2, size, style }: Props) {
  const theme = useTheme();
  const ring = { width: size, height: size, borderRadius: size / 2, borderColor: theme.border };
  if (!hex2) return <View style={[styles.ring, ring, { backgroundColor: hex }, style]} />;
  // Two halves side by side, turned 45° and oversized so they fill the circle
  const side = size * 1.5;
  return (
    <View style={[styles.ring, ring, style]}>
      <View
        style={[
          styles.halves,
          { width: side, height: side, top: (size - side) / 2 - 1, left: (size - side) / 2 - 1 },
        ]}>
        <View style={[styles.half, { backgroundColor: hex }]} />
        <View style={[styles.half, { backgroundColor: hex2 }]} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  ring: {
    borderWidth: 1,
    overflow: 'hidden',
  },
  halves: {
    position: 'absolute',
    flexDirection: 'row',
    transform: [{ rotate: '45deg' }],
  },
  half: {
    flex: 1,
  },
});
