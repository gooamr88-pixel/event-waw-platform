/// ═══════════════════════════════════
/// EVENTSLI GATEKEEPER — App Lifecycle Manager
/// ═══════════════════════════════════
///
/// Monitors app foreground/background transitions:
///   - Pauses scanner camera when backgrounded
///   - Triggers sync when returning to foreground
///   - Logs lifecycle events for debugging
///   - Manages Supabase auth session refresh

import 'package:flutter/foundation.dart';
import 'package:flutter/widgets.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

class AppLifecycleManager extends WidgetsBindingObserver {
  static final AppLifecycleManager _instance = AppLifecycleManager._();
  factory AppLifecycleManager() => _instance;
  AppLifecycleManager._();

  AppLifecycleState _lastState = AppLifecycleState.resumed;
  DateTime? _backgroundedAt;
  final List<VoidCallback> _onResumeCallbacks = [];
  final List<VoidCallback> _onPauseCallbacks = [];

  /// Register the lifecycle observer.
  void init() {
    WidgetsBinding.instance.addObserver(this);
    if (kDebugMode) {
      debugPrint('📱 AppLifecycleManager initialized');
    }
  }

  /// Clean up.
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    _onResumeCallbacks.clear();
    _onPauseCallbacks.clear();
  }

  /// Add a callback for when the app returns to foreground.
  void addOnResumeCallback(VoidCallback callback) {
    _onResumeCallbacks.add(callback);
  }

  /// Remove a resume callback.
  void removeOnResumeCallback(VoidCallback callback) {
    _onResumeCallbacks.remove(callback);
  }

  /// Add a callback for when the app goes to background.
  void addOnPauseCallback(VoidCallback callback) {
    _onPauseCallbacks.add(callback);
  }

  /// Remove a pause callback.
  void removeOnPauseCallback(VoidCallback callback) {
    _onPauseCallbacks.remove(callback);
  }

  /// How long the app was in the background.
  Duration? get backgroundDuration {
    if (_backgroundedAt == null) return null;
    return DateTime.now().difference(_backgroundedAt!);
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (kDebugMode) {
      debugPrint('📱 Lifecycle: $_lastState → $state');
    }

    switch (state) {
      case AppLifecycleState.resumed:
        _onResumed();
        break;
      case AppLifecycleState.paused:
        _onPaused();
        break;
      case AppLifecycleState.inactive:
      case AppLifecycleState.detached:
      case AppLifecycleState.hidden:
        break;
    }

    _lastState = state;
  }

  void _onResumed() {
    final wasPaused = _lastState == AppLifecycleState.paused ||
        _lastState == AppLifecycleState.inactive;

    if (wasPaused) {
      if (kDebugMode && _backgroundedAt != null) {
        final duration = DateTime.now().difference(_backgroundedAt!);
        debugPrint('📱 Resumed after ${duration.inSeconds}s');
      }

      // Refresh auth session if backgrounded > 5 minutes
      if (_backgroundedAt != null) {
        final duration = DateTime.now().difference(_backgroundedAt!);
        if (duration.inMinutes >= 5) {
          _refreshAuthSession();
        }
      }

      // Notify all resume callbacks
      for (final callback in List.of(_onResumeCallbacks)) {
        try {
          callback();
        } catch (e) {
          if (kDebugMode) {
            debugPrint('📱 Resume callback error: $e');
          }
        }
      }
    }

    _backgroundedAt = null;
  }

  void _onPaused() {
    _backgroundedAt = DateTime.now();

    // Notify all pause callbacks
    for (final callback in List.of(_onPauseCallbacks)) {
      try {
        callback();
      } catch (e) {
        if (kDebugMode) {
          debugPrint('📱 Pause callback error: $e');
        }
      }
    }
  }

  Future<void> _refreshAuthSession() async {
    try {
      await Supabase.instance.client.auth.refreshSession();
      if (kDebugMode) {
        debugPrint('📱 Auth session refreshed after background');
      }
    } catch (e) {
      if (kDebugMode) {
        debugPrint('📱 Auth refresh failed: $e');
      }
    }
  }
}
