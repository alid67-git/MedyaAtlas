import 'dart:async';

import 'package:file_picker/file_picker.dart';
import 'package:flutter/services.dart';

/// Android `already_active` — eşzamanlı / takılı seçiciyi sıraya koy.
Completer<void>? _filePickerGate;

Future<T?> withFilePickerGate<T>(Future<T?> Function() open) async {
  // Önceki seçici bitsin.
  while (_filePickerGate != null) {
    try {
      await _filePickerGate!.future.timeout(const Duration(seconds: 90));
    } catch (_) {
      break;
    }
  }
  final gate = Completer<void>();
  _filePickerGate = gate;
  try {
    return await open();
  } finally {
    if (_filePickerGate == gate) _filePickerGate = null;
    if (!gate.isCompleted) gate.complete();
  }
}

/// `already_active` olursa temizle + bir kez yeniden dene.
Future<FilePickerResult?> pickFilesResilient({
  required FileType type,
  bool allowMultiple = false,
  List<String>? allowedExtensions,
  bool withData = false,
}) {
  return withFilePickerGate(() async {
    Future<FilePickerResult?> once() => FilePicker.platform.pickFiles(
          allowMultiple: allowMultiple,
          type: type,
          allowedExtensions: allowedExtensions,
          withData: withData,
        );

    try {
      return await once();
    } on PlatformException catch (e) {
      if (e.code != 'already_active') rethrow;
      try {
        await FilePicker.platform.clearTemporaryFiles();
      } catch (_) {}
      await Future<void>.delayed(const Duration(milliseconds: 450));
      try {
        return await once();
      } on PlatformException catch (e2) {
        if (e2.code == 'already_active') {
          try {
            await FilePicker.platform.clearTemporaryFiles();
          } catch (_) {}
          throw StateError(
            'Dosya seçici hâlâ açık görünüyor. Bir saniye bekleyip tekrar deneyin.',
          );
        }
        rethrow;
      }
    }
  });
}

Future<String?> pickDirectoryPathResilient({String? dialogTitle}) {
  return withFilePickerGate(() async {
    Future<String?> once() => FilePicker.platform.getDirectoryPath(
          dialogTitle: dialogTitle,
        );
    try {
      return await once();
    } on PlatformException catch (e) {
      if (e.code != 'already_active') rethrow;
      try {
        await FilePicker.platform.clearTemporaryFiles();
      } catch (_) {}
      await Future<void>.delayed(const Duration(milliseconds: 450));
      try {
        return await once();
      } on PlatformException catch (e2) {
        if (e2.code == 'already_active') {
          throw StateError(
            'Dosya seçici hâlâ açık görünüyor. Bir saniye bekleyip tekrar deneyin.',
          );
        }
        rethrow;
      }
    }
  });
}
