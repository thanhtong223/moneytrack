import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';

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

export async function takeReceiptPhoto(): Promise<ReceiptFile | null> {
  await ensurePermission();
  const result = await ImagePicker.launchCameraAsync({
    cameraType: ImagePicker.CameraType.back,
    allowsEditing: true,
    quality: 0.8,
  });

  if (result.canceled || !result.assets[0]?.uri) return null;
  return { uri: result.assets[0].uri, type: 'image', name: 'camera-receipt.jpg' };
}

export async function uploadReceiptImage(): Promise<ReceiptFile | null> {
  await ensurePermission();
  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images'],
    allowsEditing: true,
    quality: 0.8,
  });

  if (result.canceled || !result.assets[0]?.uri) return null;
  return {
    uri: result.assets[0].uri,
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

  return {
    uri: asset.uri,
    type: isPdf ? 'pdf' : isText ? 'text' : 'image',
    name: asset.name,
  };
}
