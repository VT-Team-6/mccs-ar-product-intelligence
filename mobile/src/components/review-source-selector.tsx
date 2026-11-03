import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Linking,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';

import {
  getReviewSources,
  importProductReviews,
  saveReviewSources,
  searchReviewCandidates,
  type ReviewCandidate,
  type ReviewImportResult,
  type SavedReviewSource,
} from '@/api/reviews';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { confirmAction } from '@/utils/confirm';

type Props = {
  visible: boolean;
  productId: number;
  productName: string;
  onClose: () => void;
  source?: string;
};

// Used after creating a product, and again when an admin wants to change its sources.
export function ReviewSourceSelector({
  visible,
  productId,
  productName,
  onClose,
  source = 'amazon',
}: Props) {
  const theme = useTheme();
  const [query, setQuery] = useState(productName);
  const [candidates, setCandidates] = useState<ReviewCandidate[]>([]);
  const [knownCandidates, setKnownCandidates] = useState<Record<string, ReviewCandidate>>({});
  const [savedSources, setSavedSources] = useState<SavedReviewSource[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [searching, setSearching] = useState(false);
  const [saving, setSaving] = useState(false);
  const [reload, setReload] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [selectionSaved, setSelectionSaved] = useState(false);
  const [result, setResult] = useState<ReviewImportResult | null>(null);

  // Whenever the modal opens, load the saved selections and initial suggestions.
  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    setQuery(productName);
    setCandidates([]);
    setKnownCandidates({});
    setSavedSources([]);
    setSelectedIds([]);
    setResult(null);
    setError(null);
    setSelectionSaved(false);
    setSearching(false);
    setLoading(true);

    Promise.all([
      getReviewSources(productId, source),
      searchReviewCandidates(productId, undefined, source),
    ])
      .then(([saved, found]) => {
        if (cancelled) return;
        setSavedSources(saved);
        setSelectedIds(saved.map((item) => item.source_product_id));
        setCandidates(found);
        setKnownCandidates(Object.fromEntries(found.map((item) => [item.source_product_id, item])));
      })
      .catch((problem: Error) => {
        if (!cancelled) setError(problem.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [visible, productId, productName, source, reload]);

  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const resultsToShow = useMemo(() => {
    // Keep selected listings visible, even after the admin changes the search terms.
    const savedMap = new Map(savedSources.map((item) => [item.source_product_id, item]));
    const selected = selectedIds.map((id) => knownCandidates[id] ?? {
      source_product_id: id,
      title: `Previously selected listing (${id})`,
      description: null,
      url: savedMap.get(id)?.source_url ?? null,
      review_count: null,
    });
    return [...selected, ...candidates.filter((item) => !selectedSet.has(item.source_product_id))];
  }, [candidates, knownCandidates, savedSources, selectedIds, selectedSet]);

  function toggle(id: string) {
    setError(null);
    setSelectionSaved(false);
    if (!selectedIds.includes(id) && selectedIds.length >= 20) {
      setError('You can select up to 20 listings.');
      return;
    }
    setSelectedIds((current) => current.includes(id)
      ? current.filter((item) => item !== id)
      : [...current, id]);
  }

  async function search() {
    if (!query.trim() || searching || saving) return;
    setSearching(true);
    setError(null);
    try {
      const found = await searchReviewCandidates(productId, query.trim(), source);
      setCandidates(found);
      setKnownCandidates((current) => ({
        ...current,
        ...Object.fromEntries(found.map((item) => [item.source_product_id, item])),
      }));
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : 'Could not search listings.');
    } finally {
      setSearching(false);
    }
  }

  async function confirmAndImport() {
    if (saving || loading || result) return;
    if (selectedIds.length === 0 && savedSources.length === 0) return;

    if (selectedIds.length === 0) {
      const confirmed = await confirmAction(
        'Remove review sources?',
        'This will also remove reviews associated with these listings.',
        'Remove sources',
      );
      if (!confirmed) return;
    }

    setSaving(true);
    setError(null);
    try {
      // The PUT only manages the selected listings. Import is a separate operation.
      if (!selectionSaved) {
        const saved = await saveReviewSources(productId, source, selectedIds);
        setSavedSources(saved);
        setSelectionSaved(true);
      }
      if (selectedIds.length === 0) {
        onClose();
        return;
      }
      const imported = await importProductReviews(productId);
      setResult(imported);
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : 'Could not import reviews.');
    } finally {
      setSaving(false);
    }
  }

  async function openListing(url: string) {
    if (!/^https?:\/\//i.test(url)) return;
    try {
      await Linking.openURL(url);
    } catch {
      setError('Could not open that listing link.');
    }
  }

  const providerLabel = source === 'amazon' ? 'Amazon · archived reviews' : source;
  const buttonLabel = saving
    ? (selectionSaved ? 'Importing…' : 'Saving…')
    : selectionSaved
      ? 'Retry import'
      : selectedIds.length === 0
        ? 'Remove all sources'
        : `Save & import (${selectedIds.length})`;

  function dismiss() {
    if (!saving) onClose();
  }

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={dismiss}
      statusBarTranslucent>
      <KeyboardAvoidingView
        style={styles.overlay}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ThemedView style={styles.dialog}>
          <View style={styles.header}>
            <View style={styles.headingText}>
              <ThemedText type="subtitle">Review sources</ThemedText>
              <ThemedText themeColor="textSecondary">{productName}</ThemedText>
            </View>
            <Pressable
              onPress={dismiss}
              disabled={saving}
              accessibilityRole="button"
              accessibilityLabel="Close review source selector"
              hitSlop={12}>
              <ThemedText type="linkPrimary">Close</ThemedText>
            </Pressable>
          </View>

          {result ? (
            <View style={styles.result}>
              <ThemedText type="subtitle">Reviews imported</ThemedText>
              <ThemedText>
                Imported {result.imported_reviews} review{result.imported_reviews === 1 ? '' : 's'} from{' '}
                {result.source_count} selected listing{result.source_count === 1 ? '' : 's'}.
              </ThemedText>
              <ActionButton label="Done" onPress={dismiss} />
            </View>
          ) : (
            <>
              <ThemedText type="small" themeColor="textSecondary">
                Select the listings that match this product. You can skip this step and add sources later.
              </ThemedText>
              <ThemedText type="smallBold">{providerLabel}</ThemedText>

              <View style={styles.searchRow}>
                <TextInput
                  style={[styles.searchInput, { color: theme.text, backgroundColor: theme.backgroundElement }]}
                  placeholder="Search product listings"
                  placeholderTextColor={theme.textSecondary}
                  value={query}
                  onChangeText={setQuery}
                  onSubmitEditing={search}
                  returnKeyType="search"
                  autoCorrect={false}
                  editable={!saving}
                />
                <ActionButton label={searching ? 'Searching…' : 'Search'} onPress={search} disabled={searching || loading || saving || !query.trim()} compact />
              </View>

              {error && (
                <ThemedText type="small" style={styles.error}>{error}</ThemedText>
              )}
              {selectionSaved && error && (
                <ThemedText type="small" themeColor="textSecondary">
                  Your selections were saved, but the import failed. Retry import below.
                </ThemedText>
              )}

              {loading ? (
                <View style={styles.center}><ActivityIndicator /><ThemedText themeColor="textSecondary">Loading listings…</ThemedText></View>
              ) : error && resultsToShow.length === 0 ? (
                <View style={styles.center}>
                  <ActionButton label="Retry loading" onPress={() => setReload((value) => value + 1)} />
                </View>
              ) : (
                <>
                  <ThemedText type="small" themeColor="textSecondary">
                    {selectedIds.length} selected · {candidates.length} search result{candidates.length === 1 ? '' : 's'}
                  </ThemedText>
                  <ScrollView
                    style={styles.list}
                    contentContainerStyle={styles.listContent}
                    keyboardShouldPersistTaps="handled">
                    {resultsToShow.length === 0 ? (
                      <ThemedText themeColor="textSecondary">
                        No matching listings found. Try a different search, or skip for now.
                      </ThemedText>
                    ) : resultsToShow.map((item) => (
                      <ListingRow
                        key={item.source_product_id}
                        item={item}
                        selected={selectedSet.has(item.source_product_id)}
                        onToggle={() => toggle(item.source_product_id)}
                        onOpen={() => item.url && openListing(item.url)}
                      />
                    ))}
                  </ScrollView>
                </>
              )}

              <View style={styles.footer}>
                <ActionButton label="Skip for now" onPress={dismiss} disabled={saving} secondary />
                <ActionButton
                  label={buttonLabel}
                  onPress={confirmAndImport}
                  disabled={saving || loading || searching || (selectedIds.length === 0 && savedSources.length === 0)}
                />
              </View>
            </>
          )}
        </ThemedView>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function ListingRow({
  item,
  selected,
  onToggle,
  onOpen,
}: {
  item: ReviewCandidate;
  selected: boolean;
  onToggle: () => void;
  onOpen: () => void;
}) {
  return (
    <ThemedView type="backgroundElement" style={styles.listing}>
      <Pressable onPress={onToggle} style={styles.listingMain} accessibilityRole="checkbox" accessibilityState={{ checked: selected }}>
        <View style={[styles.checkbox, selected && styles.checked]}>
          {selected && <ThemedText type="smallBold" style={styles.checkmark}>✓</ThemedText>}
        </View>
        <View style={styles.listingText}>
          <ThemedText type="smallBold">{item.title}</ThemedText>
          {item.description && item.description !== item.title && (
            <ThemedText type="small" themeColor="textSecondary">{item.description}</ThemedText>
          )}
          <ThemedText type="small" themeColor="textSecondary">
            {item.review_count === null ? 'Review count unavailable' : `${item.review_count} archived reviews`} · {item.source_product_id}
          </ThemedText>
        </View>
      </Pressable>
      {item.url && (
        <Pressable onPress={onOpen} accessibilityRole="link" hitSlop={8} style={styles.listingLink}>
          <ThemedText type="linkPrimary">View listing ↗</ThemedText>
        </Pressable>
      )}
    </ThemedView>
  );
}

function ActionButton({
  label,
  onPress,
  disabled = false,
  secondary = false,
  compact = false,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  secondary?: boolean;
  compact?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      style={({ pressed }) => [styles.buttonPress, (pressed || disabled) && styles.dimmed]}>
      <ThemedView type={secondary ? 'backgroundElement' : 'backgroundSelected'} style={[styles.button, compact && styles.compactButton]}>
        <ThemedText type="smallBold" style={styles.buttonText}>{label}</ThemedText>
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
  header: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: Spacing.two },
  headingText: { flex: 1, gap: Spacing.half },
  searchRow: { flexDirection: 'row', alignItems: 'stretch', gap: Spacing.two },
  searchInput: { flex: 1, minWidth: 0, borderRadius: Spacing.two, paddingHorizontal: Spacing.three, paddingVertical: Spacing.two, fontSize: 15 },
  center: { minHeight: 130, alignItems: 'center', justifyContent: 'center', gap: Spacing.two },
  list: { flexShrink: 1, minHeight: 80 },
  listContent: { gap: Spacing.two, paddingBottom: Spacing.one },
  listing: { borderRadius: Spacing.three, padding: Spacing.three, gap: Spacing.two },
  listingMain: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.two },
  listingText: { flex: 1, gap: Spacing.half },
  checkbox: { width: 22, height: 22, borderRadius: 6, borderWidth: 1.5, borderColor: '#8B939C', alignItems: 'center', justifyContent: 'center' },
  checked: { backgroundColor: '#198754', borderColor: '#198754' },
  checkmark: { color: '#ffffff' },
  listingLink: { alignSelf: 'flex-start', paddingVertical: Spacing.half },
  footer: { flexDirection: 'row', alignItems: 'stretch', gap: Spacing.two },
  buttonPress: { flexShrink: 1 },
  button: { alignItems: 'center', justifyContent: 'center', paddingVertical: Spacing.two + Spacing.half, paddingHorizontal: Spacing.three, borderRadius: Spacing.three, minHeight: 42 },
  compactButton: { paddingHorizontal: Spacing.two },
  buttonText: { textAlign: 'center' },
  dimmed: { opacity: 0.5 },
  error: { color: '#E5484D' },
  result: { gap: Spacing.three, paddingVertical: Spacing.four },
});
