/// ═══════════════════════════════════
/// EVENTSLI GATEKEEPER — Haptic & Audio Feedback Service
/// ═══════════════════════════════════
///
/// Provides tactile (vibration) and audio feedback for scan results.
/// Critical for high-speed scanning where the operator may not
/// look at the screen between scans.

import 'package:flutter/services.dart';
import 'package:just_audio/just_audio.dart';

class FeedbackService {
  AudioPlayer? _successPlayer;
  AudioPlayer? _rejectPlayer;

  bool _initialized = false;

  /// Initialize audio players with bundled sound assets.
  Future<void> init() async {
    if (_initialized) return;

    try {
      _successPlayer = AudioPlayer();
      _rejectPlayer = AudioPlayer();

      // Pre-load sounds for instant playback
      // These will be bundled in assets/sounds/
      // If sounds aren't available yet, the service degrades gracefully
      await Future.wait([
        _successPlayer!
            .setAsset('assets/sounds/scan_success.mp3')
            .catchError((_) => Duration.zero),
        _rejectPlayer!
            .setAsset('assets/sounds/scan_reject.mp3')
            .catchError((_) => Duration.zero),
      ]);

      _initialized = true;
    } catch (_) {
      // Audio init failed — haptic-only mode
      _initialized = true;
    }
  }

  /// Feedback for successful scan (admitted / re-entry).
  Future<void> onScanSuccess() async {
    // Strong haptic
    HapticFeedback.mediumImpact();

    // Success chime
    try {
      await _successPlayer?.seek(Duration.zero);
      _successPlayer?.play();
    } catch (_) {}
  }

  /// Feedback for rejected scan.
  Future<void> onScanRejected() async {
    // Heavy haptic (error pattern)
    HapticFeedback.heavyImpact();
    await Future.delayed(const Duration(milliseconds: 100));
    HapticFeedback.heavyImpact();

    // Error buzz
    try {
      await _rejectPlayer?.seek(Duration.zero);
      _rejectPlayer?.play();
    } catch (_) {}
  }

  /// Feedback for duplicate scan (soft warning).
  Future<void> onScanDuplicate() async {
    HapticFeedback.lightImpact();
  }

  /// Light tap for button presses.
  Future<void> onTap() async {
    HapticFeedback.selectionClick();
  }

  /// Dispose audio players.
  Future<void> dispose() async {
    await _successPlayer?.dispose();
    await _rejectPlayer?.dispose();
  }
}
