/// ═══════════════════════════════════
/// Scanner BLoC — Business Logic (Phase 3)
/// ═══════════════════════════════════
///
/// State machine for the QR scanner screen:
///   Init → Prefetching → Ready ↔ Processing → ResultShowing → Ready
///                              ↕
///                           Syncing
///
/// Phase 3 additions:
///   - Ticket prefetch on session start (fills Hive cache)
///   - Background sync via SyncManager (periodic + reconnect)
///   - Server-wins conflict resolution (via SyncManager reconciliation)
///   - Prefetch progress tracking in state
///   - SyncManager lifecycle management

import 'dart:async';
import 'dart:convert';
import 'package:flutter_bloc/flutter_bloc.dart';

import '../../../core/config/app_environment.dart';
import '../../../data/services/connectivity_service.dart';
import '../../../data/services/feedback_service.dart';
import '../../../data/services/offline_cache_service.dart';
import '../../../data/services/sync_manager.dart';
import '../../../data/services/ticket_prefetch_service.dart';
import '../../../domain/repositories/scanner_repository.dart';
import 'scanner_event.dart';
import 'scanner_state.dart';

class ScannerBloc extends Bloc<ScannerEvent, ScannerState> {
  final ScannerRepository _scannerRepository;
  final OfflineCacheService _cacheService;
  final ConnectivityService _connectivityService;
  final FeedbackService _feedbackService;
  final SyncManager _syncManager;
  final TicketPrefetchService _prefetchService;

  StreamSubscription<bool>? _connectivitySub;
  StreamSubscription<SyncProgress>? _syncProgressSub;
  StreamSubscription<PrefetchProgress>? _prefetchProgressSub;
  Timer? _resultDismissTimer;

  // Anti-rapid-scan: track last scan time per ticket
  final Map<String, DateTime> _lastScanTimes = {};

  ScannerBloc({
    required ScannerRepository scannerRepository,
    required OfflineCacheService cacheService,
    required ConnectivityService connectivityService,
    required FeedbackService feedbackService,
    required SyncManager syncManager,
    required TicketPrefetchService prefetchService,
  })  : _scannerRepository = scannerRepository,
        _cacheService = cacheService,
        _connectivityService = connectivityService,
        _feedbackService = feedbackService,
        _syncManager = syncManager,
        _prefetchService = prefetchService,
        super(const ScannerInitial()) {
    on<ScannerInitRequested>(_onInit);
    on<ScannerQrDetected>(_onQrDetected);
    on<ScannerResultDismissed>(_onResultDismissed);
    on<ScannerTorchToggled>(_onTorchToggled);
    on<ScannerConnectivityChanged>(_onConnectivityChanged);
    on<ScannerSyncRequested>(_onSyncRequested);
    on<ScannerSessionEnded>(_onSessionEnded);
    on<_ScannerSyncProgressUpdated>(_onSyncProgressUpdated);
    on<_ScannerPrefetchProgressUpdated>(_onPrefetchProgressUpdated);
  }

  // ═══════════════════════════════════
  // INIT
  // ═══════════════════════════════════

