# Google Drive bağlantısı (MedyaAtlas)

Uygulamada **Kaynaklar → + Google Drive** ile Google hesabına giriş yapılır;
Drive’daki foto/videolar listelenir. Konumlu fotoğraflarda Drive’ın
`imageMediaMetadata` konumu kullanılır (dosyanın tamamı indirilmez).

## Google Cloud kurulumu (zorunlu)

1. [Google Cloud Console](https://console.cloud.google.com/) → proje oluştur  
2. **API’ler** → **Google Drive API** → Etkinleştir  
3. **OAuth izin ekranı** → External → test kullanıcısı olarak kendi Gmail’ini ekle  
4. **Kimlik bilgileri** → OAuth istemci kimliği oluştur:
   - **Android**  
     - Paket adı: `com.medyaatlas.medyaatlas_mobile`  
     - SHA-1: debug/release keystore  
   - **Web uygulaması** (önerilir, `serverClientId` için)

### Debug SHA-1 (Windows)

```bat
keytool -list -v -alias androiddebugkey -keystore %USERPROFILE%\.android\debug.keystore -storepass android -keypass android
```

SHA-1 satırını Android OAuth istemcisine yapıştır.

### APK derlerken server client ID

```bat
flutter build apk --release --dart-define=GOOGLE_SERVER_CLIENT_ID=123456789-xxxx.apps.googleusercontent.com
```

veya `lib/google_oauth_config.dart` / CI’da aynı `--dart-define`.

## Kullanım

1. MedyaAtlas’ta **+ Google Drive**  
2. Google hesabı seç → Drive izni ver  
3. Tarama biter → GPS’li fotoğraflar haritada  

**Not:** Google Fotoğraflar “bulut albümü” ayrı üründür; bu bağlantı **Google Drive dosyaları** içindir. Fotoğrafları Drive’a yedeklediysen veya Drive’da tutuyorsan görünür.
