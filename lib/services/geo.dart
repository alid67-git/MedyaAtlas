import 'package:latlong2/latlong.dart';

/// JSON / harita için geçerli GPS: sonlu, 0,0 değil, dünya sınırları içinde.
bool isValidGps(double? lat, double? lng) {
  if (lat == null || lng == null) return false;
  if (!lat.isFinite || !lng.isFinite) return false;
  if (lat == 0 && lng == 0) return false;
  if (lat.abs() > 90 || lng.abs() > 180) return false;
  return true;
}

LatLng? latLngOrNull(double? lat, double? lng) =>
    isValidGps(lat, lng) ? LatLng(lat!, lng!) : null;
