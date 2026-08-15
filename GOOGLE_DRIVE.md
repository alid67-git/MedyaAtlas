# Google Drive bağlantısı (MedyaAtlas)

Uygulamada **Kaynaklar → + Google Drive** ile Google hesabına giriş yapılır;
Drive’daki foto/videolar listelenir. Konumlu fotoğraflarda Drive’ın
`imageMediaMetadata` konumu kullanılır (dosyanın tamamı indirilmez).

## Neden `serverClientId` hatası?

Android’de Google Sign-In **Web uygulaması** OAuth istemci kimliğini ister.
Bu kimlik APK’ya `--dart-define=GOOGLE_SERVER_CLIENT_ID=...` ile gömülür.
GitHub Actions’ta secret yoksa yayınlanan APK’da Drive girişi çalışmaz.

## Google Cloud kurulumu (zorunlu)

1. [Google Cloud Console](https://console.cloud.google.com/) → proje oluştur  
2. **API’ler** → **Google Drive API** → Etkinleştir  
3. **OAuth izin ekranı** → External → test kullanıcısı olarak kendi Gmail’ini ekle  
4. **Kimlik bilgileri** → OAuth istemci kimliği oluştur:

### A) Web uygulaması (zorunlu — serverClientId)

- Tür: **Web uygulaması**  
- İstemci kimliğini kopyala (`….apps.googleusercontent.com`)  
- Bunu APK derlemesine ver (aşağıda)

### B) Android (SHA-1)

- Paket adı: `com.medyaatlas.medyaatlas_mobile`  
- SHA-1: debug ve/veya release keystore

### Debug SHA-1 (Windows)

```bat
keytool -list -v -alias androiddebugkey -keystore %USERPROFILE%\.android\debug.keystore -storepass android -keypass android
```

Release APK (GitHub Actions) için CI’nın kullandığı keystore SHA-1’i de ekleyin.
Şu an sideload release genelde debug imza kullanıyorsa debug SHA-1 yeter.

## Web istemci kimliğini APK’ya koyma

### GitHub Release (önerilen)

1. Repo → **Settings → Secrets and variables → Actions**  
2. Secret adı: `GOOGLE_SERVER_CLIENT_ID`  
3. Değer: Web istemci kimliği (`….apps.googleusercontent.com`)  
4. Yeni tag / release tetikle (veya workflow_dispatch)

### Yerel derleme

```bat
flutter build apk --release --dart-define=GOOGLE_SERVER_CLIENT_ID=123456789-xxxx.apps.googleusercontent.com
```

## Kullanım

1. MedyaAtlas’ta **+ Google Drive**  
2. Google hesabı seç → Drive izni ver  
3. Tarama biter → GPS’li fotoğraflar haritada  

**Not:** Google Fotoğraflar “bulut albümü” ayrı üründür; bu bağlantı **Google Drive dosyaları** içindir. Fotoğrafları Drive’a yedeklediysen veya Drive’da tutuyorsan görünür.
