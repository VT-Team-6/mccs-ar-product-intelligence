import { useAuth } from '@/auth/AuthContext';
import { SignInRequired } from '@/components/authentication/SignInRequired';

import { CameraView, useCameraPermissions } from 'expo-camera';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import {
  SafeAreaView,
  useSafeAreaInsets,
} from 'react-native-safe-area-context';

import { publicFetch, withStore } from '@/api/client';
import {
  checkOffScanned,
  getShoppingList,
  listShoppingLists,
  setShoppingListItemCompleted,
  type ShoppingList,
  type ShoppingListItem,
} from '@/api/shopping-lists';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { AppButton } from '@/components/ui/app-button';
import { SectionLabel } from '@/components/ui/section-label';
import {
  BottomTabInset,
  Brand,
  MaxContentWidth,
  Radius,
  Spacing,
} from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useStore } from '@/store/StoreContext';

// What the last scan did, shown as a banner above the list
type ScanNotice = {
  tone: 'success' | 'info' | 'problem';
  text: string;
};

const NOTICE_COLORS = {
  success: Brand.success,
  info: Brand.navy,
  problem: Brand.danger,
} as const;

// In-store shopping mode: the active list, with a scanner. Scanning a product
// that is on the list checks it off right here, without leaving the list.
export default function InStoreShoppingScreen() {
  const { user } = useAuth();
  return user ? <InStoreShoppingContent /> : <SignInRequired message="Sign in to use your shopping list in store." />;
}

