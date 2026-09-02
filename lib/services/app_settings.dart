import 'package:flutter/foundation.dart';
import 'package:hive_flutter/hive_flutter.dart';

enum AppLang { tr, en, de }

enum MapLayer {
  satellite,
  streets,
  topo,
  dark,
}

/// Harita medya pin şekli (düzlem haritada foto): daire veya kare.
enum MapPinShape {
  round,
  square,
}

/// Haritada medya: ısı lekesi veya fotoğraf önizlemesi.
enum MapPinDisplay {
  heat,
  photos,
}

/// Harita yüzeyi: düz 2D harita veya döndürülebilir 3D dünya.
enum MapSurface {
  flat,
  globe,
}

/// Sabit kredi — kullanıcı tarafından değiştirilmez.
const appDeveloperName = 'Ali Dinçer';

class AppSettings extends ChangeNotifier {
  AppSettings._();
  static final instance = AppSettings._();

  static const _boxName = 'medyaatlas_settings';
  late Box _box;

  AppLang lang = AppLang.tr;
  MapLayer mapLayer = MapLayer.satellite;
  MapPinShape mapPinShape = MapPinShape.round;
  MapPinDisplay mapPinDisplay = MapPinDisplay.heat;
  MapSurface mapSurface = MapSurface.flat;

  Future<void> init() async {
    _box = await Hive.openBox(_boxName);
    lang = AppLang.values.firstWhere(
      (e) => e.name == (_box.get('lang') as String? ?? 'tr'),
      orElse: () => AppLang.tr,
    );
    mapLayer = MapLayer.values.firstWhere(
      (e) => e.name == (_box.get('mapLayer') as String? ?? 'satellite'),
      orElse: () => MapLayer.satellite,
    );
    mapPinShape = MapPinShape.values.firstWhere(
      (e) => e.name == (_box.get('mapPinShape') as String? ?? 'round'),
      orElse: () => MapPinShape.round,
    );
    mapPinDisplay = MapPinDisplay.values.firstWhere(
      (e) => e.name == (_box.get('mapPinDisplay') as String? ?? 'heat'),
      orElse: () => MapPinDisplay.heat,
    );
    mapSurface = MapSurface.values.firstWhere(
      (e) => e.name == (_box.get('mapSurface') as String? ?? 'flat'),
      orElse: () => MapSurface.flat,
    );
  }

  Future<void> setLang(AppLang value) async {
    lang = value;
    await _box.put('lang', value.name);
    notifyListeners();
  }

  Future<void> setMapLayer(MapLayer value) async {
    mapLayer = value;
    await _box.put('mapLayer', value.name);
    notifyListeners();
  }

  Future<void> setMapPinShape(MapPinShape value) async {
    mapPinShape = value;
    mapPinDisplay = MapPinDisplay.photos;
    await _box.put('mapPinShape', value.name);
    await _box.put('mapPinDisplay', mapPinDisplay.name);
    notifyListeners();
  }

  Future<void> setMapPinDisplay(MapPinDisplay value) async {
    mapPinDisplay = value;
    await _box.put('mapPinDisplay', value.name);
    notifyListeners();
  }

  Future<void> setMapSurface(MapSurface value) async {
    mapSurface = value;
    await _box.put('mapSurface', value.name);
    notifyListeners();
  }

  String get mapUrlTemplate => switch (mapLayer) {
        MapLayer.satellite =>
          'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
        MapLayer.streets =>
          'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
        MapLayer.topo =>
          'https://tile.opentopomap.org/{z}/{x}/{y}.png',
        MapLayer.dark =>
          'https://basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png',
      };

  String? get mapAttribution => switch (mapLayer) {
        MapLayer.satellite => 'Esri / ArcGIS',
        MapLayer.streets => '© OpenStreetMap',
        MapLayer.topo => '© OpenTopoMap',
        MapLayer.dark => '© CARTO / OSM',
      };
}
