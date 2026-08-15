/// Google Cloud OAuth istemci kimlikleri.
///
/// Android’de google_sign_in 7+ **zorunlu** olarak Web istemci kimliğini
/// `serverClientId` ister. Boşsa Drive girişi başlamadan hata verilir.
///
/// Kurulum: [GOOGLE_DRIVE.md]
///
/// Derleme:
///   flutter build apk --release \
///     --dart-define=GOOGLE_SERVER_CLIENT_ID=xxxxx.apps.googleusercontent.com
///
/// CI: repo secret `GOOGLE_SERVER_CLIENT_ID`
const googleOAuthServerClientId = String.fromEnvironment(
  'GOOGLE_SERVER_CLIENT_ID',
  defaultValue: '',
);

const googleOAuthClientId = String.fromEnvironment(
  'GOOGLE_CLIENT_ID',
  defaultValue: '',
);

bool get hasGoogleServerClientId => googleOAuthServerClientId.trim().isNotEmpty;

const googleDriveConfigHelp =
    'Google Drive için Web OAuth istemci kimliği (serverClientId) gerekli. '
    'Google Cloud → Kimlik bilgileri → “Web uygulaması” oluşturun; '
    'kimliği GitHub secret GOOGLE_SERVER_CLIENT_ID olarak ekleyip APK’yı '
    'yeniden yayınlayın. Ayrıntı: GOOGLE_DRIVE.md';
