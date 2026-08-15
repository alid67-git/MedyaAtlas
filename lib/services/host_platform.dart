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
