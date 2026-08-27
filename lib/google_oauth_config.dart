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

/// Kullanıcıya gösterilen kısa yardım (Drive ≠ Google Fotoğraflar).
const googleDriveConfigHelp =
    'Google Drive girişi için OAuth kimliği eksik (APK’da yok). '
    'Bu Google Fotoğraflar değil — drive.google.com dosyaları. '
    'Telefondaki Google Foto medyası için: Kaynaklar → Tüm telefon. '
    'Drive dosyaları için: Google Cloud’da Web OAuth istemcisi oluşturup '
    'GitHub secret GOOGLE_SERVER_CLIENT_ID ekleyin, APK’yı yeniden yayınlayın. '
    'Ayrıntı: GOOGLE_DRIVE.md';

const googleDriveNotPhotosHint =
    'Google Drive ≠ Google Fotoğraflar. '
    'Fotoğraflar uygulamasındaki medya genelde telefonda; «Tüm telefon» ile alın. '
    'Drive yalnızca drive.google.com’daki dosyalar içindir.';
