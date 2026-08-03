/**
 * GoPro GPS5 SCAL + kilit doğrulama — bilinen ham tampon örüntüsü.
 * Çalıştır: node scripts/test-gopro-gps.mjs
 */
import assert from 'node:assert/strict'
import {
  applyGps5Scale,
  GPS5_LATLON_SCALE,
  isLockedFix,
  isValidCoord,
  pointFromTelemetry,
} from '../server/goproGpsExtract.mjs'

// GPMF GPS5: lat/lon SCAL = 1e7 (GoPro spec / ExifTool)
{
  // Cancún ~21.1619°N, 86.8515°W
  const raw = [211619000, -868515000, 2500, 1200, 130]
  const scaled = applyGps5Scale(raw)
  assert.ok(Math.abs(scaled[0] - 21.1619) < 1e-6)
  assert.ok(Math.abs(scaled[1] - -86.8515) < 1e-6)
  assert.equal(GPS5_LATLON_SCALE, 10_000_000)
}

{
  // İstanbul ~41.0082°N, 28.9784°E — ölçek yoksa ±90 dışına çıkar
  const raw = [410082000, 289784000, 40000, 0, 0]
  const scaled = applyGps5Scale(raw)
  assert.ok(isValidCoord(scaled[0], scaled[1]))
  assert.ok(!isValidCoord(raw[0], raw[1]), 'ham GPS5 derece gibi kabul edilmemeli')
}

{
  assert.equal(isLockedFix(0), false)
  assert.equal(isLockedFix(1), false)
  assert.equal(isLockedFix(2), true)
  assert.equal(isLockedFix(3), true)
  assert.equal(isLockedFix(undefined), false)
}

// Kilit yok → null (son bilinen konum haritaya yazılmasın)
{
  const unlocked = pointFromTelemetry({
    1: {
      streams: {
        GPS5: {
          samples: [
            {
              value: [21.16, -86.85, 2, 0, 0],
              sticky: { fix: 0, precision: 9999 },
            },
          ],
        },
      },
    },
  })
  assert.equal(unlocked, null)
}

{
  const locked = pointFromTelemetry({
    1: {
      streams: {
        GPS5: {
          samples: [
            {
              value: [41.01, 28.98, 40, 1, 1],
              sticky: { fix: 3, precision: 120 },
            },
          ],
        },
      },
    },
  })
  assert.ok(locked)
  assert.ok(Math.abs(locked.latitude - 41.01) < 1e-9)
  assert.ok(Math.abs(locked.longitude - 28.98) < 1e-9)
}

// GPS9: fix value[8]
{
  const locked9 = pointFromTelemetry({
    1: {
      streams: {
        GPS9: {
          samples: [
            {
              // lat,lon,alt,2d,3d,days,secs,dop,fix
              value: [39.9, 32.8, 900, 0, 0, 9000, 0, 80, 3],
            },
          ],
        },
      },
    },
  })
  assert.ok(locked9)
  assert.ok(Math.abs(locked9.latitude - 39.9) < 1e-9)
}

// Sticky GPSF sonda: fix örnekte yok, sticky'den gelsin
{
  const stickyLocked = pointFromTelemetry({
    1: {
      streams: {
        GPS5: {
          samples: [
            { sticky: { fix: 3, precision: 90 } },
            { value: [40.0, 29.0, 10, 0, 0] },
          ],
        },
      },
    },
  })
  assert.ok(stickyLocked)
  assert.ok(Math.abs(stickyLocked.latitude - 40.0) < 1e-9)
}

console.log('ok — gopro gps scale + fix lock')
