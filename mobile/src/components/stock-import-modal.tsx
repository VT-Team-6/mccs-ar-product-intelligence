import { useEffect, useState } from "react";
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet } from "react-native";

import { applyStockImport, previewStockImport, type StockImportResult } from "@/api/inventory";
import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";
import { Spacing } from "@/constants/theme";
import { VariantLines } from '@/components/variant-lines';

type Props = {
  storeId: number;
  storeName: string;
  // The picked file's text. The popup is open while this is set.
  csv: string | null;
  onClose: () => void;
  onImported: () => void;
};

// Shows what an end-of-day stock file will change before anything is saved,
// then saves it all at once when confirmed.
export function StockImportModal({ storeId, storeName, csv, onClose, onImported }: Props) {
  const [preview, setPreview] = useState<StockImportResult | null>(null);
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (csv === null) return;
    let cancelled = false;
    setPreview(null);
    setDone(false);
    setError(null);
    previewStockImport(storeId, csv)
      .then((result) => !cancelled && setPreview(result))
      .catch((problem: Error) => !cancelled && setError(problem.message));
    return () => {
      cancelled = true;
    };
  }, [csv, storeId]);

  async function confirm() {
    if (csv === null) return;
    setSaving(true);
    setError(null);
    try {
      await applyStockImport(storeId, csv);
      setDone(true);
      onImported();
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : "Could not import the stock.");
    } finally {
      setSaving(false);
    }
  }

  const changes = preview?.changes ?? [];
  const errors = preview?.errors ?? [];
  const canSave = preview !== null && errors.length === 0 && changes.length > 0 && !done;

  let summary = "";
  if (done) summary = `Updated stock for ${changes.length} product${changes.length === 1 ? "" : "s"}.`;
  else if (errors.length > 0)
    summary = `${errors.length} row${errors.length === 1 ? " has a problem" : "s have problems"}. Fix the file and import it again. Nothing has been saved.`;
  else if (preview && changes.length === 0) summary = "Nothing to change. Every stock matches the app.";
  else if (preview)
    summary = `${changes.length} product${changes.length === 1 ? "" : "s"} will change. ${preview.unchanged} stay the same.`;
  if (preview && errors.length === 0 && preview.low_after > 0)
    summary += ` ${preview.low_after} will ${done ? "now be" : "become"} low on stock${done ? ", and managers have been messaged" : ""}.`;

  return (
    <Modal visible={csv !== null} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        {/* The empty onPress stops taps on the card from closing the popup */}
        <Pressable onPress={() => {}}>
          <ThemedView style={styles.card}>
            <ThemedText type="smallBold">Import stock for {storeName}</ThemedText>

            {!preview && !error && <ActivityIndicator />}
            {summary !== "" && <ThemedText type="small">{summary}</ThemedText>}

            {(errors.length > 0 || changes.length > 0) && (
              <ScrollView style={styles.list} contentContainerStyle={styles.listContent}>
                {errors.map((problem) => (
                  <ThemedText key={`e${problem.row}`} type="small" themeColor="danger" style={styles.error}>
                    Row {problem.row}: {problem.message}
                  </ThemedText>
                ))}
                {errors.length === 0 &&
                  changes.map((change) => (
                    <ThemedView key={change.variant_id ?? change.product_id} type="backgroundElement" style={styles.row}>
                      <ThemedView type="backgroundElement" style={styles.rowText}>
                        <ThemedText type="smallBold">{change.name}</ThemedText>
                        <VariantLines color={change.color} size={change.size} />
                        <ThemedText type="small" themeColor="textSecondary">
                          {[change.brand, `ID ${change.product_id}`].filter(Boolean).join(" · ")}
                        </ThemedText>
                      </ThemedView>
                      <ThemedText type="smallBold">
                        {change.old_quantity} → {change.new_quantity}
                      </ThemedText>
                    </ThemedView>
                  ))}
              </ScrollView>
            )}

            {error && (
              <ThemedText type="small" themeColor="danger" style={styles.error}>
                {error}
              </ThemedText>
            )}

            {canSave && (
              <Pressable
                onPress={confirm}
                disabled={saving}
                style={({ pressed }) => [styles.button, (pressed || saving) && styles.pressed]}>
                <ThemedView type="backgroundSelected" style={styles.buttonView}>
                  <ThemedText type="smallBold">{saving ? "Saving…" : "Confirm import"}</ThemedText>
                </ThemedView>
              </Pressable>
            )}
            <Pressable onPress={onClose} style={({ pressed }) => [styles.button, pressed && styles.pressed]}>
              <ThemedView type="backgroundElement" style={styles.buttonView}>
                <ThemedText type="small">{done ? "Done" : "Cancel"}</ThemedText>
              </ThemedView>
            </Pressable>
          </ThemedView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0, 0, 0, 0.5)",
    alignItems: "center",
    justifyContent: "center",
    padding: Spacing.four,
  },
  card: {
    width: 380,
    maxWidth: "100%",
    borderRadius: Spacing.four,
    padding: Spacing.four,
    gap: Spacing.three,
  },
  list: {
    maxHeight: 360,
  },
  listContent: {
    gap: Spacing.two,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.two,
    padding: Spacing.three,
    borderRadius: Spacing.three,
  },
  rowText: {
    flex: 1,
    gap: Spacing.half,
  },
  error: {
  },
  button: {
    alignSelf: "stretch",
  },
  buttonView: {
    alignItems: "center",
    paddingVertical: Spacing.two + Spacing.half,
    borderRadius: Spacing.three,
  },
  pressed: {
    opacity: 0.4,
  },
});