  Future<void> _onInit(
    ScannerInitRequested event,
    Emitter<ScannerState> emit,
  ) async {
    emit(ScannerLoading(eventTitle: event.eventTitle));

    try {
      // Initialize services
      await _cacheService.init();
      await _feedbackService.init();
      _connectivityService.startMonitoring();

      // Listen to connectivity changes
      _connectivitySub = _connectivityService.onConnectivityChanged.listen(
        (isOnline) => add(ScannerConnectivityChanged(isOnline)),
      );

      // Listen to sync progress from SyncManager
      _syncProgressSub = _syncManager.progressStream.listen(
        (progress) => add(_ScannerSyncProgressUpdated(progress)),
      );

      // Listen to prefetch progress
      _prefetchProgressSub = _prefetchService.progressStream.listen(
        (progress) => add(_ScannerPrefetchProgressUpdated(progress)),
      );

      // Start scanner session
      String? sessionId;
      try {
        final session = await _scannerRepository.startSession(
          eventId: event.eventId,
          deviceInfo: {'app_version': AppEnvironment.appVersion},
        );
        sessionId = session.sessionId;

        emit(ScannerReady(
          eventId: event.eventId,
          eventTitle: event.eventTitle,
          session: session,
          isOnline: _connectivityService.isOnline,
          offlineQueueSize: _cacheService.getEventQueueSize(event.eventId),
          cachedTicketCount: _cacheService.getCacheSize(event.eventId),
          isPrefetching: true,
        ));
      } catch (e) {
        // Session start failed — still allow scanning
        emit(ScannerReady(
          eventId: event.eventId,
          eventTitle: event.eventTitle,
          isOnline: _connectivityService.isOnline,
          offlineQueueSize: _cacheService.getEventQueueSize(event.eventId),
          cachedTicketCount: _cacheService.getCacheSize(event.eventId),
        ));
      }

      // ── Phase 3: Ticket Prefetch ──
      // Start prefetching tickets into Hive cache for offline use.
      // This runs in the background — scanner is usable immediately.
      if (_connectivityService.isOnline) {
        _prefetchService.startForEvent(event.eventId);
      }

      // ── Phase 3: Start Background Sync Engine ──
      _syncManager.start(event.eventId, sessionId: sessionId);
    } catch (e) {
      emit(ScannerReady(
        eventId: event.eventId,
        eventTitle: event.eventTitle,
        isOnline: _connectivityService.isOnline,
        offlineQueueSize: _cacheService.getEventQueueSize(event.eventId),
        cachedTicketCount: _cacheService.getCacheSize(event.eventId),
      ));
    }
  }

  // ═══════════════════════════════════
  // QR DETECTED
  // ═══════════════════════════════════

  Future<void> _onQrDetected(
    ScannerQrDetected event,
    Emitter<ScannerState> emit,
  ) async {
    final currentState = state;
    if (currentState is! ScannerReady) return;

    // Parse QR payload
    Map<String, dynamic>? parsed;
    try {
      parsed = json.decode(event.rawValue) as Map<String, dynamic>;
    } catch (_) {
      _feedbackService.onScanRejected();
      emit(ScannerResultShowing(
        scannerState: currentState,
        result: const ScanResult(
          type: ScanResultType.rejected,
          message: 'Invalid QR code format',
        ),
      ));
      _scheduleResultDismiss();
      return;
    }

    final ticketId = parsed['ticket_id'] as String?;
    if (ticketId == null) {
      _feedbackService.onScanRejected();
      emit(ScannerResultShowing(
        scannerState: currentState,
        result: const ScanResult(
          type: ScanResultType.rejected,
          message: 'Not an Eventsli ticket',
        ),
      ));
      _scheduleResultDismiss();
      return;
    }

    // ── Anti-rapid-scan cooldown ──
    final lastScan = _lastScanTimes[ticketId];
    if (lastScan != null) {
      final elapsed = DateTime.now().difference(lastScan).inMilliseconds;
      if (elapsed < AppEnvironment.scanCooldownMs) {
        _feedbackService.onScanDuplicate();
        emit(ScannerResultShowing(
          scannerState: currentState,
          result: const ScanResult(
            type: ScanResultType.duplicate,
            message: 'Already scanned (cooldown active)',
          ),
        ));
        _scheduleResultDismiss(seconds: 1);
        return;
      }
    }
    _lastScanTimes[ticketId] = DateTime.now();

    // Show processing state
    emit(ScannerProcessing(previousState: currentState));

    // ── Route: online or offline ──
    Map<String, dynamic> result;

    if (currentState.isOnline) {
      result = await _verifyOnline(event.rawValue, currentState.eventId, ticketId);
    } else {
      result = _verifyOffline(parsed, currentState.eventId);
    }

    // ── Map result to ScanResult ──
    final scanResult = _mapToScanResult(result);

    // ── Feedback ──
    if (scanResult.isSuccess) {
      _feedbackService.onScanSuccess();
    } else if (scanResult.type == ScanResultType.duplicate) {
      _feedbackService.onScanDuplicate();
    } else {
      _feedbackService.onScanRejected();
    }

    // ── Update counters ──
    final updatedState = currentState.copyWith(
      totalScans: currentState.totalScans + 1,
      successfulScans: scanResult.isSuccess
          ? currentState.successfulScans + 1
          : currentState.successfulScans,
      rejectedScans: !scanResult.isSuccess && scanResult.type != ScanResultType.duplicate
          ? currentState.rejectedScans + 1
          : currentState.rejectedScans,
      offlineQueueSize: _cacheService.getEventQueueSize(currentState.eventId),
      cachedTicketCount: _cacheService.getCacheSize(currentState.eventId),
    );

    emit(ScannerResultShowing(
      scannerState: updatedState,
      result: scanResult,
    ));

    _scheduleResultDismiss();
  }

