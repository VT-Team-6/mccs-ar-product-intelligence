import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  ActivityIndicator,
  Keyboard,
  KeyboardAvoidingView,
  Linking,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';

import { listStores, type Store } from '../api/inventory';
import { getHomeStore, saveHomeStore } from '../api/me';
import { searchLocations, type LocationSuggestion } from '../api/stores';
import { useAuth } from '../auth/AuthContext';
import { ThemedText } from '../components/themed-text';
import { ThemedView } from '../components/themed-view';
import { Spacing } from '../constants/theme';
import { useTheme } from '../hooks/use-theme';
import { confirmAction } from '../utils/confirm';
import { locateDevice, locationProblem, type LocationRefusal } from './device-location';
import { distanceToStore, formatMiles } from './distance';

// Keep anonymous device choices separate from account preferences.
const CACHE_KEY = 'mccs.guest-store';
const STORE_LOAD_TIMEOUT_MS = 10_000;

async function withStoreTimeout<T>(request: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const controller = new AbortController();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    const deadline = new Promise<never>((_, reject) => {
      timeout = setTimeout(() => {
        controller.abort();
        reject(new Error('Store request timed out'));
      }, STORE_LOAD_TIMEOUT_MS);
    });
    return await Promise.race([request(controller.signal), deadline]);
  } finally {
    clearTimeout(timeout);
  }
}

type StoreSelection = {
  user: unknown;
  store: Store | null;
  // undefined means the account preference could not be read.
  homeId: number | null | undefined;
};

type StoreContextType = {
  /** The store the shopper is shopping at, or null when they haven't picked one. */
  store: Store | null;
  homeStore: Store | null;
  /** Every location, in the backend's stable order. The selector renders this. */
  stores: Store[];
  /** True while the saved selection is being read. Screens can avoid a flash of "no store". */
  loading: boolean;
  /** Changes the active store. Rejects if the server refuses, leaving the old store in place. */
  setStore: (store: Store | null) => Promise<void>;
  /**
   * Opens the store picker. Home mode edits the signed-in account preference.
   */
  openStoreSelector: (options?: { allowClear?: boolean; home?: boolean }) => void;
  /**
   * The device's own coordinates, once the shopper has asked for them. Lives here
   * so distances mean the same thing everywhere: the sheet and the product page 
   * must not measure from different places. Null until asked, and cleared on sign-out.
   */
  deviceOrigin: DeviceOrigin | null;
  // A fix is being requested. Both surfaces disable their button while true.
  locating: boolean;
  // Why the last attempt produced no fix. One state, so a refusal anywhere shows everywhere.
  locationRefusal: LocationRefusal | null;
  // Asks the device for its location. The only path that can raise the permission prompt.
  useDeviceLocation: () => Promise<void>;
  // Drops the fix and returns to measuring from the active store.
  clearDeviceOrigin: () => void;
};

// Where distances are measured from when the shopper uses the device's location.
export type DeviceOrigin = { latitude: number; longitude: number };

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
    // The selection still works for this visit.
  }
}

