import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';

import { listStores, type Store } from '../api/inventory';
import { getSelectedStore, saveSelectedStore } from '../api/me';
import { searchLocations, type LocationSuggestion } from '../api/stores';
import { useAuth } from '../auth/AuthContext';
import { ThemedText } from '../components/themed-text';
import { ThemedView } from '../components/themed-view';
import { Spacing } from '../constants/theme';
import { useTheme } from '../hooks/use-theme';
import { confirmAction } from '../utils/confirm';
import { distanceToStore, formatMiles } from './distance';

// The cache is a startup accelerator, not a per-account record, so it holds the
// resolved store (name included) rather than a bare id: a cold start can then
// paint "Price at MCCS Main Exchange location." before listStores() returns.
const CACHE_KEY = 'mccs.active-store';

type StoreContextType = {
  /** The store the shopper is shopping at, or null when they haven't picked one. */
  store: Store | null;
  /** Every location, in the backend's stable order. The selector renders this. */
  stores: Store[];
  /** True while the saved selection is being read. Screens can avoid a flash of "no store". */
  loading: boolean;
  /** Changes the active store. Rejects if the server refuses, leaving the old store in place. */
  setStore: (store: Store | null) => Promise<void>;
  /**
   * Opens the one store sheet. `allowClear` shows the "Clear store" action, which
   * only the Account screen offers: clearing is never what a shopper tapping a
   * price prompt meant.
   */
  openStoreSelector: (options?: { allowClear?: boolean }) => void;
};

const StoreContext = createContext<StoreContextType | undefined>(undefined);

// Reads the cached store. Anything unparseable is discarded rather than thrown,
// so a corrupt value can never stop the app from starting.
async function readCache(): Promise<Store | null> {
  try {
    const text = await AsyncStorage.getItem(CACHE_KEY);
    if (!text) return null;
    const cached = JSON.parse(text) as Partial<Store> | null;
    if (!cached || typeof cached.store_id !== 'number') return null;
    return {
      store_id: cached.store_id,
      name: typeof cached.name === 'string' ? cached.name : '',
      address: typeof cached.address === 'string' ? cached.address : '',
      latitude: typeof cached.latitude === 'number' ? cached.latitude : null,
      longitude: typeof cached.longitude === 'number' ? cached.longitude : null,
    };
  } catch {
    return null;
  }
}

// Best-effort: a cache that cannot be written only costs one slow start.
async function writeCache(store: Store | null): Promise<void> {
  try {
    if (store === null) {
      await AsyncStorage.removeItem(CACHE_KEY);
    } else {
      await AsyncStorage.setItem(CACHE_KEY, JSON.stringify(store));
    }
  } catch {
    // Ignored on purpose. The server is the source of truth.
  }
}