function InStoreShoppingContent() {
  const router = useRouter();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { store } = useStore();

  const [list, setList] = useState<ShoppingList | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Scanner state
  const [permission, requestPermission] = useCameraPermissions();
  const [scanning, setScanning] = useState(false);
  const [notice, setNotice] = useState<ScanNotice | null>(null);
  // The camera reports the same code many times a second. This stops a
  // second scan from starting while the first one is still being handled.
  const handlingScan = useRef(false);

  const loadActiveList = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const lists = await listShoppingLists();
      const activeList = lists.find((item) => item.is_active);

      if (!activeList) {
        setList(null);
        return;
      }

      const details = await getShoppingList(
        activeList.shopping_list_id,
      );

      setList(details);
    } catch (problem) {
      setError(
        problem instanceof Error
          ? problem.message
          : 'Could not load your shopping list.',
      );
    } finally {
      setLoading(false);
    }
  }, []);

  // Reload whenever this screen comes into focus.
  useFocusEffect(
    useCallback(() => {
      void loadActiveList();
    }, [loadActiveList]),
  );

  // Manual check-off is shared with the normal shopping-list screen.
  const toggleCompleted = async (item: ShoppingListItem) => {
    if (!list || busy) return;

    setBusy(true);
    setError(null);

    try {
      const updated = await setShoppingListItemCompleted(
        list.shopping_list_id,
        item.product_id,
        !item.is_completed,
      );

      setList(updated);
    } catch (problem) {
      setError(
        problem instanceof Error
          ? problem.message
          : 'Could not update the item.',
      );
    } finally {
      setBusy(false);
    }
  };

  const startScanning = async () => {
    setNotice(null);
    if (!permission?.granted) {
      const answer = await requestPermission();
      if (!answer.granted) {
        setNotice({
          tone: 'problem',
          text: 'Camera access is off. Allow it to scan, or check items off by tapping them.',
        });
        return;
      }
    }
    handlingScan.current = false;
    setScanning(true);
  };

  // A QR code was read: find the product, then check it off the active list.
  const handleScanned = async ({ data }: { data: string }) => {
    if (handlingScan.current) return;
    handlingScan.current = true;
    setScanning(false);
    setBusy(true);

    try {
      // The same lookup the Home scanner uses
      const response = await publicFetch(
        withStore(`/api/scan?code=${encodeURIComponent(data)}`, store?.store_id),
      );
      const product = await response.json();
      if (!response.ok) {
        setNotice({
          tone: 'problem',
          text: product.detail ?? 'That QR code is not an MCCS product.',
        });
        return;
      }

      const result = await checkOffScanned(product.product_id);
      if (result.list) setList(result.list);
      setNotice(scanNotice(result.status, product.name));
    } catch {
      setNotice({
        tone: 'problem',
        text: 'Could not reach the server. Try again, or tap the item to check it off.',
      });
    } finally {
      setBusy(false);
      handlingScan.current = false;
    }
  };

  const remaining =
    list?.items.filter((item) => !item.is_completed) ?? [];

  const completed =
    list?.items.filter((item) => item.is_completed) ?? [];

  const total = list?.total_items ?? 0;
  const completedCount = list?.completed_items ?? 0;

  const progress = total > 0
    ? completedCount / total
    : 0;

  const renderItem = (item: ShoppingListItem) => (
    <Pressable
      key={item.shopping_list_item_id}
      disabled={busy}
      onPress={() => void toggleCompleted(item)}
      accessibilityRole="checkbox"
      accessibilityState={{ checked: item.is_completed }}
      accessibilityLabel={`${item.is_completed ? 'Uncheck' : 'Complete'} ${item.name}`}
      style={({ pressed }) => [
        styles.item,
        { backgroundColor: theme.card, borderColor: theme.border },
        pressed && styles.pressed,
      ]}
    >
      <View
        style={[
          styles.checkbox,
          {
            borderColor: item.is_completed
              ? Brand.success
              : theme.textSecondary,
            backgroundColor: item.is_completed
              ? Brand.success
              : 'transparent',
          },
        ]}
      >
        {item.is_completed && (
          <ThemedText style={styles.checkmark}>✓</ThemedText>
        )}
      </View>

      <View style={styles.itemInformation}>
        <ThemedText
          type="smallBold"
          style={
            item.is_completed
              ? styles.completedText
              : undefined
          }
        >
          {item.name}
        </ThemedText>

        <ThemedText
          type="small"
          themeColor="textSecondary"
        >
          {item.brand ?? item.product_type}
        </ThemedText>
      </View>
    </Pressable>
  );

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView
        edges={['left', 'right']}
        style={styles.safeArea}
      >
        <ScrollView
          contentContainerStyle={[
            styles.content,
            {
              paddingBottom:
                insets.bottom + BottomTabInset + Spacing.four,
            },
          ]}
        >
          {loading && !list && <ActivityIndicator />}

          {error && (
            <ThemedView
              type="card"
              style={[styles.message, { borderColor: theme.border }]}
            >
              <ThemedText>{error}</ThemedText>
              <Pressable onPress={() => void loadActiveList()}>
                <ThemedText type="linkPrimary">
                  Try again
                </ThemedText>
              </Pressable>
            </ThemedView>
          )}

          {!loading && !list && !error && (
            <ThemedView style={styles.message}>
              <ThemedText type="smallBold">
                No active shopping list
              </ThemedText>
              <ThemedText themeColor="textSecondary">
                Create or select a list from Shopping List
                before entering shopping mode.
              </ThemedText>
            </ThemedView>
          )}

          {list && (
            <>
              {/* Progress card */}
              <ThemedView
                type="card"
                style={[styles.progressCard, { borderColor: theme.border }]}
              >
                <SectionLabel label={`${list.name} · Active list`} />
                <ThemedText type="subtitle">
                  {remaining.length === 0 && total > 0
                    ? 'All done!'
                    : `${remaining.length} ${remaining.length === 1 ? 'item' : 'items'} left`}
                </ThemedText>

                <View
                  style={[
                    styles.progressTrack,
                    { backgroundColor: theme.backgroundElement },
                  ]}
                >
                  <View
                    style={[
                      styles.progressFill,
                      { width: `${progress * 100}%` },
                    ]}
                  />
                </View>

                <ThemedText
                  type="small"
                  themeColor="textSecondary"
                >
                  {completedCount} of {total} checked off · Scan items as you pick them up, or tap to check them off.
                </ThemedText>
              </ThemedView>

              {/* Scanner */}
              {scanning ? (
                <View style={styles.cameraBox}>
                  <CameraView
                    style={styles.camera}
                    facing="back"
                    barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
                    onBarcodeScanned={handleScanned}
                  />
                  <ThemedText type="small" themeColor="textSecondary" style={styles.cameraHint}>
                    Point the camera at the product's QR tag.
                  </ThemedText>
                  <AppButton
                    label="Cancel"
                    variant="secondary"
                    onPress={() => setScanning(false)}
                  />
                </View>
              ) : (
                <AppButton
                  label="Scan Product"
                  onPress={() => void startScanning()}
                  loading={busy}
                />
              )}

              {permission && !permission.granted && !permission.canAskAgain && Platform.OS !== 'web' && (
                <Pressable onPress={() => void Linking.openSettings()}>
                  <ThemedText type="linkPrimary">Open settings to allow the camera</ThemedText>
                </Pressable>
              )}

              {/* What the last scan did */}
              {notice && (
                <View
                  style={[
                    styles.notice,
                    // borderColor first, so the colored left edge wins over it
                    { borderColor: theme.border },
                    { borderLeftColor: NOTICE_COLORS[notice.tone], backgroundColor: theme.card },
                  ]}
                  accessibilityLiveRegion="polite"
                >
                  <ThemedText type="smallBold" style={{ color: NOTICE_COLORS[notice.tone] }}>
                    {notice.text}
                  </ThemedText>
                </View>
              )}

              {/* Remaining products */}
              <View style={styles.section}>
                <SectionLabel label="Still needed" />

                {remaining.length > 0 ? (
                  remaining.map(renderItem)
                ) : (
                  <ThemedText themeColor="textSecondary">
                    {total > 0
                      ? 'All items completed!'
                      : 'No items in this shopping list yet.'}
                  </ThemedText>
                )}
              </View>

              {/* Completed products */}
              <View style={styles.section}>
                <SectionLabel label={`Checked off (${completed.length})`} />

                {completed.length > 0 ? (
                  completed.map(renderItem)
                ) : (
                  <ThemedText themeColor="textSecondary">
                    No completed items yet.
                  </ThemedText>
                )}
              </View>
            </>
          )}

          {/* Leave mode without resetting completion statuses. */}
          <AppButton
            label="Exit Shopping Mode"
            variant="secondary"
            onPress={() => router.replace('/products/shopping-list')}
          />
        </ScrollView>
      </SafeAreaView>
    </ThemedView>
  );
}

