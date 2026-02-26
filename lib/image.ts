import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';

export type ReceiptFile = {
  uri: string;
  type: 'image' | 'pdf' | 'text';
  name?: string;
};

async function ensurePermission() {
  const camera = await ImagePicker.requestCameraPermissionsAsync();
  const library = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!camera.granted && !library.granted) {
    throw new Error('Camera or media permission denied.');
  }
}

async function compressImageForAI(uri: string): Promise<string> {
  const qualities = [0.55, 0.42, 0.32];
  const widths = [1280, 1080, 900];

  for (let i = 0; i < qualities.length; i += 1) {
    const result = await manipulateAsync(
      uri,
      [{ resize: { width: widths[i] } }],
      {
        compress: qualities[i],
        format: SaveFormat.JPEG,
        base64: true,
      },
    );

    if (result.base64) {
      const approxBytes = Math.floor(result.base64.length * 0.75);
      if (approxBytes <= 1_350_000) {
        return `data:image/jpeg;base64,${result.base64}`;
      }
    }
  }

  const last = await manipulateAsync(
    uri,
    [{ resize: { width: 760 } }],
    {
      compress: 0.24,
      format: SaveFormat.JPEG,
      base64: true,
    },
  );

  if (!last.base64) {
    throw new Error('Could not compress image for upload.');
  }
  return `data:image/jpeg;base64,${last.base64}`;
}

export async function takeReceiptPhoto(): Promise<ReceiptFile | null> {
  await ensurePermission();
  const result = await ImagePicker.launchCameraAsync({
    cameraType: ImagePicker.CameraType.back,
    allowsEditing: true,
    quality: 0.35,
    aspect: [3, 4],
    base64: true,
  });

  if (result.canceled || !result.assets[0]?.uri) return null;
  const asset = result.assets[0];
  const compressedUri = await compressImageForAI(asset.uri);
  return { uri: compressedUri, type: 'image', name: 'camera-receipt.jpg' };
}

export async function uploadReceiptImage(): Promise<ReceiptFile | null> {
  await ensurePermission();
  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images'],
    allowsEditing: true,
    quality: 0.35,
    aspect: [3, 4],
  });

  if (result.canceled || !result.assets[0]?.uri) return null;
  const compressedUri = await compressImageForAI(result.assets[0].uri);
  return {
    uri: compressedUri,
    type: 'image',
    name: result.assets[0].fileName ?? 'receipt-image.jpg',
  };
}

export async function pickReceiptFile(): Promise<ReceiptFile | null> {
  const result = await DocumentPicker.getDocumentAsync({
    multiple: false,
    type: ['application/pdf', 'image/*', 'text/plain'],
    copyToCacheDirectory: true,
  });

  if (result.canceled || !result.assets[0]?.uri) return null;
  const asset = result.assets[0];
  const isPdf = asset.mimeType === 'application/pdf' || asset.name?.toLowerCase().endsWith('.pdf');
  const isText = asset.mimeType === 'text/plain' || asset.name?.toLowerCase().endsWith('.txt');
  const type: ReceiptFile['type'] = isPdf ? 'pdf' : isText ? 'text' : 'image';

  return {
    uri: type === 'image' ? await compressImageForAI(asset.uri) : asset.uri,
    type,
    name: asset.name,
  };
}