export function StoreProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [store, setStoreState] = useState<Store | null>(null);
  const [stores, setStores] = useState<Store[]>([]);
  const [loading, setLoading] = useState(true);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [allowClear, setAllowClear] = useState(false);

  // Learns the shopper's store once a user is signed in. The cache paints first
  // so the name is on screen immediately; the server then overrides it.
  useEffect(() => {
    let cancelled = false;

    void (async () => {
      if (!user) {
        // Sign-out: drop the in-memory store and the cache. The account's saved
        // store stays on the server, so the same person gets it back next time,
        // and a different person never inherits it.
        await writeCache(null);
        if (cancelled) return;
        setStores([]);
        setStoreState(null);
        setLoading(true);
        return;
      }

      // A cached store paints immediately, then has to agree with the server.
      const cached = await readCache();
      if (cancelled) return;
      setLoading(true);
      if (cached) setStoreState(cached);

      const [all, savedId] = await Promise.all([
        listStores().catch(() => [] as Store[]),
        getSelectedStore().catch(() => null),
      ]);
      if (cancelled) return;

      setStores(all);
      // An id that no longer resolves (the store was deleted) counts as no
      // store, and is deliberately not written back.
      const fromServer = all.find((item) => item.store_id === savedId) ?? null;

      if (cached && savedId !== null && cached.store_id !== savedId && fromServer) {
        const keepCached = await confirmAction(
          'Keep your last store?',
          `Your account is set to ${fromServer.name}, but this device last used ${cached.name}.`,
          `Keep ${cached.name}`,
        );
        if (cancelled) return;

        // Either way the choice is persisted, so the account and the device agree.
        const chosen = keepCached ? cached : fromServer;
        try {
          if (keepCached) await saveSelectedStore(cached.store_id);
          setStoreState(chosen);
          writeCache(chosen);
        } catch {
          setStoreState(fromServer);
          writeCache(fromServer);
        }
        setLoading(false);
        return;
      }

      setStoreState(fromServer);
      writeCache(fromServer);
      setLoading(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [user]);

  const setStore = useCallback(
    async (next: Store | null) => {
      // Signed in, the server is the source of truth: commit only after it
      // agrees. Otherwise the next read would silently revert the choice.
      if (user) {
        await saveSelectedStore(next === null ? null : next.store_id);
      }
      setStoreState(next);
      await writeCache(next);
    },
    [user],
  );

  const openStoreSelector = useCallback((options?: { allowClear?: boolean }) => {
    setAllowClear(options?.allowClear ?? false);
    setSheetOpen(true);
  }, []);

  const pick = useCallback(
    async (picked: Store) => {
      setSheetOpen(false);
      try {
        await setStore(picked);
      } catch {
        // setStore already left the old store in place. Tell the shopper rather
        // than leaving them to wonder why the price didn't change.
        await confirmAction(
          'Could not save your store',
          'Check your connection and try again.',
          'OK',
        );
      }
    },
    [setStore],
  );

  const clear = useCallback(async () => {
    setSheetOpen(false);
    try {
      await setStore(null);
    } catch {
      await confirmAction(
        'Could not clear your store',
        'Check your connection and try again.',
        'OK',
      );
    }
  }, [setStore]);

  const value = useMemo(
    () => ({ store, stores, loading, setStore, openStoreSelector }),
    [store, stores, loading, setStore, openStoreSelector],
  );

  return (
    <StoreContext.Provider value={value}>
      {children}
      <StoreSelectorSheet
        // Remounting on each open resets the mode, the typed ZIP and the search
        // results, so a previous search never reappears.
        key={sheetOpen ? 'open' : 'closed'}
        visible={sheetOpen}
        stores={stores}
        selected={store}
        allowClear={allowClear}
        onPick={pick}
        onClear={clear}
        onClose={() => setSheetOpen(false)}
      />
    </StoreContext.Provider>
  );
}

export function useStore() {
  const context = useContext(StoreContext);

  if (!context) {
    throw new Error('useStore must be used inside StoreProvider');
  }

  return context;
}

// Mounted once, from the provider, so every entry point (the Account row, the
// product page link, and every "select a store" price prompt) opens this same
// sheet. Cancelling changes nothing.
function StoreSelectorSheet({
  visible,
  stores,
  selected,
  allowClear,
  onPick,
  onClear,
  onClose,
}: {
  visible: boolean;
  stores: Store[];
  selected: Store | null;
  allowClear: boolean;
  onPick: (store: Store) => void;
  onClear: () => void;
  onClose: () => void;
}) {
  const theme = useTheme();
  // Near me is the default: it needs no typing and covers the common case.
  const [mode, setMode] = useState<'near' | 'search'>('near');
  const [zipQuery, setZipQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [suggestions, setSuggestions] = useState<LocationSuggestion[] | null>(null);
  const [searchError, setSearchError] = useState<string | null>(null);
  // The place distances are measured from. A searched location only sets this;
  // it never changes the active store, which only a store row does.
  const [origin, setOrigin] = useState<LocationSuggestion | null>(null);

  // Reopening starts clean, so a previous search doesn't surprise the shopper.
  // Reset by remounting (see the `key` on StoreSelectorSheet in the provider)
  // rather than an effect that clears state.
  const selectedOrigin = origin
    ? { latitude: origin.latitude, longitude: origin.longitude, name: origin.label }
    : selected
      ? { latitude: selected.latitude, longitude: selected.longitude, name: selected.name }
      : null;

  // Every store is listed, nearest first. Nothing is filtered out by a radius:
  // a picker should show every location. Stores without coordinates keep the
  // API's order at the end rather than sorting as distance 0.
  const rows = stores
    .map((item) => ({
      item,
      miles: selectedOrigin
        ? distanceToStore(
            { latitude: selectedOrigin.latitude, longitude: selectedOrigin.longitude },
            { latitude: item.latitude, longitude: item.longitude },
          )
        : null,
    }))
    .sort((left, right) => {
      if (left.miles === null && right.miles === null) {
        return left.item.store_id - right.item.store_id;
      }
      if (left.miles === null) return 1;
      if (right.miles === null) return -1;
      return left.miles - right.miles;
    });

  const canSearch = zipQuery.trim().length >= 2;

  const search = async () => {
    if (!canSearch || searching) return;
    setSearching(true);
    setSearchError(null);
    setSuggestions(null);
    try {
      // Keyed on the trimmed text so a slow response cannot overwrite a newer
      // search: the value is read once here, and stale sets are ignored.
      const found = await searchLocations(zipQuery);
      setSuggestions(found);
    } catch (problem) {
      setSearchError(
        problem instanceof Error ? problem.message : 'Could not search for that location.',
      );
    } finally {
      setSearching(false);
    }
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
      statusBarTranslucent>
      <KeyboardAvoidingView
        style={styles.overlay}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ThemedView style={styles.dialog}>
          <View style={styles.header}>
            <View style={styles.headingText}>
              <ThemedText type="subtitle">Your store</ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                Prices and stock are shown for the store you pick.
              </ThemedText>
            </View>
            <Pressable
              onPress={onClose}
              accessibilityRole="button"
              accessibilityLabel="Close store selector"
              hitSlop={12}>
              <ThemedText type="linkPrimary">Close</ThemedText>
            </Pressable>
          </View>

          <View style={styles.modes}>
            <ActionButton
              label="Near me"
              onPress={() => setMode('near')}
              secondary={mode !== 'near'}
            />
            <ActionButton
              label="Search a ZIP"
              onPress={() => setMode('search')}
              secondary={mode !== 'search'}
            />
          </View>

          {mode === 'search' && (
            <View style={styles.searchBlock}>
              <View style={styles.searchRow}>
                <TextInput
                  value={zipQuery}
                  onChangeText={setZipQuery}
                  onSubmitEditing={search}
                  placeholder="ZIP code or city"
                  returnKeyType="search"
                  autoCapitalize="none"
                  autoCorrect={false}
                  editable={!searching}
                  style={[
                    styles.searchInput,
                    { color: theme.text, backgroundColor: theme.backgroundElement },
                  ]}
                  placeholderTextColor={theme.textSecondary}
                />
                <ActionButton
                  label={searching ? 'Searching…' : 'Search'}
                  onPress={search}
                  disabled={!canSearch || searching}
                  compact
                />
              </View>

              {searchError && (
                <ThemedText type="small" style={styles.error}>
                  {searchError}
                </ThemedText>
              )}

              {suggestions !== null && suggestions.length === 0 && (
                <ThemedText type="small" themeColor="textSecondary">
                  No stores found near that ZIP.
                </ThemedText>
              )}

              {suggestions !== null && suggestions.length > 0 && (
                <>
                  <ThemedText type="small" themeColor="textSecondary">
                    Pick a place to measure distances from.
                  </ThemedText>
                  {suggestions.map((place) => {
                    const active = origin?.id === place.id;
                    return (
                      <Pressable
                        key={place.id}
                        onPress={() => setOrigin(place)}
                        accessibilityRole="button"
                        accessibilityState={{ selected: active }}
                        style={({ pressed }) => [styles.suggestion, pressed && styles.dimmed]}>
                        <ThemedView
                          type={active ? 'backgroundSelected' : 'backgroundElement'}
                          style={styles.listing}>
                          <View style={styles.listingMain}>
                            <View style={styles.listingText}>
                              <ThemedText type="smallBold">{place.label}</ThemedText>
                            </View>
                            {active && <ThemedText type="linkPrimary">✓</ThemedText>}
                          </View>
                        </ThemedView>
                      </Pressable>
                    );
                  })}
                </>
              )}
            </View>
          )}

          {stores.length === 0 ? (
            <View style={styles.center}>
              <ActivityIndicator />
              <ThemedText themeColor="textSecondary">Loading stores…</ThemedText>
            </View>
          ) : (
            <ScrollView
              style={styles.list}
              contentContainerStyle={styles.listContent}
              keyboardShouldPersistTaps="handled">
              {selectedOrigin && (
                <ThemedText type="small" themeColor="textSecondary">
                  Sorted by distance from {selectedOrigin.name}
                </ThemedText>
              )}
              {rows.map(({ item, miles }) => {
                const current = selected?.store_id === item.store_id;
                return (
                  <ThemedView
                    key={item.store_id}
                    type="backgroundElement"
                    style={styles.listing}>
                    <Pressable
                      onPress={() => onPick(item)}
                      accessibilityRole="button"
                      accessibilityState={{ selected: current }}
                      accessibilityLabel={`Shop at ${item.name}`}
                      style={styles.listingMain}>
                      <View style={styles.listingText}>
                        <ThemedText type="smallBold">{item.name}</ThemedText>
                        <ThemedText type="small" themeColor="textSecondary">
                          {item.address}
                        </ThemedText>
                        {miles !== null && (
                          <ThemedText type="small" themeColor="textSecondary">
                            {formatMiles(miles)}
                          </ThemedText>
                        )}
                      </View>
                      {current && <ThemedText type="linkPrimary">✓</ThemedText>}
                    </Pressable>
                  </ThemedView>
                );
              })}
            </ScrollView>
          )}

          {allowClear && selected && (
            <View style={styles.footer}>
              <ActionButton label="Clear store" onPress={onClear} secondary />
            </View>
          )}
        </ThemedView>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function ActionButton({
  label,
  onPress,
  secondary = false,
  compact = false,
  disabled = false,
}: {
  label: string;
  onPress: () => void;
  secondary?: boolean;
  compact?: boolean;
  disabled?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      style={({ pressed }) => [
        styles.buttonPress,
        (pressed || disabled) && styles.dimmed,
      ]}>
      <ThemedView
        type={secondary ? 'backgroundElement' : 'backgroundSelected'}
        style={[styles.button, compact && styles.compactButton]}>
        <ThemedText type="smallBold" style={styles.buttonText}>
          {label}
        </ThemedText>
      </ThemedView>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: Spacing.three,
  },
  dialog: {
    width: '100%',
    maxWidth: 620,
    maxHeight: '90%',
    borderRadius: Spacing.four,
    padding: Spacing.four,
    gap: Spacing.three,
    overflow: 'hidden',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: Spacing.two,
  },
  modes: { flexDirection: 'row', gap: Spacing.two },
  searchBlock: { gap: Spacing.two },
  searchRow: { flexDirection: 'row', alignItems: 'stretch', gap: Spacing.two },
  searchInput: {
    flex: 1,
    minWidth: 0,
    borderRadius: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    fontSize: 15,
  },
  suggestion: { borderRadius: Spacing.three },
  error: { color: '#E5484D' },
  compactButton: { paddingHorizontal: Spacing.two },
  headingText: { flex: 1, gap: Spacing.half },
  center: {
    minHeight: 130,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.two,
  },
  list: { flexShrink: 1, minHeight: 80 },
  listContent: { gap: Spacing.two, paddingBottom: Spacing.one },
  listing: { borderRadius: Spacing.three, padding: Spacing.three, gap: Spacing.two },
  listingMain: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  listingText: { flex: 1, gap: Spacing.half },
  footer: { flexDirection: 'row', alignItems: 'stretch', gap: Spacing.two },
  buttonPress: { flexShrink: 1 },
  button: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: Spacing.two + Spacing.half,
    paddingHorizontal: Spacing.three,
    borderRadius: Spacing.three,
    minHeight: 42,
  },
  buttonText: { textAlign: 'center' },
  dimmed: { opacity: 0.5 },
});
