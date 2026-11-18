import { useRouter, type Href } from 'expo-router';
import { Pressable, StyleSheet, Text } from 'react-native';

import { ThemedText } from '@/components/themed-text';

// The app's one Back button, so going back works the same on every screen:
// 1. go back if there is a previous page in this session
// 2. otherwise go to "from" (the page that opened this one, e.g. /search?q=nike)
// 3. otherwise go to the fallback (Home by default)
// Step 2 and 3 matter on web, where a refreshed or shared link has no history.
export function BackButton({
  from,
  fallback = '/',
  label = 'Back',
  onDark = false,
  iconOnly = false,
}: {
  from?: string;
  fallback?: string;
  label?: string;
  // True when the button sits on the navy header band
  onDark?: boolean;
  // Just a round chevron, no text (used in the header band, left of the title).
  // The label is still read out by screen readers.
  iconOnly?: boolean;
}) {
  const router = useRouter();

  const goBack = () => {
    if (router.canGoBack()) {
      router.back();
    } else if (from && from.startsWith('/')) {
      router.replace(from as Href);
    } else {
      router.replace(fallback as Href);
    }
  };

  if (iconOnly) {
    return (
      <Pressable
        onPress={goBack}
        hitSlop={10}
        accessibilityRole="button"
        accessibilityLabel={label === 'Back' ? 'Back' : `Back to ${label}`}
        style={({ pressed }) => [styles.circle, pressed && styles.pressed]}>
        <Text style={styles.chevron}>‹</Text>
      </Pressable>
    );
  }

  return (
    <Pressable
      onPress={goBack}
      hitSlop={12}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => [styles.back, pressed && styles.pressed]}>
      <ThemedText type="linkPrimary" style={onDark && styles.onDark}>
        {`‹ ${label}`}
      </ThemedText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  back: {
    alignSelf: 'flex-start',
  },
  pressed: {
    opacity: 0.6,
  },
  onDark: {
    color: '#C9D6EC',
  },
  // A soft white circle on the navy band, the same size as the title's line height
  circle: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.14)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  chevron: {
    color: '#ffffff',
    fontSize: 28,
    lineHeight: 30,
    fontWeight: '600',
    // The ‹ glyph sits a little right of center; nudge it back
    marginLeft: -2,
    marginTop: -2,
  },
});