  /// Verify a ticket online via the Edge Function.
  Future<Map<String, dynamic>> _verifyOnline(
    String rawPayload,
    String eventId,
    String ticketId,
  ) async {
    try {
      final result = await _scannerRepository.verifyTicket(rawPayload);

      // ── Phase 3: Update local cache with server result ──
      // Even when online, keep the local cache fresh for future offline use.
      _updateCacheFromOnlineResult(eventId, ticketId, result);

      return result;
    } catch (e) {
      // Network failed during "online" mode — fallback to offline
      final parsed = json.decode(rawPayload) as Map<String, dynamic>;
      final offlineResult = _cacheService.verifyOffline(
        eventId: eventId,
        ticketId: ticketId,
        hash: parsed['hash'] as String? ?? '',
      );

      if (offlineResult != null) {
        // Queue this scan for later sync
        await _cacheService.queueScan(
          eventId: eventId,
          ticketId: ticketId,
          deviceInfo: 'Flutter Gatekeeper (fallback offline)',
        );
        return offlineResult;
      }

      return {
        'valid': false,
        'scan_result': 'error',
        'message': 'Network error and ticket not in cache',
      };
    }
  }

  /// Update local Hive cache after a successful online verification.
  /// Keeps cache fresh so offline fallback always has latest data.
  void _updateCacheFromOnlineResult(
    String eventId,
    String ticketId,
    Map<String, dynamic> serverResult,
  ) {
    final cached = _cacheService.getTicket(eventId, ticketId);
    if (cached == null) return; // Not in cache — prefetch will add it later

    final updated = Map<String, dynamic>.from(cached);
    if (serverResult.containsKey('scan_count')) {
      updated['scan_count'] = serverResult['scan_count'];
    }
    if (serverResult.containsKey('status')) {
      updated['status'] = serverResult['status'];
    }
    updated['last_online_verify'] = DateTime.now().toIso8601String();

    _cacheService.updateTicket(eventId, ticketId, updated);
  }

  /// Verify a ticket offline using the local Hive cache.
  Map<String, dynamic> _verifyOffline(
    Map<String, dynamic> parsed,
    String eventId,
  ) {
    final ticketId = parsed['ticket_id'] as String;
    final hash = parsed['hash'] as String? ?? '';

    final result = _cacheService.verifyOffline(
      eventId: eventId,
      ticketId: ticketId,
      hash: hash,
    );

    if (result != null) {
      // Queue for sync
      _cacheService.queueScan(
        eventId: eventId,
        ticketId: ticketId,
        deviceInfo: 'Flutter Gatekeeper (offline)',
      );
      return result;
    }

    return {
      'valid': false,
      'scan_result': 'error',
      'message': 'Ticket not found in offline cache.\nConnect to internet to verify.',
      'is_offline': true,
    };
  }

