import 'package:flutter/foundation.dart';

/// `dart:io` olmadan platform — web derlemesi için.
bool get hostIsAndroid =>
    !kIsWeb && defaultTargetPlatform == TargetPlatform.android;

bool get hostIsWindows =>
    !kIsWeb && defaultTargetPlatform == TargetPlatform.windows;

bool get hostIsIOS => !kIsWeb && defaultTargetPlatform == TargetPlatform.iOS;

bool get hostIsDesktop =>
    !kIsWeb &&
    (defaultTargetPlatform == TargetPlatform.windows ||
        defaultTargetPlatform == TargetPlatform.linux ||
        defaultTargetPlatform == TargetPlatform.macOS);

/// iPhone / iPad Safari (PWA dahil) — Flutter web `defaultTargetPlatform` iOS olur.
bool get hostIsAppleWeb =>
    kIsWeb && defaultTargetPlatform == TargetPlatform.iOS;

/// Mobil telefon UI: native Android/iOS veya iPhone web.
bool get hostIsPhoneUi =>
    hostIsAndroid || hostIsIOS || hostIsAppleWeb;