// The banner text for each scan result
function scanNotice(status: string, productName: string): ScanNotice {
  switch (status) {
    case 'checked_off':
      return { tone: 'success', text: `✓ Checked off ${productName}` };
    case 'already_checked':
      return { tone: 'info', text: `${productName} is already checked off.` };
    case 'not_on_list':
      return { tone: 'info', text: `${productName} isn't on this list.` };
    default:
      return { tone: 'problem', text: 'You have no active list. Pick one from Shopping List.' };
  }
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
  },
  safeArea: {
    flex: 1,
    width: '100%',
    maxWidth: MaxContentWidth,
  },
  content: {
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.three,
    gap: Spacing.three,
  },
  progressCard: {
    padding: Spacing.three,
    borderRadius: Radius.medium,
    borderWidth: 1,
    gap: Spacing.two,
  },
  progressTrack: {
    height: 8,
    borderRadius: Radius.pill,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    borderRadius: Radius.pill,
    backgroundColor: Brand.success,
  },
  cameraBox: {
    gap: Spacing.two,
  },
  camera: {
    width: '100%',
    height: 260,
    borderRadius: Radius.medium,
    overflow: 'hidden',
  },
  cameraHint: {
    textAlign: 'center',
  },
  notice: {
    padding: Spacing.three,
    borderRadius: Radius.medium,
    borderWidth: 1,
    borderLeftWidth: 5,
  },
  section: {
    gap: Spacing.two,
  },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    padding: Spacing.three,
    borderRadius: Radius.medium,
    borderWidth: 1,
  },
  checkbox: {
    width: 24,
    height: 24,
    borderRadius: 6,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkmark: {
    color: '#fff',
    fontWeight: '700',
  },
  itemInformation: {
    flex: 1,
    gap: Spacing.half,
  },
  completedText: {
    textDecorationLine: 'line-through',
    opacity: 0.65,
  },
  message: {
    padding: Spacing.three,
    borderRadius: Radius.medium,
    gap: Spacing.two,
  },
  pressed: {
    opacity: 0.6,
  },
});