  /// Map raw API/cache result to a typed ScanResult.
  ScanResult _mapToScanResult(Map<String, dynamic> data) {
    final valid = data['valid'] as bool? ?? false;
    final scanResult = data['scan_result'] as String? ?? 'error';
    final message = data['message'] as String? ?? (valid ? 'OK' : 'Failed');
    final isOffline = data['is_offline'] as bool? ?? false;

    ScanResultType type;
    if (data['locked'] == true) {
      type = ScanResultType.locked;
    } else if (scanResult == 'admitted') {
      type = ScanResultType.admitted;
    } else if (scanResult == 're_entry') {
      type = ScanResultType.reEntry;
    } else if (scanResult == 'duplicate') {
      type = ScanResultType.duplicate;
    } else if (scanResult == 'rejected') {
      type = ScanResultType.rejected;
    } else if (valid) {
      type = ScanResultType.admitted;
    } else {
      type = ScanResultType.error;
    }

    return ScanResult(
      type: type,
      message: message,
      buyerName: data['buyer_name'] as String?,
      tierName: data['tier_name'] as String?,
      seatLabel: data['seat_label'] as String?,
      scanCount: (data['scan_count'] as int?) ?? 0,
      maxScans: (data['max_scans'] as int?) ?? 0,
      scansRemaining: (data['scans_remaining'] as int?) ?? -1,
      isUnlimited: (data['is_unlimited'] as bool?) ?? false,
      isOffline: isOffline,
    );
  }

  // ═══════════════════════════════════
  // RESULT DISMISS
  // ═══════════════════════════════════

  void _scheduleResultDismiss({int seconds = 3}) {
    _resultDismissTimer?.cancel();
    _resultDismissTimer = Timer(Duration(seconds: seconds), () {
      add(const ScannerResultDismissed());
    });
  }

  Future<void> _onResultDismissed(
    ScannerResultDismissed event,
    Emitter<ScannerState> emit,
  ) async {
    final currentState = state;
    if (currentState is ScannerResultShowing) {
      emit(currentState.scannerState);
    }
  }

  // ═══════════════════════════════════
  // TORCH TOGGLE
  // ═══════════════════════════════════

  Future<void> _onTorchToggled(
    ScannerTorchToggled event,
    Emitter<ScannerState> emit,
  ) async {
    final currentState = state;
    if (currentState is ScannerReady) {
      emit(currentState.copyWith(torchEnabled: !currentState.torchEnabled));
    }
  }

  // ═══════════════════════════════════
  // CONNECTIVITY
  // ═══════════════════════════════════

  Future<void> _onConnectivityChanged(
    ScannerConnectivityChanged event,
    Emitter<ScannerState> emit,
  ) async {
    ScannerReady? readyState;

    if (state is ScannerReady) {
      readyState = state as ScannerReady;
    } else if (state is ScannerResultShowing) {
      readyState = (state as ScannerResultShowing).scannerState;
    }

    if (readyState != null) {
      final updated = readyState.copyWith(isOnline: event.isOnline);
      emit(updated);

      // When coming back online: trigger prefetch refresh + sync
      if (event.isOnline) {
        _prefetchService.prefetch(readyState.eventId, skipIfFresh: true);
      }
      // SyncManager auto-syncs on reconnect via its own connectivity listener
    }
  }

  // ═══════════════════════════════════
  // SYNC (Manual trigger — delegates to SyncManager)
  // ═══════════════════════════════════

