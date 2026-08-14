/// Google Cloud OAuth istemci kimlikleri.
///
/// Kurulum:
/// 1. https://console.cloud.google.com/ → proje oluştur
/// 2. "Google Drive API" etkinleştir
/// 3. OAuth izin ekranı (External) + test kullanıcısı ekle
/// 4. Kimlik bilgileri:
///    - Android: paket `com.medyaatlas.medyaatlas_mobile` + debug/release SHA-1
///    - Web uygulaması istemcisi → [googleOAuthServerClientId]
///
/// Derleme örneği:
///   flutter build apk --dart-define=GOOGLE_SERVER_CLIENT_ID=xxxxx.apps.googleusercontent.com
///
/// Boş bırakılırsa Sign-In yine denenir (Android’de bazen yeterli);
/// ApiException 10 alırsan SHA-1 + server client ID eksik demektir.
const googleOAuthServerClientId = String.fromEnvironment(
  'GOOGLE_SERVER_CLIENT_ID',
  defaultValue: '',
);

const googleOAuthClientId = String.fromEnvironment(
  'GOOGLE_CLIENT_ID',
  defaultValue: '',
);
