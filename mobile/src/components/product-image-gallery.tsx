import { Image } from 'expo-image';
import { useEffect, useRef, useState } from 'react';
import {
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  useWindowDimensions,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

type Props = {
  /** Full links the app can load, featured image first. */
  imageUrls: string[];
  /** Accessibility name for the image buttons, e.g. the product's name. */
  productName: string;
};

// The product's photos on its detail page.
//
// The featured image is shown exactly where a single product photo used to be, so a
// product with one photo looks unchanged. When there are more, they can be
// swiped left and right, arrows sit over the photo, and the counter underneath
// says which one is showing. Tapping the photo opens it full screen, where it
// can be swiped too; both stay on the same photo.
export function ProductImageGallery({ imageUrls, productName }: Props) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const [index, setIndex] = useState(0);
  const [expanded, setExpanded] = useState(false);
  const pagerRef = useRef<ScrollView>(null);
  // The swipeable strip on the page, and how wide its photo frame is
  const stripRef = useRef<ScrollView>(null);
  const [frameWidth, setFrameWidth] = useState(0);

  const total = imageUrls.length;
  // A shorter list (e.g. after the admin removed a photo) must not leave the
  // gallery pointing past its end.
  const current = Math.min(index, Math.max(total - 1, 0));

  const goTo = (next: number) => {
    if (total === 0) return;
    const page = (next + total) % total;
    setIndex(page);
    stripRef.current?.scrollTo({ x: page * frameWidth, animated: true });
  };

  // A new set of photos (another color or size picked) starts at the first
  const photosKey = imageUrls.join('|');
  useEffect(() => {
    setIndex(0);
    stripRef.current?.scrollTo({ x: 0, animated: false });
  }, [photosKey]);

  // Back from full screen, the strip shows the photo the viewer ended on
  useEffect(() => {
    if (expanded || frameWidth === 0) return;
    stripRef.current?.scrollTo({ x: current * frameWidth, animated: false });
    // Only when the viewer closes or the frame is measured
  }, [expanded, frameWidth]);

  // The full-screen viewer opens on the photo that was tapped. It is scrolled
  // after it appears rather than given a contentOffset, because a ScrollView
  // that mounts inside a Modal ignores the offset on Android.
  useEffect(() => {
    if (!expanded) return;
    const timer = setTimeout(
      () => pagerRef.current?.scrollTo({ x: current * width, animated: false }),
      0,
    );
    return () => clearTimeout(timer);
    // Only when the viewer opens; paging inside it must not fight the scroll.
  }, [expanded]);

  if (total === 0) {
    return <ThemedView type="backgroundSelected" style={styles.hero} />;
  }

  const step = (delta: number) => goTo(current + delta);

  return (
    <>
      <View
        style={styles.heroWrapper}
        onLayout={(event) => setFrameWidth(event.nativeEvent.layout.width)}>
        <ScrollView
          ref={stripRef}
          horizontal
          pagingEnabled
          scrollEnabled={total > 1}
          showsHorizontalScrollIndicator={false}
          onMomentumScrollEnd={(event) => setIndex(pageOf(event, frameWidth, total))}
          style={styles.strip}>
          {imageUrls.map((uri, position) => (
            <Pressable
              key={`${uri}:${position}`}
              onPress={() => setExpanded(true)}
              accessibilityRole="button"
              accessibilityLabel={`Open ${productName} photo ${position + 1} of ${total}`}
              style={{ width: frameWidth || undefined }}>
              <Image
                source={{ uri }}
                style={[styles.hero, styles.square]}
                contentFit="contain"
                transition={150}
              />
            </Pressable>
          ))}
        </ScrollView>

        {total > 1 && (
          <>
            <Arrow
              direction="left"
              disabled={current === 0}
              onPress={() => step(-1)}
              label={`Previous photo of ${productName}`}
              theme={theme}
            />
            <Arrow
              direction="right"
              disabled={current === total - 1}
              onPress={() => step(1)}
              label={`Next photo of ${productName}`}
              theme={theme}
            />
          </>
        )}
      </View>

      {total > 1 && (
        <View style={styles.counterRow} accessibilityRole="text">
          <ThemedText type="small" themeColor="textSecondary">
            {current + 1} / {total}
          </ThemedText>
        </View>
      )}

      <Modal
        visible={expanded}
        transparent
        animationType="fade"
        onRequestClose={() => setExpanded(false)}>
        <View style={styles.viewer}>
          <ScrollView
            ref={pagerRef}
            horizontal
            pagingEnabled
            showsHorizontalScrollIndicator={false}
            onMomentumScrollEnd={(event) => setIndex(pageOf(event, width, total))}>
            {imageUrls.map((uri, position) => (
              <View
                key={`${uri}:${position}`}
                style={[
                  styles.page,
                  { width, height: height - insets.top - insets.bottom },
                ]}>
                <Image
                  source={{ uri }}
                  style={styles.fullImage}
                  contentFit="contain"
                  transition={150}
                />
              </View>
            ))}
          </ScrollView>

          <View style={[styles.viewerTop, { paddingTop: insets.top + Spacing.two }]}>
            <ThemedText type="smallBold" style={styles.viewerCount}>
              {current + 1} / {total}
            </ThemedText>
            <Pressable
              onPress={() => setExpanded(false)}
              hitSlop={16}
              accessibilityRole="button"
              accessibilityLabel="Close full screen photo"
              style={({ pressed }) => pressed && styles.pressed}>
              <ThemedText type="linkPrimary" style={styles.close}>
                Close
              </ThemedText>
            </Pressable>
          </View>

          {total > 1 && (
            <View style={[styles.dots, { paddingBottom: insets.bottom + Spacing.three }]}>
              {imageUrls.map((uri, position) => (
                <View
                  key={`dot-${uri}:${position}`}
                  style={[
                    styles.dot,
                    position === current ? styles.dotOn : styles.dotOff,
                  ]}
                />
              ))}
            </View>
          )}
        </View>
      </Modal>
    </>
  );
}

