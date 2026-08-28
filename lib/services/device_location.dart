import 'package:geolocator/geolocator.dart';
import 'package:latlong2/latlong.dart';

/// Cihazın anlık konumu — haritada «konumum» için.
Future<LatLng?> fetchDeviceLocation() async {
  try {
    final enabled = await Geolocator.isLocationServiceEnabled();
    if (!enabled) return null;

    var permission = await Geolocator.checkPermission();
    if (permission == LocationPermission.denied) {
      permission = await Geolocator.requestPermission();
    }
    if (permission == LocationPermission.denied ||
        permission == LocationPermission.deniedForever) {
      return null;
    }

    Position? pos;
    try {
      pos = await Geolocator.getLastKnownPosition();
    } catch (_) {}

    try {
      pos = await Geolocator.getCurrentPosition(
        locationSettings: const LocationSettings(
          accuracy: LocationAccuracy.high,
          timeLimit: Duration(seconds: 18),
        ),
      );
    } catch (_) {
      // Son bilinen konum yeterli (GPS yavaş / kapalı alan).
    }

    if (pos == null) return null;
    if (!pos.latitude.isFinite || !pos.longitude.isFinite) return null;
    return LatLng(pos.latitude, pos.longitude);
  } catch (_) {
    return null;
  }
}
