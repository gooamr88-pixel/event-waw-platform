/// ═══════════════════════════════════
/// EVENTSLI GATEKEEPER — Connectivity Service
/// ═══════════════════════════════════
///
/// Monitors network connectivity and provides a stream
/// that the Scanner BLoC listens to for online/offline switching.

import 'dart:async';
import 'package:connectivity_plus/connectivity_plus.dart';

class ConnectivityService {
  final Connectivity _connectivity = Connectivity();
  StreamSubscription<List<ConnectivityResult>>? _subscription;

  final _controller = StreamController<bool>.broadcast();

  /// Stream of connectivity status: true = online, false = offline.
  Stream<bool> get onConnectivityChanged => _controller.stream;

  bool _isOnline = true;

  /// Current connectivity status.
  bool get isOnline => _isOnline;

  /// Start monitoring connectivity.
  void startMonitoring() {
    _subscription = _connectivity.onConnectivityChanged.listen((results) {
      final online = results.any((r) => r != ConnectivityResult.none);
      if (online != _isOnline) {
        _isOnline = online;
        _controller.add(online);
      }
    });

    // Check initial status
    _checkInitial();
  }

  Future<void> _checkInitial() async {
    try {
      final results = await _connectivity.checkConnectivity();
      _isOnline = results.any((r) => r != ConnectivityResult.none);
      _controller.add(_isOnline);
    } catch (_) {
      _isOnline = true; // Assume online if check fails
      _controller.add(true);
    }
  }

  /// Stop monitoring.
  void dispose() {
    _subscription?.cancel();
    _controller.close();
  }
}
