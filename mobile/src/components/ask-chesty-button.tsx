import { Image, Pressable, StyleSheet } from "react-native";

import { ThemedText } from "@/components/themed-text";
import { Brand, Radius, Spacing } from "@/constants/theme";

export function AskChestyButton({ onPress }: { onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Ask Chesty"
      hitSlop={6}
      onPress={onPress}
      style={({ pressed }) => [styles.pill, pressed && styles.pressed]}
    >
      <ThemedText type="smallBold" style={styles.label}>Ask</ThemedText>
      <Image
        source={require("@/assets/images/chesty.png")}
        style={styles.image}
        resizeMode="contain"
      />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  pill: {
    minHeight: 38,
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.half,
    paddingLeft: Spacing.two,
    paddingRight: Spacing.half,
    borderRadius: Radius.pill,
    backgroundColor: Brand.navy,
  },
  image: {
    width: 28,
    height: 28,
  },
  label: {
    color: "#ffffff",
  },
  pressed: {
    opacity: 0.7,
  },
});
