import { useRouter } from "expo-router";
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

function Action({ label, onPress, disabled = false, selected = false }: {
  label: string; onPress: () => void; disabled?: boolean; selected?: boolean;
}) {
  return (
    <Pressable accessibilityRole="button" accessibilityState={{ disabled, selected }}
      disabled={disabled} onPress={onPress}
      style={({ pressed }) => [styles.action, (disabled || pressed) && styles.dim]}>
      <ThemedText type="smallBold">{label}</ThemedText>
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

  return (
    <ThemedView style={styles.root}>
      <SafeAreaView style={styles.safe}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <Action label="‹ Account" onPress={() => router.canGoBack() ? router.back() : router.replace("/account")} />
          <ThemedText type="subtitle">Manage staff</ThemedText>
          <ThemedText themeColor="textSecondary">Manage store assignments. Each person has one role across all assigned stores.</ThemedText>
          {optionsLoading ? <ActivityIndicator /> : optionsError ? (
            <View style={styles.section}>
              <ThemedText accessibilityRole="alert">{optionsError}</ThemedText>
              <Action label="Try again" onPress={() => setOptionsVersion((value) => value + 1)} />
            </View>
          ) : !store ? <ThemedText>No stores are available for you to manage.</ThemedText> : (
            <>
              <ThemedView type="backgroundElement" style={styles.card}>
                <ThemedText type="small" themeColor="textSecondary">Selected store</ThemedText>
                <ThemedText type="smallBold">{store.name}</ThemedText>
                <ThemedText type="small" themeColor="textSecondary">{store.address}</ThemedText>
                {stores.length > 1 && <Action label={choosingStore ? "Close store list" : "Change store"}
                  onPress={() => setChoosingStore(!choosingStore)} />}
                {choosingStore && stores.map((item) => (
                  <Action key={item.store_id} label={`${item.store_id === storeId ? "✓ " : ""}${item.name}`}
                    selected={item.store_id === storeId} onPress={() => {
                      setStoreId(item.store_id); setOffset(0); setChoosingStore(false); setFeedback(null);
                    }} />
                ))}
              </ThemedView>
              <View style={styles.toolbar}>
                <Action label={mode === "staff" ? "✓ Current staff" : "Current staff"}
                  selected={mode === "staff"} onPress={() => changeMode("staff")} />
                <Action label={mode === "add" ? "✓ Add staff" : "+ Add staff"}
                  selected={mode === "add"} onPress={() => changeMode("add")} />
              </View>
              {feedback && <ThemedText accessibilityLiveRegion="polite">{feedback}</ThemedText>}
              {mode === "add" && (
                <View style={styles.section}>
                  <ThemedText type="smallBold">Find an existing user</ThemedText>
                  <TextInput value={query} onChangeText={setQuery} maxLength={150}
                    placeholder="Search by email" placeholderTextColor={theme.textSecondary}
                    accessibilityLabel="Search users by email" autoCapitalize="none" autoCorrect={false}
                    keyboardType="email-address" returnKeyType="search"
                    onSubmitEditing={() => { if (query.trim().length >= 2) search(); }}
                    style={[styles.input, { color: theme.text, backgroundColor: theme.backgroundElement }]} />
                  <Action label="Search" onPress={search} disabled={query.trim().length < 2 || listLoading} />
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
                <ThemedText themeColor="textSecondary">
                  {mode === "add" && !submittedQuery ? "Enter at least two characters and tap Search."
                    : mode === "add" ? "No eligible users found. Try another email."
                    : "No staff you can manage at this store."}
                </ThemedText>
              ) : rows.map((person) => (
                <ThemedView key={person.user_id} type="backgroundElement" style={styles.card}>
                  <ThemedText type="smallBold">{person.email}</ThemedText>
                  {"store_id" in person && <ThemedText themeColor="textSecondary" type="small">{roleLabel(person.role)}</ThemedText>}
                  <Action label={mode === "add" ? "Choose user" : "Manage access"} onPress={() => openEditor(person)} />
                </ThemedView>
              ))}
              {(offset > 0 || hasNext) && <View style={styles.toolbar}>
                <Action label="Previous" disabled={offset === 0 || listLoading}
                  onPress={() => setOffset((value) => Math.max(0, value - PAGE_SIZE))} />
                <ThemedText type="small">Page {offset / PAGE_SIZE + 1}</ThemedText>
                <Action label="Next" disabled={!hasNext || listLoading} onPress={() => setOffset((value) => value + PAGE_SIZE)} />
              </View>}
              <Action label="Refresh stores and staff" onPress={() => {
                setOptionsVersion((value) => value + 1); setRevision((value) => value + 1);
              }} disabled={listLoading} />
            </>
          )}
        </ScrollView>
      </SafeAreaView>
      <Modal visible={editor !== null} animationType="slide" onRequestClose={closeEditor}>
        <ThemedView style={styles.root}>
          <SafeAreaView style={styles.safe}>
            <ScrollView contentContainerStyle={styles.content}>
              <Action label="Cancel" onPress={closeEditor} disabled={saving} />
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
              <Action label={saving ? "Please wait…" : "Save access"} onPress={() => save()}
                disabled={saving || role === editor?.currentRole} />
              {editor?.currentRole && <Action label="Remove staff access at this store"
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
  content: { padding: Spacing.three, paddingBottom: Spacing.five, gap: Spacing.three },
  section: { gap: Spacing.two },
  toolbar: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: Spacing.three },
  card: { padding: Spacing.three, borderRadius: 12, gap: Spacing.two },
  action: { minHeight: 44, justifyContent: "center", paddingVertical: Spacing.two, paddingHorizontal: Spacing.two },
  dim: { opacity: 0.45 },
  input: { borderRadius: 10, padding: Spacing.three, fontSize: 16 },
});