export function StoreProvider({ children }: { children: ReactNode }) {
  const { user, loading: authLoading } = useAuth();
  const [selection, setSelection] = useState<StoreSelection | null>(null);
  const [stores, setStores] = useState<Store[]>([]);
  const [storeListError, setStoreListError] = useState(false);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [retryingStores, setRetryingStores] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [allowClear, setAllowClear] = useState(false);
  const [choosingHome, setChoosingHome] = useState(false);
  const sawGuestSession = useRef(false);
  const current = selection?.user === user ? selection : null;
  const loading = authLoading || current === null || retryingStores;
  const loadError = storeListError
    ? 'Could not load stores.'
    : user && current && current.homeId === undefined
      ? 'Could not load your saved store.'
      : null;
  const store = current?.store ?? null;
  const homeStore = stores.find((item) => item.store_id === current?.homeId) ?? null;
  const [deviceOrigin, setDeviceOrigin] = useState<DeviceOrigin | null>(null);
  const [locating, setLocating] = useState(false);
  const [locationRefusal, setLocationRefusal] = useState<LocationRefusal | null>(null);

  useEffect(() => {
    if (authLoading) return;
    let cancelled = false;
    const signedOut = !user && !sawGuestSession.current;
    if (!user) sawGuestSession.current = true;

    void (async () => {
      const [all, cached, savedId] = await Promise.all([
        withStoreTimeout(listStores).catch(() => null),
        readCache(),
        user ? withStoreTimeout(getHomeStore).catch(() => undefined) : Promise.resolve(null),
      ]);
      if (cancelled) return;

      const guestStore = all
        ? all.find((item) => item.store_id === cached?.store_id) ?? null
        : cached;
      let homeId = savedId;
      let active = user ? all?.find((item) => item.store_id === homeId) ?? null : guestStore;

      // Carry an anonymous selection into a new account once. The server keeps
      // any home store saved on another device during sign-in.
      if (user && sawGuestSession.current && homeId === null && all && guestStore) {
        active = guestStore;
        try {
          homeId = await withStoreTimeout((signal) => saveHomeStore(guestStore.store_id, { onlyIfUnset: true, signal }));
          active = all.find((item) => item.store_id === homeId) ?? guestStore;
        } catch {
          // The store still works for this visit if the preference could not be saved.
        }
      }
      if (cancelled) return;
      if (user && all && homeId !== undefined) sawGuestSession.current = false;

      if (signedOut) {
        setDeviceOrigin(null);
        setLocationRefusal(null);
      }
      setRetryingStores(false);
      setStoreListError(all === null);
      if (all) setStores(all);
      setSelection((previous) => {
        if (!previous || previous.user !== user) return { user, homeId, store: active };
        const previousStore = all
          ? all.find((item) => item.store_id === previous.store?.store_id)
          : previous.store;
        return {
          user,
          homeId: homeId === undefined ? previous.homeId : homeId,
          store: previousStore ?? active,
        };
      });
    })();

    return () => { cancelled = true; };
  }, [authLoading, user, loadAttempt]);

  const setStore = useCallback(async (next: Store | null) => {
    if (!current) return;
    const savedHomeId = user && next && current.homeId === null
      ? await withStoreTimeout((signal) => saveHomeStore(next.store_id, { onlyIfUnset: true, signal }))
      : undefined;
    setSelection((previous) => previous && previous.user === user
      ? { ...previous, store: next, homeId: savedHomeId === undefined ? previous.homeId : savedHomeId }
      : previous);
    if (!user) await writeCache(next);
  }, [current, user]);

  const changeHome = useCallback(async (next: Store | null) => {
    if (!user) return;
    const homeId = await withStoreTimeout((signal) => saveHomeStore(next?.store_id ?? null, { signal }));
    setSelection((previous) => previous && previous.user === user
      ? { ...previous, homeId, store: next ?? previous.store }
      : previous);
  }, [user]);

  const openStoreSelector = useCallback((options?: { allowClear?: boolean; home?: boolean }) => {
    setAllowClear(options?.allowClear ?? false);
    setChoosingHome(options?.home ?? false);
    setSheetOpen(true);
  }, []);

  // The only path that can show the system permission prompt. Asking twice in a
  // row is prevented, since a second tap while the GPS is working would queue a
  // duplicate request behind the first.
  const useDeviceLocation = useCallback(async () => {
    if (locating) return;
    setLocating(true);
    setLocationRefusal(null);
    const result = await locateDevice();
    if (result.status === 'granted') {
      setDeviceOrigin({ latitude: result.latitude, longitude: result.longitude });
    } else {
      // A refusal leaves any existing origin alone, so the sheet and the product
      // page keep their ordering instead of falling back to "no distances".
      setLocationRefusal(result);
    }
    setLocating(false);
  }, [locating]);

  const clearDeviceOrigin = useCallback(() => {
    setDeviceOrigin(null);
    setLocationRefusal(null);
  }, []);

  const pick = useCallback(
    async (picked: Store) => {
      setSheetOpen(false);
      try {
        await (choosingHome ? changeHome(picked) : setStore(picked));
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
    [changeHome, choosingHome, setStore],
  );

  const clear = useCallback(async () => {
    setSheetOpen(false);
    try {
      await (choosingHome ? changeHome(null) : setStore(null));
    } catch {
      await confirmAction(
        'Could not clear your store',
        'Check your connection and try again.',
        'OK',
      );
    }
  }, [changeHome, choosingHome, setStore]);

  const value = useMemo(
    () => ({
      store,
      homeStore,
      stores,
      loading,
      setStore,
      openStoreSelector,
      deviceOrigin,
      locating,
      locationRefusal,
      useDeviceLocation,
      clearDeviceOrigin,
    }),
    [
      store,
      homeStore,
      stores,
      loading,
      setStore,
      openStoreSelector,
      deviceOrigin,
      locating,
      locationRefusal,
      useDeviceLocation,
      clearDeviceOrigin,
    ],
  );

  return (
    <StoreContext.Provider value={value}>
      {children}
      <StoreSelectorSheet
        // Remounting on each open resets the mode, the typed ZIP and the search
        // results, so a previous search never reappears. The device fix lives in
        // the provider, so it deliberately survives this remount.
        key={sheetOpen ? 'open' : 'closed'}
        visible={sheetOpen}
        stores={stores}
        selected={choosingHome ? homeStore : store}
        choosingHome={choosingHome}
        loading={loading}
        loadError={loadError}
        onRetry={() => {
          setRetryingStores(true);
          setLoadAttempt((attempt) => attempt + 1);
        }}
        allowClear={allowClear}
        deviceOrigin={deviceOrigin}
        locating={locating}
        locationRefusal={locationRefusal}
        onUseDeviceLocation={useDeviceLocation}
        onClearDeviceOrigin={clearDeviceOrigin}
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

// Location Service error handling lives in ./device-location so the sheet and the
// product page cannot drift apart.

// Mounted once, from the provider, so every entry point (the Account row, the
// product page link, and every "select a store" price prompt) opens this same
// sheet. Cancelling changes nothing.
function StoreSelectorSheet({
  visible,
  stores,
  selected,
  choosingHome,
  loading,
  loadError,
  onRetry,
  allowClear,
  deviceOrigin,
  locating,
  locationRefusal,
  onUseDeviceLocation,
  onClearDeviceOrigin,
  onPick,
  onClear,
  onClose,
}: {
  visible: boolean;
  stores: Store[];
  selected: Store | null;
  choosingHome: boolean;
  loading: boolean;
  loadError: string | null;
  onRetry: () => void;
  allowClear: boolean;
  deviceOrigin: DeviceOrigin | null;
  locating: boolean;
  locationRefusal: LocationRefusal | null;
  onUseDeviceLocation: () => void;
  onClearDeviceOrigin: () => void;
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
  // Only the searched place is local. The device's fix comes from the provider,
  // because it outlives this sheet (the product page measures from it too), while
  // a search is this visit's choice and resets on the next open.
  const [placeOrigin, setPlaceOrigin] = useState<LocationSuggestion | null>(null);

  const showStores = mode === 'near' || placeOrigin !== null;
  const selectedOrigin = mode === 'search' && placeOrigin
    ? { latitude: placeOrigin.latitude, longitude: placeOrigin.longitude, name: placeOrigin.label }
    : deviceOrigin
      ? {
          latitude: deviceOrigin.latitude,
          longitude: deviceOrigin.longitude,
          name: 'your current location',
        }
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

  const changeQuery = (query: string) => {
    setZipQuery(query);
    setPlaceOrigin(null);
    setSuggestions(null);
    setSearchError(null);
  };

  const search = async () => {
    if (!canSearch || searching) return;
    Keyboard.dismiss();
    setSearching(true);
    setPlaceOrigin(null);
    setSearchError(null);
    setSuggestions(null);
    try {
      setSuggestions(await searchLocations(zipQuery.trim()));
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
      onRequestClose={onClose}>
      <KeyboardAvoidingView style={styles.overlay} behavior="padding">
        <ThemedView style={styles.dialog}>
          <View style={styles.header}>
            <View style={styles.headingText}>
              <ThemedText type="subtitle">{choosingHome ? 'Home store' : 'Your store'}</ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                {choosingHome ? 'This is the default when you open the app.' : 'Prices and stock are shown for the store you pick.'}
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
              label="Search location"
              onPress={() => setMode('search')}
              secondary={mode !== 'search'}
            />
          </View>

          {mode === 'near' && (
            <View style={styles.locationBlock}>
              {deviceOrigin ? (
                <View style={styles.locationActive}>
                  <ThemedText type="small" themeColor="textSecondary" style={styles.locationText}>
                    Using your current location.
                  </ThemedText>
                  <Pressable
                    onPress={onClearDeviceOrigin}
                    accessibilityRole="button"
                    accessibilityLabel="Stop using your current location"
                    hitSlop={8}>
                    <ThemedText type="linkPrimary">Stop</ThemedText>
                  </Pressable>
                </View>
              ) : (
                <ActionButton
                  label={locating ? 'Finding you…' : 'Use my location'}
                  onPress={onUseDeviceLocation}
                  disabled={locating}
                  compact
                />
              )}

              {locationRefusal && (
                <ThemedText type="small" style={styles.locationText}>
                  {locationProblem(locationRefusal)}
                </ThemedText>
              )}
              {locationRefusal?.status === 'denied' && !locationRefusal.canAskAgain && (
                <Pressable
                  onPress={() => Linking.openSettings()}
                  accessibilityRole="button"
                  accessibilityLabel="Open device settings to allow location"
                  hitSlop={8}>
                  <ThemedText type="linkPrimary">Open settings</ThemedText>
                </Pressable>
              )}
            </View>
          )}

          {mode === 'search' && (
            <View style={styles.searchBlock}>
              <View style={styles.searchRow}>
                <TextInput
                  value={zipQuery}
                  onChangeText={changeQuery}
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
                  No locations found. Try a different ZIP code or city.
                </ThemedText>
              )}
            </View>
          )}

          {!showStores && !!suggestions?.length && (
            <ScrollView
              style={styles.list}
              contentContainerStyle={styles.listContent}
              keyboardShouldPersistTaps="handled">
              {suggestions.map((place) => (
                <Pressable
                  key={place.id}
                  onPress={() => {
                    Keyboard.dismiss();
                    setPlaceOrigin(place);
                    setSuggestions(null);
                  }}
                  accessibilityRole="button"
                  style={({ pressed }) => [styles.suggestion, pressed && styles.dimmed]}>
                  <ThemedView type="backgroundElement" style={styles.listing}>
                    <ThemedText type="smallBold">{place.label}</ThemedText>
                  </ThemedView>
                </Pressable>
              ))}
            </ScrollView>
          )}

          {showStores && (loading || loadError || stores.length === 0) && (
            <View style={styles.center}>
              {loading ? (
                <>
                  <ActivityIndicator />
                  <ThemedText themeColor="textSecondary">Loading stores…</ThemedText>
                </>
              ) : (
                <>
                  <ThemedText themeColor="textSecondary">
                    {loadError ?? 'No stores are available.'}
                  </ThemedText>
                  <ActionButton label="Try again" onPress={onRetry} />
                </>
              )}
            </View>
          )}

          {showStores && !loading && stores.length > 0 && (
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

          {showStores && !loading && allowClear && selected && (
            <View style={styles.footer}>
              <ActionButton label={choosingHome ? 'Clear home store' : 'Clear store'} onPress={onClear} secondary />
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
  locationBlock: { gap: Spacing.two },
  locationActive: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.two,
  },
  locationText: { flexShrink: 1 },
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
