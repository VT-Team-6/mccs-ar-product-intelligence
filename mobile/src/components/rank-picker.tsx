import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Brand, Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { CRITERIA, toggleRank, type Preferences } from '@/preferences/criteria';

// Selected ranks use MCCS navy (see UI_STANDARDS.md)
const ACCENT = Brand.navy;
const BADGE_SIZE = 28;
const COMPACT_BADGE_SIZE = 24;

type Props = {
  value: Preferences;
  onChange: (next: Preferences) => void;
  compact?: boolean;
  // Which criteria to offer; all of them by default (see criteriaFor)
  criteria?: typeof CRITERIA;
};

// Tap the criteria in order of what matters most. Tapping a ranked one removes it.
// Used on the Preferences screen and when asking for a recommendation.
export function RankPicker({ value, onChange, compact = false, criteria = CRITERIA }: Props) {
  const theme = useTheme();

  return (
    <View style={styles.list}>
      {criteria.map(({ key, label, hint }) => {
        const rank = value[key];
        const ranked = rank > 0;
        return (
          <Pressable
            key={key}
            onPress={() => onChange(toggleRank(value, key))}
            accessibilityRole="button"
            accessibilityLabel={ranked ? `${label}, ranked ${rank}. Tap to remove.` : `${label}, not ranked. Tap to rank.`}
            style={({ pressed }) => pressed && styles.pressed}>
            <ThemedView
              type="card"
              style={[
                styles.card,
                compact && styles.compactCard,
                { borderColor: ranked ? ACCENT : theme.border },
              ]}>
              <View
                style={[
                  styles.badge,
                  compact && styles.compactBadge,
                  ranked
                    ? { backgroundColor: ACCENT, borderColor: ACCENT }
                    : { borderColor: theme.textSecondary },
                ]}>
                {ranked && (
                  <ThemedText type="smallBold" style={styles.badgeText}>
                    {rank}
                  </ThemedText>
                )}
              </View>
              <ThemedView type="card" style={styles.cardText}>
                <ThemedText type="smallBold">{label}</ThemedText>
                <ThemedText type="small" themeColor="textSecondary">
                  {hint}
                </ThemedText>
              </ThemedView>
            </ThemedView>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  list: {
    gap: Spacing.two,
  },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    padding: Spacing.three,
    borderRadius: Radius.medium,
    borderWidth: 2,
  },
  badge: {
    width: BADGE_SIZE,
    height: BADGE_SIZE,
    borderRadius: BADGE_SIZE / 2,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  compactCard: {
    paddingVertical: Spacing.two,
  },
  compactBadge: {
    width: COMPACT_BADGE_SIZE,
    height: COMPACT_BADGE_SIZE,
    borderRadius: COMPACT_BADGE_SIZE / 2,
  },
  badgeText: {
    color: '#ffffff',
  },
  cardText: {
    flex: 1,
    gap: Spacing.half,
  },
  pressed: {
    opacity: 0.6,
  },
});