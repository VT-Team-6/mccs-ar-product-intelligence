import { CameraView, scanFromURLAsync, useCameraPermissions } from "expo-camera";
import { useRouter, type Href } from "expo-router";
import { SymbolView } from "expo-symbols";
import { useRef, useState } from "react";
import {
  ActivityIndicator,
  Linking,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Brand, Radius, Spacing } from "@/constants/theme";
import { lookUpScannedCode } from "@/utils/scanned-product";

// Dark sheet and overlay colors stay the same in light and dark mode, like a
// camera app: the camera is always the background.
const SHEET = "#1C1D20";
const SHADE = "rgba(0,0,0,0.55)";

// The full-screen QR scanner, opened from the Home search bar. It scans on its
// own as soon as a QR code is inside the square. The round button is a backup:
// it takes a photo and reads the code from that instead.
export default function ScanScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const [permission, requestPermission] = useCameraPermissions();
  const camera = useRef<CameraView>(null);

  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  // Ignores further detections while one is being looked up
  const handling = useRef(false);

  const square = Math.min(width * 0.7, 280);
  // The square sits a little above the middle, clear of the sheet below
  const squareTop = Math.max(insets.top + Spacing.six, (height - square) / 2 - 80);

  const close = () => (router.canGoBack() ? router.back() : router.replace("/"));

  const open = async (code: string) => {
    if (handling.current) return;
    handling.current = true;
    setBusy(true);
    setProblem(null);
    const result = await lookUpScannedCode(code);
    if (result.ok) {
      // Replace the scanner, so Back from the product returns to Home
      router.replace(`/product/${result.productId}?from=/` as Href);
      return;
    }
    setProblem(result.message);
    setBusy(false);
    // A short pause so the same unknown code isn't looked up again straight away
    setTimeout(() => {
      handling.current = false;
    }, 1500);
  };

  // Backup for when scanning on its own doesn't catch the code
  const scanFromPhoto = async () => {
    if (handling.current || !camera.current) return;
    setProblem(null);
    setBusy(true);
    try {
      const photo = await camera.current.takePictureAsync({ quality: 0.6 });
      const found = await scanFromURLAsync(photo.uri, ["qr"]);
      if (found.length > 0) {
        setBusy(false);
        await open(found[0].data);
        return;
      }
      setProblem("No QR code found. Fit the code inside the square and hold steady.");
    } catch {
      setProblem("Couldn't take a photo. Try again.");
    }
    setBusy(false);
  };

  const granted = permission?.granted === true;

  return (
    <View style={styles.screen}>
      {granted && (
        <CameraView
          ref={camera}
          style={StyleSheet.absoluteFill}
          facing="back"
          barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
          onBarcodeScanned={busy ? undefined : ({ data }) => void open(data)}
        />
      )}

      {/* Darkens everything around the square */}
      <View pointerEvents="none" style={StyleSheet.absoluteFill}>
        <View style={[styles.shade, { height: squareTop }]} />
        <View style={{ flexDirection: "row", height: square }}>
          <View style={styles.shadeFill} />
          <View style={[styles.square, { width: square, height: square }]} />
          <View style={styles.shadeFill} />
        </View>
        <View style={styles.shadeFill} />
      </View>

      {/* The round scan button, above the sheet */}
      {granted && (
        <View style={styles.shutterRow} pointerEvents="box-none">
          <Pressable
            onPress={scanFromPhoto}
            disabled={busy}
            accessibilityRole="button"
            accessibilityLabel="Scan the QR code"
            style={({ pressed }) => [styles.shutter, (pressed || busy) && styles.shutterPressed]}
          >
            {busy ? (
              <ActivityIndicator color={Brand.red} />
            ) : (
              <SymbolView
                name={{ ios: "qrcode.viewfinder", android: "qr_code_scanner", web: "qr_code_scanner" }}
                size={34}
                tintColor={Brand.red}
              />
            )}
          </Pressable>
        </View>
      )}

      {/* Instructions sheet */}
      <View style={[styles.sheet, { paddingBottom: insets.bottom + Spacing.four }]}>
        <View style={styles.sheetTop}>
          <Text style={styles.sheetTitle}>Scan QR code</Text>
          <Pressable
            onPress={close}
            accessibilityRole="button"
            accessibilityLabel="Close the scanner"
            hitSlop={8}
            style={({ pressed }) => [styles.close, pressed && styles.closePressed]}
          >
            <SymbolView name={{ ios: "xmark", android: "close", web: "close" }} size={20} tintColor="#ffffff" />
          </Pressable>
        </View>

        {!permission ? (
          <Text style={styles.sheetText}>Starting the camera…</Text>
        ) : !granted ? (
          <>
            <Text style={styles.sheetText}>
              {permission.canAskAgain
                ? "Allow camera access to scan product QR codes."
                : "Camera access is turned off. Turn it on in Settings to scan product QR codes."}
            </Text>
            <Pressable
              onPress={() => (permission.canAskAgain ? requestPermission() : Linking.openSettings())}
              style={({ pressed }) => [styles.allow, pressed && styles.closePressed]}
            >
              <Text style={styles.allowText}>{permission.canAskAgain ? "Allow camera" : "Open Settings"}</Text>
            </Pressable>
          </>
        ) : busy ? (
          <Text style={styles.sheetText}>Finding the product…</Text>
        ) : problem ? (
          <Text style={[styles.sheetText, styles.problem]}>{problem}</Text>
        ) : (
          <Text style={styles.sheetText}>
            Point your camera at a product's QR code. It scans on its own, or tap the button.
          </Text>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: "#000000",
  },
  shade: {
    backgroundColor: SHADE,
  },
  shadeFill: {
    flex: 1,
    backgroundColor: SHADE,
  },
  square: {
    borderWidth: 4,
    borderColor: "#ffffff",
    borderRadius: Radius.medium + 4,
  },
  shutterRow: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 190,
    alignItems: "center",
  },
  shutter: {
    width: 76,
    height: 76,
    borderRadius: 38,
    backgroundColor: "#ffffff",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 4,
    borderColor: "rgba(255,255,255,0.45)",
    shadowColor: "#000",
    shadowOpacity: 0.3,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
  shutterPressed: {
    opacity: 0.75,
    transform: [{ scale: 0.95 }],
  },
  sheet: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: SHEET,
    borderTopLeftRadius: Radius.medium + 8,
    borderTopRightRadius: Radius.medium + 8,
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.four,
    gap: Spacing.two,
  },
  sheetTop: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  sheetTitle: {
    color: "#ffffff",
    fontSize: 22,
    lineHeight: 28,
    fontWeight: "800",
  },
  sheetText: {
    color: "rgba(255,255,255,0.85)",
    fontSize: 15,
    lineHeight: 21,
  },
  problem: {
    color: "#FF8A8A",
  },
  close: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "rgba(255,255,255,0.12)",
    alignItems: "center",
    justifyContent: "center",
  },
  closePressed: {
    opacity: 0.6,
  },
  allow: {
    alignSelf: "flex-start",
    marginTop: Spacing.one,
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.four,
    borderRadius: Radius.pill,
    backgroundColor: Brand.red,
  },
  allowText: {
    color: "#ffffff",
    fontSize: 15,
    fontWeight: "700",
  },
});
