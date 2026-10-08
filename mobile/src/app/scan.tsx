import { Linking, Pressable, StyleSheet, View } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { BottomTabInset, Spacing } from '@/constants/theme';

export default function ScanScreen() {
  const [permission, requestPermission] = useCameraPermissions();

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea} edges={['top']}>
        {/* Top header */}
        <View style={styles.header}>
          <ThemedText style={styles.logoText}>MCCS</ThemedText>

          <View style={styles.signedInBadge}>
            <ThemedText style={styles.signedInText}>SIGNED IN</ThemedText>
          </View>
        </View>

        {/* Main content */}
        <View style={styles.content}>
          <View>
            <ThemedText style={styles.title}>Scan a product</ThemedText>

            <ThemedText style={styles.subtitle}>
              Point your camera at a barcode or QR code
            </ThemedText>
          </View>

          {/* Camera */}
          <View style={styles.cameraContainer}>
            {!permission ? (
              <View style={styles.permissionPlaceholder}>
                <ThemedText style={styles.permissionText}>
                  Loading camera...
                </ThemedText>
              </View>
            ) : permission.granted ? (
                <CameraView
                  style={styles.camera}
                  facing="back"
                />
            ) : permission.canAskAgain ? (
              <View style={styles.permissionPlaceholder}>
                <ThemedText style={styles.permissionTitle}>
                  Camera access required
                </ThemedText>

                <ThemedText style={styles.permissionDescription}>
                  Allow camera access so you can scan product QR codes.
                </ThemedText>

                <Pressable
                  style={styles.permissionButton}
                onPress={requestPermission}
                >
                  <ThemedText style={styles.permissionButtonText}>
                    Enable camera
                  </ThemedText>
                </Pressable>
              </View>
            ) : (
              <View style={styles.permissionPlaceholder}>
                <ThemedText style={styles.permissionTitle}>
                  Camera permission denied
                </ThemedText>

                <ThemedText style={styles.permissionDescription}>
                  Camera access is disabled. Enable it in your device settings to scan products.
                </ThemedText>

                <Pressable
                  style={styles.permissionButton}
                  onPress={() => Linking.openSettings()}
                >
                  <ThemedText style={styles.permissionButtonText}>
                    Open settings
                  </ThemedText>
                </Pressable>
              </View>
            )}
          </View>

          <ThemedText style={styles.scanHint}>
            Align the barcode within the frame
          </ThemedText>
        </View>

        {/* Actions */}
        <View style={styles.actions}>
          <Pressable style={styles.primaryButton}>
            <ThemedText style={styles.primaryButtonText}>
              Scan product
            </ThemedText>
          </Pressable>

          <Pressable style={styles.secondaryButton}>
            <ThemedText style={styles.secondaryButtonText}>
              Enter product manually
            </ThemedText>
          </Pressable>
        </View>
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F7F7F5',
  },

  safeArea: {
    flex: 1,
    paddingBottom: BottomTabInset,
  },

  header: {
    height: 54,
    backgroundColor: '#FFFFFF',
    borderBottomWidth: 1,
    borderBottomColor: '#E5E5E5',
    paddingHorizontal: Spacing.four,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },

  logoText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#000000',
  },

  signedInBadge: {
    backgroundColor: '#EAEAEA',
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },

  signedInText: {
    fontSize: 10,
    fontWeight: '600',
  },

  content: {
    flex: 1,
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.four,
  },

  title: {
    fontSize: 22,
    fontWeight: '700',
    marginBottom: 4,
    color: '#000000',
  },

  subtitle: {
    fontSize: 13,
    color: '#000000',
    opacity: 0.6,
    marginBottom: Spacing.four,
  },

  cameraContainer: {
    flex: 1,
    backgroundColor: '#E8E8E6',
    borderRadius: 6,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },

  camera: {
    width: '100%',
    height: '100%',
  },

  permissionPlaceholder: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },

  permissionText: {
    fontSize: 13,
    color: '#000000',
  },

  permissionTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#000000',
    textAlign: 'center',
  },

  permissionDescription: {
    fontSize: 13,
    color: '#000000',
    textAlign: 'center',
    maxWidth: 260,
    lineHeight: 19,
  },

  permissionButton: {
    backgroundColor: '#171411',
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 7,
  },

  permissionButtonText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '700',
  },

  scanHint: {
    fontSize: 12,
    textAlign: 'center',
    color: '#000000',
    opacity: 0.55,
    marginTop: 12,
    marginBottom: 18,
  },

  actions: {
    backgroundColor: '#FFFFFF',
    borderTopWidth: 1,
    borderTopColor: '#E5E5E5',
    paddingHorizontal: Spacing.four,
    paddingTop: 12,
    paddingBottom: Spacing.three,
    gap: 8,
  },

  primaryButton: {
    height: 48,
    backgroundColor: '#171411',
    borderRadius: 7,
    alignItems: 'center',
    justifyContent: 'center',
  },

  primaryButtonText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '700',
  },

  secondaryButton: {
    height: 48,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#BDBDBD',
    borderRadius: 7,
    alignItems: 'center',
    justifyContent: 'center',
  },

  secondaryButtonText: {
    color: '#171411',
    fontSize: 15,
    fontWeight: '700',
  },
});