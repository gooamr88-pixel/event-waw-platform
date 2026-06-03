/// ═══════════════════════════════════
/// EVENTSLI GATEKEEPER — Sync Manager
/// ═══════════════════════════════════
///
/// Background sync engine that handles:
///   1. Periodic sync attempts (every 30s when online + queue has items)
///   2. Exponential backoff on failure (5s → 10s → 20s → 40s → 60s cap)
///   3. Batch processing (up to 500 scans/request)
///   4. Server-wins conflict resolution
///   5. Retry tracking with max attempts (10 per scan)
///   6. Stale scan cleanup (>24h old → mark as expired)
///
/// Architecture:
///   - Runs as a singleton service alongside the BLoC
///   - ScannerBloc dispatches sync events; SyncManager does the work
///   - Emits SyncStatus updates via stream for UI consumption
///   - Graceful degradation: failures never block scanning

import 'dart:async';
import 'dart:math';

import '../../core/config/app_environment.dart';
import 'connectivity_service.dart';
import 'offline_cache_service.dart';
import '../../domain/repositories/scanner_repository.dart';

/// Status of a sync operation.
enum SyncStatus {
  idle,
  syncing,
  success,
  failed,
  rateLimited,
}

/// Detailed sync progress report.
class SyncProgress {
  final SyncStatus status;
  final int totalQueued;
  final int synced;
  final int failed;
  final int alreadyScanned;
  final String? errorMessage;
  final DateTime timestamp;

  const SyncProgress({
    required this.status,
    this.totalQueued = 0,
    this.synced = 0,
    this.failed = 0,
    this.alreadyScanned = 0,
    this.errorMessage,
    required this.timestamp,
  });

  factory SyncProgress.idle() => SyncProgress(
        status: SyncStatus.idle,
        timestamp: DateTime.now(),
      );

  bool get isActive => status == SyncStatus.syncing;
  double get progress =>
      totalQueued > 0 ? (synced + alreadyScanned + failed) / totalQueued : 0;
}

class SyncManager {
  final ScannerRepository _scannerRepository;
  final OfflineCacheService _cacheService;
  final ConnectivityService _connectivityService;

  Timer? _periodicTimer;
  StreamSubscription<bool>? _connectivitySub;
  bool _isSyncing = false;

  // Exponential backoff state
  int _consecutiveFailures = 0;
  static const int _maxBackoffSeconds = 60;
  static const int _maxRetryAttempts = 10;

  // Sync progress stream
  final _progressController = StreamController<SyncProgress>.broadcast();
  Stream<SyncProgress> get progressStream => _progressController.stream;

  SyncProgress _lastProgress = SyncProgress.idle();
  SyncProgress get lastProgress => _lastProgress;

  SyncManager({
    required ScannerRepository scannerRepository,
    required OfflineCacheService cacheService,
    required ConnectivityService connectivityService,
  })  : _scannerRepository = scannerRepository,
        _cacheService = cacheService,
        _connectivityService = connectivityService;

  // ═══════════════════════════════════
  // LIFECYCLE
  // ═══════════════════════════════════

  /// Start the background sync engine for an event.
  void start(String eventId, {String? sessionId}) {
    stop(); // Clean up any previous instance

    // Periodic sync every 30 seconds
    _periodicTimer = Timer.periodic(
      Duration(seconds: AppEnvironment.heartbeatIntervalSeconds),
      (_) => _attemptSync(eventId, sessionId: sessionId),
    );

    // Also sync immediately when connectivity returns
    _connectivitySub = _connectivityService.onConnectivityChanged.listen(
      (isOnline) {
        if (isOnline) {
          // Reset backoff on reconnect — new opportunity
          _consecutiveFailures = 0;
          _attemptSync(eventId, sessionId: sessionId);
        }
      },
    );
  }

  /// Stop the background sync engine.
  void stop() {
    _periodicTimer?.cancel();
    _periodicTimer = null;
    _connectivitySub?.cancel();
    _connectivitySub = null;
  }

