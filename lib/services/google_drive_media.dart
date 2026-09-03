import 'dart:async';
import 'dart:typed_data';

import 'package:googleapis/drive/v3.dart' as drive;
import 'package:googleapis_auth/googleapis_auth.dart' as auth;
import 'package:google_sign_in/google_sign_in.dart';
import 'package:http/http.dart' as http;

import '../google_oauth_config.dart';
import 'folder_types.dart';
import 'host_platform.dart';

const _driveScopes = <String>[drive.DriveApi.driveReadonlyScope];

var _signInReady = false;

Future<void> _ensureSignInInitialized() async {
  if (_signInReady) return;
  if (hostIsAndroid && !hasGoogleServerClientId) {
    throw StateError(googleDriveConfigHelp);
  }
  await GoogleSignIn.instance.initialize(
    clientId: googleOAuthClientId.isEmpty ? null : googleOAuthClientId,
    serverClientId:
        googleOAuthServerClientId.isEmpty ? null : googleOAuthServerClientId,
  );
  _signInReady = true;
}

class GoogleDriveSession {
  GoogleDriveSession({
    required this.email,
    required this.api,
    required http.Client client,
  }) : _client = client;

  final String email;
  final drive.DriveApi api;
  final http.Client _client;

  void close() => _client.close();
}

/// Google hesabı ile Drive’a bağlan (salt okunur).
Future<GoogleDriveSession> connectGoogleDrive() async {
  await _ensureSignInInitialized();
  final account = await GoogleSignIn.instance.authenticate(
    scopeHint: _driveScopes,
  );
  final authz = await account.authorizationClient.authorizeScopes(_driveScopes);
  final client = auth.authenticatedClient(
    http.Client(),
    auth.AccessCredentials(
      auth.AccessToken(
        'Bearer',
        authz.accessToken,
        DateTime.now().toUtc().add(const Duration(hours: 1)),
      ),
      null,
      _driveScopes,
    ),
  );
  return GoogleDriveSession(
    email: account.email,
    api: drive.DriveApi(client),
    client: client,
  );
}

Future<void> disconnectGoogleDrive() async {
  await _ensureSignInInitialized();
  try {
    await GoogleSignIn.instance.disconnect();
  } catch (_) {
    await GoogleSignIn.instance.signOut();
  }
}

/// Drive’daki foto/video listesini MediaAtlas tarama öğelerine çevirir.
/// Konum varsa Drive `imageMediaMetadata` üzerinden gelir (indirmeden).
Future<FolderPickResult> listDriveMedia(
  GoogleDriveSession session, {
  int maxFiles = 400,
  void Function(String status)? onProgress,
}) async {
  final items = <FolderMediaRef>[];
  String? pageToken;
  onProgress?.call('Drive taranıyor…');

  do {
    final list = await session.api.files.list(
      q: '(mimeType contains "image/" or mimeType contains "video/") '
          'and trashed = false',
      $fields:
          'nextPageToken,files(id,name,mimeType,size,modifiedTime,imageMediaMetadata)',
      pageSize: 100,
      pageToken: pageToken,
      spaces: 'drive',
      corpora: 'user',
    );
    for (final f in list.files ?? const <drive.File>[]) {
      final name = f.name ?? '';
      if (name.isEmpty || !isMediaName(name)) continue;
      final id = f.id;
      if (id == null || id.isEmpty) continue;
      final size = int.tryParse(f.size ?? '') ?? 0;
      DateTime? modified;
      if (f.modifiedTime != null) {
        modified = f.modifiedTime!.toLocal();
      }
      double? lat;
      double? lng;
      final loc = f.imageMediaMetadata?.location;
      if (loc?.latitude != null && loc?.longitude != null) {
        lat = loc!.latitude;
        lng = loc.longitude;
      }
      final fileId = id;
      items.add(
        FolderMediaRef(
          name: name,
          size: size,
          relativePath: 'drive/$fileId/$name',
          localPath: null,
          lastModified: modified,
          knownLat: lat,
          knownLng: lng,
          readHead: (maxBytes) => _downloadHead(session.api, fileId, maxBytes),
        ),
      );
      if (items.length >= maxFiles) break;
    }
    pageToken = list.nextPageToken;
    onProgress?.call('Drive: ${items.length} medya…');
  } while (pageToken != null && items.length < maxFiles);

  return FolderPickResult(
    folderName: 'Google Drive (${session.email})',
    items: items,
  );
}

Future<Uint8List> _downloadHead(
  drive.DriveApi api,
  String fileId,
  int maxBytes,
) async {
  if (maxBytes <= 0) return Uint8List(0);
  final end = maxBytes - 1;
  final media = await api.files.get(
    fileId,
    downloadOptions: drive.PartialDownloadOptions(
      drive.ByteRange(0, end),
    ),
  ) as drive.Media?;
  if (media == null) return Uint8List(0);
  final builder = BytesBuilder(copy: false);
  await for (final chunk in media.stream) {
    builder.add(chunk);
    if (builder.length >= maxBytes) break;
  }
  final bytes = builder.takeBytes();
  if (bytes.length <= maxBytes) return Uint8List.fromList(bytes);
  return Uint8List.fromList(bytes.sublist(0, maxBytes));
}