// Which page the horizontal pager settled on.
function pageOf(
  event: NativeSyntheticEvent<NativeScrollEvent>,
  width: number,
  total: number,
): number {
  if (width === 0) return 0;
  const page = Math.round(event.nativeEvent.contentOffset.x / width);
  return Math.max(0, Math.min(page, total - 1));
}

// The ‹ / › control that floats over the photo. Disabled at either end rather
// than wrapping, so the counter and the photo never disagree.
function Arrow({
  direction,
  onPress,
  disabled,
  label,
  theme,
}: {
  direction: 'left' | 'right';
  onPress: () => void;
  disabled: boolean;
  label: string;
  theme: ReturnType<typeof useTheme>;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      hitSlop={8}
      style={({ pressed }) => [
        styles.arrow,
        direction === 'left' ? styles.arrowLeft : styles.arrowRight,
        { backgroundColor: theme.background },
        (pressed || disabled) && styles.pressed,
      ]}>
      <ThemedText
        type="subtitle"
        themeColor={disabled ? 'textSecondary' : 'text'}
        style={styles.arrowText}>
        {direction === 'left' ? '‹' : '›'}
      </ThemedText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  // The photo frame: same shape as the single-image display it replaces, so a
  // product with one photo looks exactly as it did before.
  hero: {
    width: '100%',
    aspectRatio: 1.4,
    borderRadius: Spacing.three,
  },
  heroWrapper: {
    width: '100%',
    justifyContent: 'center',
  },
  // The strip is the rounded white frame; the photos in it are square, so no
  // page background shows between two photos while swiping (dark mode)
  strip: {
    borderRadius: Spacing.three,
    overflow: 'hidden',
    backgroundColor: '#ffffff',
  },
  square: {
    borderRadius: 0,
  },
  arrow: {
    position: 'absolute',
    top: '50%',
    marginTop: -22,
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    opacity: 0.92,
    ...Platform.select({
      web: { boxShadow: '0 2px 8px rgba(0,0,0,0.25)' },
      default: {
        shadowColor: '#000',
        shadowOpacity: 0.25,
        shadowRadius: 4,
        shadowOffset: { width: 0, height: 2 },
        elevation: 3,
      },
    }),
  },
  arrowLeft: {
    left: Spacing.two,
  },
  arrowRight: {
    right: Spacing.two,
  },
  arrowText: {
    fontSize: 26,
    lineHeight: 30,
  },
  counterRow: {
    alignItems: 'center',
  },
  viewer: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.94)',
  },
  page: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  fullImage: {
    width: '100%',
    height: '100%',
  },
  viewerTop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.four,
  },
  viewerCount: {
    color: '#ffffff',
  },
  close: {
    color: '#ffffff',
  },
  dots: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    flexDirection: 'row',
    justifyContent: 'center',
    gap: Spacing.one + Spacing.half,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  dotOn: {
    backgroundColor: '#ffffff',
  },
  dotOff: {
    backgroundColor: 'rgba(255,255,255,0.4)',
  },
  pressed: {
    opacity: 0.4,
  },
});
