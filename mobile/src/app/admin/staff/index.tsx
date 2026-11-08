import { useRouter } from "expo-router";
import { SymbolView } from "expo-symbols";
import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import type { StaffRole } from "@/api/general";
import {
  findStaffCandidates, getStaff, getStaffStores, removeStaffRole, setStaffRole,
  type StaffAssignment, type StaffPerson, type StaffStore,
} from "@/api/staff";
import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";
import { MaxContentWidth, Spacing } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";
import { confirmAction } from "@/utils/confirm";

const PAGE_SIZE = 20;
const roleLabel = (role: StaffRole) => role === "store_admin" ? "Store admin" : "Store buyer";
const messageOf = (error: unknown) => error instanceof Error ? error.message : "Please try again.";
type Editor = { person: StaffPerson; store: StaffStore; currentRole: StaffRole | null };

function Action({ label, onPress, disabled = false, selected = false, variant = "secondary" }: {
  label: string; onPress: () => void; disabled?: boolean; selected?: boolean;
  variant?: "primary" | "secondary" | "ghost" | "danger";
}) {
  const theme = useTheme();
  return (
    <Pressable accessibilityRole="button" accessibilityState={{ disabled, selected }}
      disabled={disabled} onPress={onPress}
      style={({ pressed }) => [styles.action, {
        backgroundColor: variant === "primary" ? theme.text
          : variant === "ghost" ? "transparent" : theme.backgroundElement,
      }, (disabled || pressed) && styles.dim]}>
      <ThemedText type="smallBold" style={{
        color: variant === "primary" ? theme.background : variant === "danger" ? "#D93443" : theme.text,
      }}>{label}</ThemedText>
    </Pressable>
  );
}