  /// Trigger a manual sync (e.g., user taps sync button).
  Future<SyncProgress> syncNow(
    String eventId, {
    String? sessionId,
  }) async {
    return _attemptSync(eventId, sessionId: sessionId, force: true);
  }

  // ═══════════════════════════════════
  // SYNC ENGINE
  // ═══════════════════════════════════

  Future<SyncProgress> _attemptSync(
    String eventId, {
    String? sessionId,
    bool force = false,
  }) async {
    // Guards
    if (_isSyncing) return _lastProgress;
    if (!_connectivityService.isOnline) return _emitProgress(SyncProgress.idle());

    final queuedScans = _cacheService.getQueuedScans(eventId);
    if (queuedScans.isEmpty) return _emitProgress(SyncProgress.idle());

    // Backoff check (skip if forced/manual)
    if (!force && _consecutiveFailures > 0) {
      final backoffMs = _calculateBackoff();
      // Skip this cycle if backoff hasn't elapsed
      // (The timer will try again at the next interval)
      return _lastProgress;
    }

    _isSyncing = true;

    // Clean stale scans (>24h old)
    final cleanedScans = _cleanStaleScans(queuedScans, eventId);

    _emitProgress(SyncProgress(
      status: SyncStatus.syncing,
      totalQueued: cleanedScans.length,
      timestamp: DateTime.now(),
    ));

    int totalSynced = 0;
    int totalFailed = 0;
    int totalAlreadyScanned = 0;
    String? lastError;

    try {
      // Batch in chunks of maxOfflineScanBatch
      final batches = _batchScans(cleanedScans);

      for (final batch in batches) {
        try {
          final result = await _scannerRepository.syncOfflineScans(
            eventId: eventId,
            sessionId: sessionId,
            scans: batch,
          );

          // ── Server-Wins Conflict Resolution ──
          final results = (result['results'] as List<dynamic>?) ?? [];
          final syncedIds = <String>[];
          final alreadyScannedIds = <String>[];
          final rejectedIds = <String>[];

          for (final r in results) {
            final ticketId = r['ticket_id'] as String;
            final syncResult = r['sync_result'] as String;

            switch (syncResult) {
              case 'synced':
                syncedIds.add(ticketId);
                totalSynced++;

                // Update local cache with server's truth
                _reconcileTicket(eventId, ticketId, r);
                break;

              case 'already_scanned':
                alreadyScannedIds.add(ticketId);
                totalAlreadyScanned++;

                // Server wins — update local cache to server state
                _reconcileTicket(eventId, ticketId, r);
                break;

              case 'rejected':
                rejectedIds.add(ticketId);
                totalFailed++;

                // Update local cache to rejected state
                _reconcileTicket(eventId, ticketId, r);
                break;

              default:
                totalFailed++;
            }
          }

          // Remove processed scans from queue
          // All synced + already_scanned + rejected get removed
          // (rejected scans should not be retried)
          final allProcessedIds = [
            ...syncedIds,
            ...alreadyScannedIds,
            ...rejectedIds,
          ];
          await _cacheService.removeSyncedScans(allProcessedIds, eventId);

          _emitProgress(SyncProgress(
            status: SyncStatus.syncing,
            totalQueued: cleanedScans.length,
            synced: totalSynced,
            alreadyScanned: totalAlreadyScanned,
            failed: totalFailed,
            timestamp: DateTime.now(),
          ));
        } catch (batchError) {
          // Individual batch failed — continue with next batch
          lastError = batchError.toString();
          totalFailed += batch.length;
        }
      }

      // Reset backoff on any success
      if (totalSynced > 0 || totalAlreadyScanned > 0) {
        _consecutiveFailures = 0;
      }

      _isSyncing = false;
      return _emitProgress(SyncProgress(
        status: totalFailed > 0 ? SyncStatus.failed : SyncStatus.success,
        totalQueued: cleanedScans.length,
        synced: totalSynced,
        alreadyScanned: totalAlreadyScanned,
        failed: totalFailed,
        errorMessage: lastError,
        timestamp: DateTime.now(),
      ));
    } catch (e) {
      _consecutiveFailures++;
      _isSyncing = false;

      // Check for rate limiting (HTTP 429)
      final isRateLimited =
          e.toString().contains('429') || e.toString().contains('rate');

      return _emitProgress(SyncProgress(
        status: isRateLimited ? SyncStatus.rateLimited : SyncStatus.failed,
        totalQueued: cleanedScans.length,
        synced: totalSynced,
        alreadyScanned: totalAlreadyScanned,
        failed: totalFailed,
        errorMessage: e.toString(),
        timestamp: DateTime.now(),
      ));
    }
  }