  Future<void> _onSyncRequested(
    ScannerSyncRequested event,
    Emitter<ScannerState> emit,
  ) async {
    ScannerReady? readyState;
    if (state is ScannerReady) {
      readyState = state as ScannerReady;
    } else if (state is ScannerResultShowing) {
      readyState = (state as ScannerResultShowing).scannerState;
    }

    if (readyState == null || !readyState.isOnline) return;

    final queueSize = _cacheService.getEventQueueSize(readyState.eventId);
    if (queueSize == 0) return;

    // Delegate to SyncManager — it emits progress via stream
    await _syncManager.syncNow(
      readyState.eventId,
      sessionId: readyState.session?.sessionId,
    );
  }

  // ═══════════════════════════════════
  // SYNC PROGRESS (from SyncManager stream)
  // ═══════════════════════════════════

  Future<void> _onSyncProgressUpdated(
    _ScannerSyncProgressUpdated event,
    Emitter<ScannerState> emit,
  ) async {
    ScannerReady? readyState;
    if (state is ScannerReady) {
      readyState = state as ScannerReady;
    } else if (state is ScannerResultShowing) {
      readyState = (state as ScannerResultShowing).scannerState;
    } else if (state is ScannerSyncing) {
      readyState = (state as ScannerSyncing).scannerState;
    }

    if (readyState == null) return;

    final progress = event.progress;

    if (progress.isActive) {
      emit(ScannerSyncing(
        scannerState: readyState,
        total: progress.totalQueued,
        synced: progress.synced + progress.alreadyScanned,
      ));
    } else {
      // Sync finished (success or failed) — return to ready
      emit(readyState.copyWith(
        offlineQueueSize: _cacheService.getEventQueueSize(readyState.eventId),
        cachedTicketCount: _cacheService.getCacheSize(readyState.eventId),
      ));
    }
  }

  // ═══════════════════════════════════
  // PREFETCH PROGRESS (from PrefetchService stream)
  // ═══════════════════════════════════

  Future<void> _onPrefetchProgressUpdated(
    _ScannerPrefetchProgressUpdated event,
    Emitter<ScannerState> emit,
  ) async {
    ScannerReady? readyState;
    if (state is ScannerReady) {
      readyState = state as ScannerReady;
    } else if (state is ScannerResultShowing) {
      // Don't interrupt result display
      return;
    }

    if (readyState == null) return;

    final progress = event.progress;

    emit(readyState.copyWith(
      isPrefetching: progress.isActive,
      cachedTicketCount: _cacheService.getCacheSize(readyState.eventId),
    ));
  }

  // ═══════════════════════════════════
  // SESSION END
  // ═══════════════════════════════════

  Future<void> _onSessionEnded(
    ScannerSessionEnded event,
    Emitter<ScannerState> emit,
  ) async {
    // Stop background services
    _syncManager.stop();
    _prefetchService.stop();

    ScannerReady? readyState;
    if (state is ScannerReady) {
      readyState = state as ScannerReady;
    } else if (state is ScannerResultShowing) {
      readyState = (state as ScannerResultShowing).scannerState;
    }

    if (readyState?.session != null) {
      try {
        await _scannerRepository.endSession(readyState!.session!.sessionId);
      } catch (_) {
        // Best effort — don't block exit
      }
    }

    emit(const ScannerInitial());
  }

  @override
  Future<void> close() {
    _connectivitySub?.cancel();
    _syncProgressSub?.cancel();
    _prefetchProgressSub?.cancel();
    _resultDismissTimer?.cancel();
    _syncManager.stop();
    _prefetchService.stop();
    return super.close();
  }
}

// ═══════════════════════════════════
// Internal events (not exposed to UI)
// ═══════════════════════════════════

class _ScannerSyncProgressUpdated extends ScannerEvent {
  final SyncProgress progress;
  const _ScannerSyncProgressUpdated(this.progress);

  @override
  List<Object?> get props => [progress.status, progress.synced];
}

class _ScannerPrefetchProgressUpdated extends ScannerEvent {
  final PrefetchProgress progress;
  const _ScannerPrefetchProgressUpdated(this.progress);

  @override
  List<Object?> get props => [progress.status, progress.fetchedTickets];
}
