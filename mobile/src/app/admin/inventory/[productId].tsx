import { useLocalSearchParams, useRouter } from "expo-router";
import { useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { approveEntry, removeEntry, updateStock, type InventoryStatus } from "@/api/inventory";
import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";
import { MaxContentWidth, Spacing } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";

// A price like 89 or 89.99: no negatives, at most two decimals
const PRICE = /^\d+(\.\d{1,2})?$/;
const WHOLE_NUMBER = /^\d+$/;

// Edit one product's price, stock and status at one store, e.g.
// /admin/inventory/12?storeId=3. Pending products are approved or declined here.
export default function EditStockScreen() {
  const params = useLocalSearchParams<{
    productId: string;
    storeId: string;
    storeName?: string;
    name?: string;
    price?: string;
    quantity?: string;
    status?: InventoryStatus;
  }>();
  const router = useRouter();
  const theme = useTheme();

  const productId = Number(params.productId);
  const storeId = Number(params.storeId);
  const pending = params.status === "pending";

  const [price, setPrice] = useState(params.price ?? "");
  const [quantity, setQuantity] = useState(params.quantity ?? "0");
  const [status, setStatus] = useState<InventoryStatus>(
    params.status === "discontinued" ? "discontinued" : "active",
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const goBack = () => (router.canGoBack() ? router.back() : router.replace("/admin/inventory"));

  // The typed values as numbers, or null (with a message) when one isn't valid
  const readValues = (): { price: number; quantity: number } | null => {
    if (!PRICE.test(price.trim())) {
      setError("Enter a price like 89 or 89.99.");
      return null;
    }
    if (!WHOLE_NUMBER.test(quantity.trim())) {
      setError("Quantity must be a whole number, 0 or more.");
      return null;
    }
    return { price: Number(price.trim()), quantity: Number(quantity.trim()) };
  };

  // Sends a change, then goes back to the list, which reloads itself
  const run = async (action: () => Promise<unknown>) => {
    setSaving(true);
    setError(null);
    try {
      await action();
      goBack();
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : "Something went wrong. Try again.");
      setSaving(false);
    }
  };

  const save = () => {
    const values = readValues();
    if (values) run(() => updateStock(productId, storeId, { ...values, status }));
  };

  const approve = () => {
    const values = readValues();
    if (values) run(() => approveEntry(productId, storeId, values));
  };

  const decline = () =>
    Alert.alert(
      "Decline this product?",
      `${params.name || "It"} will be removed from this store's pending list.`,
      [
        { text: "Cancel", style: "cancel" },
        { text: "Decline", style: "destructive", onPress: () => run(() => removeEntry(productId, storeId)) },
      ],
    );

  const inputStyle = [styles.input, { color: theme.text, backgroundColor: theme.backgroundElement }];

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <Pressable onPress={goBack} hitSlop={12} style={({ pressed }) => pressed && styles.pressed}>
            <ThemedText type="linkPrimary">‹ Cancel</ThemedText>
          </Pressable>

          <View style={styles.section}>
            <ThemedText type="subtitle">{params.name || `Product ${productId}`}</ThemedText>
            <ThemedText themeColor="textSecondary">
              {pending
                ? `Waiting for approval at ${params.storeName || "this store"}. Set the price and stock to start selling it.`
                : `At ${params.storeName || "this store"}`}
            </ThemedText>
          </View>

          <View style={styles.field}>
            <ThemedText type="smallBold">Price ($)</ThemedText>
            <TextInput
              value={price}
              onChangeText={setPrice}
              placeholder="89.99"
              placeholderTextColor={theme.textSecondary}
              keyboardType="decimal-pad"
              style={inputStyle}
            />
          </View>

          <View style={styles.field}>
            <ThemedText type="smallBold">Quantity in stock</ThemedText>
            <TextInput
              value={quantity}
              onChangeText={setQuantity}
              placeholder="0"
              placeholderTextColor={theme.textSecondary}
              keyboardType="number-pad"
              style={inputStyle}
            />
          </View>

          {!pending && (
            <View style={styles.field}>
              <ThemedText type="smallBold">Status</ThemedText>
              <View style={styles.choices}>
                {(["active", "discontinued"] as const).map((choice) => (
                  <Pressable
                    key={choice}
                    onPress={() => setStatus(choice)}
                    style={({ pressed }) => [styles.choicePress, pressed && styles.pressed]}
                  >
                    <ThemedView
                      type={choice === status ? "backgroundSelected" : "backgroundElement"}
                      style={styles.choice}
                    >
                      <ThemedText type={choice === status ? "smallBold" : "small"}>
                        {choice === "active" ? "For sale" : "Discontinued"}
                      </ThemedText>
                    </ThemedView>
                  </Pressable>
                ))}
              </View>
              {status === "discontinued" && (
                <ThemedText type="small" themeColor="textSecondary">
                  Shoppers won't find it in search, and scanning it shows that it's discontinued here.
                </ThemedText>
              )}
            </View>
          )}

          {error && <ThemedText themeColor="textSecondary">{error}</ThemedText>}

          {saving ? (
            <ActivityIndicator />
          ) : pending ? (
            <View style={styles.actions}>
              <Button label="Approve" onPress={approve} />
              <Button label="Decline" onPress={decline} quiet />
            </View>
          ) : (
            <Button label="Save changes" onPress={save} />
          )}
        </ScrollView>
      </SafeAreaView>
    </ThemedView>
  );
}

function Button({ label, onPress, quiet = false }: { label: string; onPress: () => void; quiet?: boolean }) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => pressed && styles.pressed}>
      <ThemedView type={quiet ? "backgroundElement" : "backgroundSelected"} style={styles.button}>
        <ThemedText type="smallBold">{label}</ThemedText>
      </ThemedView>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: "center",
    flexDirection: "row",
  },
  safeArea: {
    flex: 1,
    paddingHorizontal: Spacing.three,
    paddingTop: Platform.OS === "web" ? Spacing.six + Spacing.four : Spacing.three,
    maxWidth: MaxContentWidth,
  },
  content: {
    gap: Spacing.three,
    paddingBottom: Spacing.six,
  },
  section: {
    gap: Spacing.one,
  },
  field: {
    gap: Spacing.one,
  },
  input: {
    fontSize: 16,
    paddingVertical: Spacing.two + Spacing.half,
    paddingHorizontal: Spacing.three,
    borderRadius: Spacing.three,
  },
  choices: {
    flexDirection: "row",
    gap: Spacing.two,
  },
  choicePress: {
    flex: 1,
  },
  choice: {
    alignItems: "center",
    paddingVertical: Spacing.two,
    borderRadius: Spacing.three,
  },
  actions: {
    gap: Spacing.two,
  },
  button: {
    alignItems: "center",
    paddingVertical: Spacing.three,
    borderRadius: Spacing.three,
  },
  pressed: {
    opacity: 0.6,
  },
});