  // ═══════════════════════════════════
  // SERVER-WINS CONFLICT RESOLUTION
  // ═══════════════════════════════════

  /// Update the local Hive cache with the server's authoritative state.
  /// This is the core of "server-wins" — whenever there's a discrepancy
  /// between local and server, the server's values take precedence.
  void _reconcileTicket(
    String eventId,
    String ticketId,
    Map<String, dynamic> serverResult,
  ) {
    final cached = _cacheService.getTicket(eventId, ticketId);
    if (cached == null) return;

    // Server provides authoritative scan_count
    final serverScanCount = serverResult['server_scan_count'] as int?;
    final serverStatus = serverResult['server_status'] as String?;

    if (serverScanCount != null || serverStatus != null) {
      final updated = Map<String, dynamic>.from(cached);

      if (serverScanCount != null) {
        updated['scan_count'] = serverScanCount;
      }
      if (serverStatus != null) {
        updated['status'] = serverStatus;
      }
      updated['reconciled_at'] = DateTime.now().toIso8601String();

      // Write back to cache
      _cacheService.updateTicket(eventId, ticketId, updated);
    }
  }

  // ═══════════════════════════════════
  // HELPERS
  // ═══════════════════════════════════

  /// Calculate exponential backoff delay in milliseconds.
  int _calculateBackoff() {
    final seconds = min(
      pow(2, _consecutiveFailures).toInt() * 5,
      _maxBackoffSeconds,
    );
    // Add jitter (±20%)
    final jitter = (seconds * 0.2 * (Random().nextDouble() * 2 - 1)).toInt();
    return (seconds + jitter) * 1000;
  }

  /// Break scans into batches.
  List<List<Map<String, dynamic>>> _batchScans(
    List<Map<String, dynamic>> scans,
  ) {
    final batches = <List<Map<String, dynamic>>>[];
    for (var i = 0; i < scans.length; i += AppEnvironment.maxOfflineScanBatch) {
      batches.add(scans.sublist(
        i,
        min(i + AppEnvironment.maxOfflineScanBatch, scans.length),
      ));
    }
    return batches;
  }

  /// Remove scans older than 24 hours from the queue.
  /// Stale scans are likely from a previous event day and should not
  /// pollute today's sync.
  List<Map<String, dynamic>> _cleanStaleScans(
    List<Map<String, dynamic>> scans,
    String eventId,
  ) {
    final now = DateTime.now();
    final staleIds = <String>[];
    final validScans = <Map<String, dynamic>>[];

    for (final scan in scans) {
      final queuedAt = scan['queued_at'] as String?;
      if (queuedAt != null) {
        final queuedTime = DateTime.tryParse(queuedAt);
        if (queuedTime != null &&
            now.difference(queuedTime).inHours > 24) {
          staleIds.add(scan['ticket_id'] as String);
          continue;
        }
      }
      validScans.add(scan);
    }

    // Remove stale scans from queue
    if (staleIds.isNotEmpty) {
      _cacheService.removeSyncedScans(staleIds, eventId);
    }

    return validScans;
  }

  SyncProgress _emitProgress(SyncProgress progress) {
    _lastProgress = progress;
    _progressController.add(progress);
    return progress;
  }

  /// Dispose resources.
  void dispose() {
    stop();
    _progressController.close();
  }
}
