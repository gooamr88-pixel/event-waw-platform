/// ═══════════════════════════════════
/// Scanner BLoC — Events
/// ═══════════════════════════════════

import 'package:equatable/equatable.dart';

abstract class ScannerEvent extends Equatable {
  const ScannerEvent();

  @override
  List<Object?> get props => [];
}

/// Initialize scanner for an event — starts session, prefetch cache.
class ScannerInitRequested extends ScannerEvent {
  final String eventId;
  final String eventTitle;

  const ScannerInitRequested({
    required this.eventId,
    required this.eventTitle,
  });

  @override
  List<Object?> get props => [eventId, eventTitle];
}

/// QR code was decoded from the camera.
class ScannerQrDetected extends ScannerEvent {
  final String rawValue;

  const ScannerQrDetected(this.rawValue);

  @override
  List<Object?> get props => [rawValue];
}

/// Dismiss the current scan result overlay.
class ScannerResultDismissed extends ScannerEvent {
  const ScannerResultDismissed();
}

/// Toggle the flashlight.
class ScannerTorchToggled extends ScannerEvent {
  const ScannerTorchToggled();
}

/// Switch between front and back camera.
class ScannerCameraSwitched extends ScannerEvent {
  const ScannerCameraSwitched();
}

/// Connectivity changed (online/offline).
class ScannerConnectivityChanged extends ScannerEvent {
  final bool isOnline;

  const ScannerConnectivityChanged(this.isOnline);

  @override
  List<Object?> get props => [isOnline];
}

/// Trigger sync of offline scan queue.
class ScannerSyncRequested extends ScannerEvent {
  const ScannerSyncRequested();
}

/// End the scanning session and go back.
class ScannerSessionEnded extends ScannerEvent {
  const ScannerSessionEnded();
}