export default function StaffManagement() {
  const router = useRouter();
  const theme = useTheme();
  const [stores, setStores] = useState<StaffStore[]>([]);
  const [storeId, setStoreId] = useState<number | null>(null);
  const store = stores.find((item) => item.store_id === storeId);
  const [choosingStore, setChoosingStore] = useState(false);
  const [optionsLoading, setOptionsLoading] = useState(true);
  const [optionsError, setOptionsError] = useState<string | null>(null);
  const [optionsVersion, setOptionsVersion] = useState(0);
  const [mode, setMode] = useState<"staff" | "add">("staff");
  const [query, setQuery] = useState("");
  const [submittedQuery, setSubmittedQuery] = useState("");
  const [offset, setOffset] = useState(0);
  const [rows, setRows] = useState<(StaffPerson | StaffAssignment)[]>([]);
  const [hasNext, setHasNext] = useState(false);
  const [listLoading, setListLoading] = useState(false);
  const [listError, setListError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [editor, setEditor] = useState<Editor | null>(null);
  const [role, setRole] = useState<StaffRole>("store_buyer");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const mutationPending = useRef(false);

  useEffect(() => {
    let active = true;
    setOptionsLoading(true);
    setOptionsError(null);
    getStaffStores().then((loaded) => {
      if (!active) return;
      setStores(loaded);
      setStoreId((previous) => loaded.some((s) => s.store_id === previous)
        ? previous : loaded[0]?.store_id ?? null);
    }).catch((error: unknown) => {
      if (active) setOptionsError(messageOf(error));
    }).finally(() => { if (active) setOptionsLoading(false); });
    return () => { active = false; };
  }, [optionsVersion]);

  useEffect(() => {
    let active = true;
    setRows([]);
    setHasNext(false);
    setListError(null);
    if (storeId === null || (mode === "add" && submittedQuery.length < 2)) {
      setListLoading(false);
      return;
    }
    setListLoading(true);
    // Fetch one extra row to determine whether another page exists.
    const request = mode === "staff"
      ? getStaff(storeId, offset, PAGE_SIZE + 1)
      : findStaffCandidates(storeId, submittedQuery, offset, PAGE_SIZE + 1);
    request.then((loaded) => {
      if (!active) return;
      setRows(loaded.slice(0, PAGE_SIZE));
      setHasNext(loaded.length > PAGE_SIZE);
    }).catch((error: unknown) => {
      if (active) setListError(messageOf(error));
    }).finally(() => { if (active) setListLoading(false); });
    return () => { active = false; };
  }, [storeId, mode, submittedQuery, offset, revision]);

  function changeMode(next: "staff" | "add") {
    setMode(next);
    setOffset(0);
    setFeedback(null);
    setQuery("");
    setSubmittedQuery("");
  }

  function openEditor(person: StaffPerson | StaffAssignment) {
    if (!store || store.allowed_roles.length === 0) return;
    const currentRole = "store_id" in person ? person.role : null;
    setEditor({ person, store, currentRole });
    const existingRole = person.role === "store_buyer" || person.role === "store_admin" ? person.role : null;
    setRole(existingRole && store.allowed_roles.includes(existingRole) ? existingRole : store.allowed_roles[0]);
    setSaveError(null);
  }

  async function save(remove = false) {
    if (!editor || mutationPending.current) return;
    mutationPending.current = true;
    setSaving(true);
    setSaveError(null);
    try {
      if (remove && !await confirmAction(
        "Remove staff access?",
        `Remove ${editor.person.email}'s staff access at ${editor.store.name}? Their shopper account and access at other stores will remain.`,
        "Remove access",
      )) return;
      if (remove) await removeStaffRole(editor.person.user_id, editor.store.store_id);
      else await setStaffRole(editor.person.user_id, editor.store.store_id, role);
      setFeedback(remove ? "Staff access removed at this store." : "Staff access saved.");
      setEditor(null);
      setOffset(0);
      setRevision((value) => value + 1);
    } catch (error) {
      setSaveError(messageOf(error));
    } finally {
      mutationPending.current = false;
      setSaving(false);
    }
  }

  const search = () => {
    setSubmittedQuery(query.trim());
    setOffset(0);
    setRevision((value) => value + 1);
  };
  const closeEditor = () => { if (!mutationPending.current) setEditor(null); };
  const refresh = () => {
    setOptionsVersion((value) => value + 1);
    setRevision((value) => value + 1);
  };

  return (
    <ThemedView style={styles.root}>
      <SafeAreaView style={styles.safe}>
        <View style={[styles.topBar, { borderBottomColor: theme.backgroundSelected }]}>
          <Action label="‹ Account" variant="ghost" onPress={() => router.canGoBack() ? router.back() : router.replace("/account")} />
          <Pressable accessibilityRole="button" accessibilityLabel="Refresh stores and staff"
            accessibilityState={{ disabled: optionsLoading || listLoading, busy: optionsLoading || listLoading }}
            disabled={optionsLoading || listLoading} onPress={refresh} hitSlop={4}
            style={({ pressed }) => [styles.iconButton, { backgroundColor: theme.backgroundElement }, pressed && styles.dim]}>
            {optionsLoading || listLoading ? <ActivityIndicator size="small" color={theme.text} /> :
              <SymbolView name={{ ios: "arrow.clockwise", android: "refresh", web: "refresh" }} size={21} tintColor={theme.text} />}
          </Pressable>
        </View>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <View style={styles.section}>
            <ThemedText type="subtitle" style={styles.title}>Manage staff</ThemedText>
            <ThemedText themeColor="textSecondary" type="small">Choose a store to view staff or give someone access.</ThemedText>
          </View>
          {optionsLoading ? <ActivityIndicator /> : optionsError ? (
            <View style={styles.section}>
              <ThemedText accessibilityRole="alert">{optionsError}</ThemedText>
              <Action label="Try again" onPress={() => setOptionsVersion((value) => value + 1)} />
            </View>
          ) : !store ? <ThemedText>No stores are available for you to manage.</ThemedText> : (
            <>
              <Pressable accessibilityRole="button" accessibilityLabel={`Managing ${store.name}. Choose a store`}
                accessibilityState={{ expanded: choosingStore }} onPress={() => setChoosingStore(true)}
                style={({ pressed }) => [styles.storeBar, { backgroundColor: theme.backgroundElement }, pressed && styles.dim]}>
                <ThemedText type="small" themeColor="textSecondary">Managing</ThemedText>
                <ThemedText type="smallBold" style={styles.grow} numberOfLines={1}>{store.name}</ThemedText>
                <ThemedText themeColor="textSecondary">▾</ThemedText>
              </Pressable>
              <View style={[styles.tabs, { backgroundColor: theme.backgroundElement }]}>
                {(["staff", "add"] as const).map((tab) => (
                  <Pressable key={tab} accessibilityRole="tab" accessibilityState={{ selected: mode === tab }}
                    onPress={() => changeMode(tab)} style={({ pressed }) => [styles.tab,
                      { backgroundColor: mode === tab ? theme.background : "transparent" }, pressed && styles.dim]}>
                    <ThemedText type="smallBold" themeColor={mode === tab ? "text" : "textSecondary"}>
                      {tab === "staff" ? "Current staff" : "+ Add staff"}
                    </ThemedText>
                  </Pressable>
                ))}
              </View>
              {feedback && <ThemedView type="backgroundElement" style={styles.notice}>
                <ThemedText type="small" accessibilityLiveRegion="polite">✓ {feedback}</ThemedText>
              </ThemedView>}
              {mode === "add" && (
                <View style={styles.section}>
                  <ThemedText type="smallBold">Find an existing user</ThemedText>
                  <TextInput value={query} onChangeText={setQuery} maxLength={150}
                    placeholder="Search by email" placeholderTextColor={theme.textSecondary}
                    accessibilityLabel="Search users by email" autoCapitalize="none" autoCorrect={false}
                    keyboardType="email-address" returnKeyType="search"
                    onSubmitEditing={() => { if (query.trim().length >= 2) search(); }}
                    style={[styles.input, { color: theme.text, backgroundColor: theme.backgroundElement }]} />
                  <Action label="Search users" variant="primary" onPress={search} disabled={query.trim().length < 2 || listLoading} />
                  <ThemedText type="small" themeColor="textSecondary">
                    Users must have signed in at least once. People already assigned here appear under Current staff.
                  </ThemedText>
                </View>
              )}
              {listLoading ? <ActivityIndicator /> : listError ? (
                <View style={styles.section}>
                  <ThemedText accessibilityRole="alert">{listError}</ThemedText>
                  <Action label="Try again" onPress={() => setRevision((value) => value + 1)} />
                </View>
              ) : rows.length === 0 ? (
                <ThemedView type="backgroundElement" style={styles.empty}>
                  <ThemedText type="smallBold">{mode === "add" ? submittedQuery ? "No users found" : "Find someone to add" : "No staff to manage yet"}</ThemedText>
                  <ThemedText type="small" themeColor="textSecondary" style={styles.centerText}>
                    {mode === "add" && !submittedQuery ? "Enter at least two characters and search by email."
                      : mode === "add" ? "Try a different email address."
                      : "Use Add staff to assign a user to this store."}
                  </ThemedText>
                </ThemedView>
              ) : rows.map((person) => (
                <Pressable key={person.user_id} accessibilityRole="button"
                  accessibilityLabel={`${mode === "add" ? "Assign" : "Manage"} ${person.email}`}
                  onPress={() => openEditor(person)} style={({ pressed }) => pressed && styles.dim}>
                  <ThemedView type="backgroundElement" style={styles.personRow}>
                    <ThemedView type="backgroundSelected" style={styles.avatar}>
                      <ThemedText type="smallBold">{person.email.charAt(0).toUpperCase()}</ThemedText>
                    </ThemedView>
                    <View style={[styles.grow, styles.section]}>
                      <ThemedText type="smallBold">{person.email}</ThemedText>
                      <ThemedText themeColor="textSecondary" type="small">
                        {person.role === "store_buyer" || person.role === "store_admin" ? roleLabel(person.role) : "Shopper"}
                      </ThemedText>
                    </View>
                    <SymbolView name={{ ios: "chevron.right", android: "chevron_right", web: "chevron_right" }} size={18} tintColor={theme.textSecondary} />
                  </ThemedView>
                </Pressable>
              ))}
              {(offset > 0 || hasNext) && <View style={styles.toolbar}>
                <Action label="Previous" disabled={offset === 0 || listLoading}
                  onPress={() => setOffset((value) => Math.max(0, value - PAGE_SIZE))} />
                <ThemedText type="small">Page {offset / PAGE_SIZE + 1}</ThemedText>
                <Action label="Next" disabled={!hasNext || listLoading} onPress={() => setOffset((value) => value + PAGE_SIZE)} />
              </View>}
            </>
          )}
        </ScrollView>
      </SafeAreaView>
      <Modal visible={choosingStore} transparent animationType="fade" onRequestClose={() => setChoosingStore(false)}>
        <View style={styles.backdrop}>
          <Pressable style={StyleSheet.absoluteFill} accessibilityRole="button" accessibilityLabel="Close store selection" onPress={() => setChoosingStore(false)} />
          <ThemedView style={styles.sheet} accessibilityViewIsModal>
            <View style={styles.sheetHeader}>
              <ThemedText type="subtitle" style={styles.sheetTitle}>Choose a store</ThemedText>
              <Pressable accessibilityRole="button" accessibilityLabel="Close store selection" onPress={() => setChoosingStore(false)} style={styles.iconButton}>
                <SymbolView name={{ ios: "xmark", android: "close", web: "close" }} size={19} tintColor={theme.textSecondary} />
              </Pressable>
            </View>
            <ThemedText type="small" themeColor="textSecondary">Staff access is managed for the selected store.</ThemedText>
            <ScrollView keyboardShouldPersistTaps="handled" style={styles.storeList}>
              {stores.map((item) => (
                <Pressable key={item.store_id} accessibilityRole="radio" accessibilityState={{ checked: item.store_id === storeId }}
                  onPress={() => {
                    if (item.store_id !== storeId) {
                      setRows([]);
                      setStoreId(item.store_id);
                      setOffset(0);
                      setFeedback(null);
                    }
                    setChoosingStore(false);
                  }}
                  style={({ pressed }) => [styles.storeOption, {
                    backgroundColor: item.store_id === storeId ? theme.backgroundElement : "transparent",
                  }, pressed && styles.dim]}>
                  <View style={[styles.grow, styles.section]}>
                    <ThemedText type="smallBold">{item.name}</ThemedText>
                    <ThemedText type="small" themeColor="textSecondary">{item.address}</ThemedText>
                  </View>
                  {item.store_id === storeId && <SymbolView name={{ ios: "checkmark", android: "check", web: "check" }} size={20} tintColor={theme.text} />}
                </Pressable>
              ))}
            </ScrollView>
          </ThemedView>
        </View>
      </Modal>
      <Modal visible={editor !== null} animationType="slide" onRequestClose={closeEditor}>
        <ThemedView style={styles.root}>
          <SafeAreaView style={styles.safe}>
            <ScrollView contentContainerStyle={styles.content}>
              <Action label="‹ Cancel" variant="ghost" onPress={closeEditor} disabled={saving} />
              <ThemedText type="subtitle">{editor?.currentRole ? "Edit staff access" : "Add staff"}</ThemedText>
              <ThemedText>{editor?.person.email}</ThemedText>
              <ThemedText themeColor="textSecondary">{editor?.store.name}</ThemedText>
              {editor?.currentRole && <ThemedText type="small">Current role: {roleLabel(editor.currentRole)}</ThemedText>}
              <ThemedText type="smallBold">{editor?.store.allowed_roles.length === 1 ? "Assign as" : "Choose a role"}</ThemedText>
              {editor?.store.allowed_roles.map((choice) => (
                <Pressable key={choice} accessibilityRole="radio" accessibilityState={{ checked: role === choice, disabled: saving }}
                  disabled={saving} onPress={() => setRole(choice)}
                  style={[styles.card, { backgroundColor: role === choice ? theme.backgroundSelected : theme.backgroundElement }]}>
                  <ThemedText type="smallBold">{role === choice ? "●" : "○"} {roleLabel(choice)}</ThemedText>
                  <ThemedText type="small" themeColor="textSecondary">
                    {choice === "store_buyer" ? "Manage stock at assigned stores." : "Manage inventory, stock, and buyers at assigned stores."}
                  </ThemedText>
                </Pressable>
              ))}
              <ThemedText type="small" themeColor="textSecondary">Only this store assignment changes. Changing the role affects every store assigned to this person.</ThemedText>
              {saveError && <ThemedText accessibilityRole="alert">{saveError}</ThemedText>}
              {saving && <ActivityIndicator />}
              <Action label={saving ? "Please wait…" : "Save access"} variant="primary" onPress={() => save()}
                disabled={saving || role === editor?.currentRole} />
              {editor?.currentRole && <Action label="Remove staff access at this store" variant="danger"
                onPress={() => save(true)} disabled={saving} />}
            </ScrollView>
          </SafeAreaView>
        </ThemedView>
      </Modal>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, alignItems: "center" },
  safe: { flex: 1, width: "100%", maxWidth: MaxContentWidth },
  topBar: { minHeight: 64, paddingHorizontal: Spacing.three, flexDirection: "row", alignItems: "center", justifyContent: "space-between", borderBottomWidth: StyleSheet.hairlineWidth },
  title: { fontSize: 28, lineHeight: 34 },
  content: { padding: Spacing.four, paddingBottom: Spacing.five, gap: Spacing.three },
  section: { gap: Spacing.two },
  toolbar: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: Spacing.three },
  card: { padding: Spacing.three, borderRadius: 12, gap: Spacing.two },
  action: { minHeight: 46, alignItems: "center", justifyContent: "center", borderRadius: 10, paddingVertical: Spacing.two, paddingHorizontal: Spacing.three },
  dim: { opacity: 0.45 },
  input: { borderRadius: 10, padding: Spacing.three, fontSize: 16 },
  grow: { flex: 1, minWidth: 0 },
  iconButton: { width: 44, height: 44, alignItems: "center", justifyContent: "center", borderRadius: 12 },
  storeBar: { minHeight: 52, flexDirection: "row", alignItems: "center", gap: Spacing.two, borderRadius: Spacing.three, paddingVertical: Spacing.two, paddingHorizontal: Spacing.three },
  tabs: { flexDirection: "row", padding: 4, borderRadius: 12, gap: 4 },
  tab: { flex: 1, minHeight: 44, alignItems: "center", justifyContent: "center", borderRadius: 9, paddingHorizontal: Spacing.two },
  notice: { borderRadius: 10, padding: Spacing.three },
  empty: { borderRadius: 12, padding: Spacing.four, alignItems: "center", gap: Spacing.two },
  centerText: { textAlign: "center" },
  personRow: { flexDirection: "row", alignItems: "center", gap: Spacing.three, padding: Spacing.three, borderRadius: 12 },
  avatar: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center" },
  backdrop: { flex: 1, justifyContent: "center", alignItems: "center", padding: Spacing.four, backgroundColor: "rgba(0, 0, 0, 0.45)" },
  sheet: { width: "100%", maxWidth: 480, maxHeight: "80%", borderRadius: Spacing.four, padding: Spacing.four, gap: Spacing.two },
  sheetHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: Spacing.two },
  sheetTitle: { fontSize: 20, flex: 1 },
  storeList: { flexGrow: 0, marginTop: Spacing.two },
  storeOption: { minHeight: 64, flexDirection: "row", alignItems: "center", gap: Spacing.two, padding: Spacing.three, borderRadius: 12, marginBottom: Spacing.one },
});
