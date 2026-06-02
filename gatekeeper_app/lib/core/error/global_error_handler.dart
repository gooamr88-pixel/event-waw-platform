/// ═══════════════════════════════════
/// EVENTSLI GATEKEEPER — Global Error Handler
/// ═══════════════════════════════════
///
/// Production-grade error handling:
///   1. Catches all uncaught Flutter framework errors
///   2. Catches all uncaught async errors (Zone)
///   3. Logs errors with stack traces for debugging
///   4. Displays user-friendly error UI instead of red screen
///
/// Integration points:
///   - Replace _logError() with Sentry/Crashlytics when ready
///   - All errors are captured in a buffer for local debugging

import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';

import '../theme/app_theme.dart';

class GlobalErrorHandler {
  const GlobalErrorHandler._();

  /// Maximum number of errors to keep in local buffer.
  static const int _maxErrorBuffer = 50;

  /// Local error buffer for debugging.
  static final List<ErrorRecord> _errorBuffer = [];

  /// Get recent errors (for debug screen or logs).
  static List<ErrorRecord> get recentErrors =>
      List.unmodifiable(_errorBuffer);

  /// Initialize global error handling.
  /// Call this BEFORE runApp.
  static void init() {
    // ── Flutter Framework Errors ──
    FlutterError.onError = (FlutterErrorDetails details) {
      _logError(
        error: details.exception,
        stackTrace: details.stack,
        context: details.context?.toString(),
        source: 'FlutterError',
      );

      // In debug, still show the red error screen
      if (kDebugMode) {
        FlutterError.presentError(details);
      }
    };

    // ── Platform Dispatcher Errors (async uncaught) ──
    PlatformDispatcher.instance.onError = (error, stack) {
      _logError(
        error: error,
        stackTrace: stack,
        source: 'PlatformDispatcher',
      );
      return true; // Prevents app crash
    };
  }

  /// Run the app inside a guarded zone.
  static void runGuarded(Widget app) {
    runZonedGuarded(
      () => runApp(app),
      (error, stackTrace) {
        _logError(
          error: error,
          stackTrace: stackTrace,
          source: 'Zone',
        );
      },
    );
  }

  /// Central error logging.
  /// TODO: Replace with Sentry.captureException() or
  /// FirebaseCrashlytics.instance.recordError() in production.
  static void _logError({
    required Object error,
    StackTrace? stackTrace,
    String? context,
    required String source,
  }) {
    final record = ErrorRecord(
      error: error,
      stackTrace: stackTrace,
      context: context,
      source: source,
      timestamp: DateTime.now(),
    );

    // Add to buffer (FIFO)
    _errorBuffer.add(record);
    if (_errorBuffer.length > _maxErrorBuffer) {
      _errorBuffer.removeAt(0);
    }

    // Console logging
    if (kDebugMode) {
      debugPrint('═══ [$source] ERROR ═══');
      debugPrint('Error: $error');
      if (context != null) debugPrint('Context: $context');
      if (stackTrace != null) {
        debugPrint('Stack: ${stackTrace.toString().split('\n').take(5).join('\n')}');
      }
      debugPrint('═══════════════════════');
    }
  }

  /// Manually report an error (for caught exceptions).
  static void reportError(Object error, StackTrace? stackTrace, {String? context}) {
    _logError(
      error: error,
      stackTrace: stackTrace,
      context: context,
      source: 'Manual',
    );
  }
}

/// A recorded error for the local debug buffer.
class ErrorRecord {
  final Object error;
  final StackTrace? stackTrace;
  final String? context;
  final String source;
  final DateTime timestamp;

  const ErrorRecord({
    required this.error,
    this.stackTrace,
    this.context,
    required this.source,
    required this.timestamp,
  });

  @override
  String toString() =>
      '[$source] ${timestamp.toIso8601String()}: $error';
}

/// Custom error widget — replaces the red error screen in release mode.
class AppErrorWidget extends StatelessWidget {
  final FlutterErrorDetails? errorDetails;

  const AppErrorWidget({super.key, this.errorDetails});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      debugShowCheckedModeBanner: false,
      home: Scaffold(
        backgroundColor: AppColors.bgDeep,
        body: SafeArea(
          child: Center(
            child: Padding(
              padding: const EdgeInsets.all(32),
              child: Column(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  Container(
                    width: 80,
                    height: 80,
                    decoration: BoxDecoration(
                      color: AppColors.error.withOpacity(0.1),
                      shape: BoxShape.circle,
                    ),
                    child: const Icon(
                      Icons.warning_amber_rounded,
                      color: AppColors.error,
                      size: 40,
                    ),
                  ),
                  const SizedBox(height: 24),
                  const Text(
                    'Something went wrong',
                    style: TextStyle(
                      color: AppColors.textPrimary,
                      fontSize: 20,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                  const SizedBox(height: 8),
                  const Text(
                    'The app encountered an error.\nPlease restart and try again.',
                    textAlign: TextAlign.center,
                    style: TextStyle(
                      color: AppColors.textMuted,
                      fontSize: 14,
                    ),
                  ),
                  if (kDebugMode && errorDetails != null) ...[
                    const SizedBox(height: 24),
                    Container(
                      padding: const EdgeInsets.all(12),
                      decoration: BoxDecoration(
                        color: AppColors.bgSurface,
                        borderRadius: BorderRadius.circular(8),
                      ),
                      constraints: const BoxConstraints(maxHeight: 200),
                      child: SingleChildScrollView(
                        child: Text(
                          errorDetails.toString(),
                          style: const TextStyle(
                            color: AppColors.error,
                            fontSize: 10,
                            fontFamily: 'monospace',
                          ),
                        ),
                      ),
                    ),
                  ],
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}
