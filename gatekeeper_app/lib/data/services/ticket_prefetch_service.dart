/// ═══════════════════════════════════
/// EVENTSLI GATEKEEPER — Ticket Prefetch Service
/// ═══════════════════════════════════
///
/// Downloads ticket data (hashes, status, scan counts) into
/// the local Hive cache when the scanner is online. This enables
/// offline verification.
///
/// Prefetch strategy:
///   1. On session start → full prefetch (all tickets for the event)
///   2. Periodic refresh → delta fetch (only tickets changed since last cache)
///   3. Cache age check → skip if cached within the last 5 minutes
///
/// Data fetched per ticket:
///   - id, qr_hash, status, scan_count, max_scans_allowed
///   - tier_name, buyer_name, seat_label
///
/// Security:
///   - HMAC secret is NEVER fetched (Q1: Option A)
///   - Only pre-computed hashes are cached for comparison
///   - All data is fetched through authenticated Supabase RPCs

import 'dart:async';

import '../../core/config/app_environment.dart';
import 'connectivity_service.dart';
import 'offline_cache_service.dart';
import '../../domain/repositories/scanner_repository.dart';

/// Status of a prefetch operation.
enum PrefetchStatus {
  idle,
  fetching,
  success,
  failed,
  skipped, // Cache is fresh enough
}

/// Prefetch progress report.
class PrefetchProgress {
  final PrefetchStatus status;
  final int totalTickets;
  final int fetchedTickets;
  final int pagesFetched;
  final String? errorMessage;
  final Duration? elapsed;

  const PrefetchProgress({
    required this.status,
    this.totalTickets = 0,
    this.fetchedTickets = 0,
    this.pagesFetched = 0,
    this.errorMessage,
    this.elapsed,
  });

  factory PrefetchProgress.idle() =>
      const PrefetchProgress(status: PrefetchStatus.idle);

  bool get isActive => status == PrefetchStatus.fetching;
  double get progress =>
      totalTickets > 0 ? fetchedTickets / totalTickets : 0;
}

class TicketPrefetchService {
  final ScannerRepository _scannerRepository;
  final OfflineCacheService _cacheService;
  final ConnectivityService _connectivityService;

  Timer? _refreshTimer;
  bool _isPrefetching = false;

  // Cache freshness threshold: 5 minutes
  static const _cacheFreshnessMinutes = 5;

  // Periodic refresh interval: 10 minutes
  static const _refreshIntervalMinutes = 10;

  // Progress stream
  final _progressController = StreamController<PrefetchProgress>.broadcast();
  Stream<PrefetchProgress> get progressStream => _progressController.stream;

  PrefetchProgress _lastProgress = PrefetchProgress.idle();
  PrefetchProgress get lastProgress => _lastProgress;

  TicketPrefetchService({
    required ScannerRepository scannerRepository,
    required OfflineCacheService cacheService,
    required ConnectivityService connectivityService,
  })  : _scannerRepository = scannerRepository,
        _cacheService = cacheService,
        _connectivityService = connectivityService;

  // ═══════════════════════════════════
  // LIFECYCLE
  // ═══════════════════════════════════

  /// Start prefetching for an event.
  /// Performs an initial full fetch, then schedules periodic refreshes.
  Future<PrefetchProgress> startForEvent(String eventId) async {
    // Initial full prefetch
    final result = await prefetch(eventId);

    // Schedule periodic refresh
    _refreshTimer?.cancel();
    _refreshTimer = Timer.periodic(
      const Duration(minutes: _refreshIntervalMinutes),
      (_) => prefetch(eventId, skipIfFresh: true),
    );

    return result;
  }

  /// Stop periodic refresh.
  void stop() {
    _refreshTimer?.cancel();
    _refreshTimer = null;
  }

  // ═══════════════════════════════════
  // PREFETCH
  // ═══════════════════════════════════

  /// Prefetch all tickets for an event into the local cache.
  ///
  /// [skipIfFresh] — If true, skip if cache was updated within
  /// the last [_cacheFreshnessMinutes] minutes.
  Future<PrefetchProgress> prefetch(
    String eventId, {
    bool skipIfFresh = false,
  }) async {
    if (_isPrefetching) return _lastProgress;
    if (!_connectivityService.isOnline) {
      return _emitProgress(const PrefetchProgress(
        status: PrefetchStatus.skipped,
      ));
    }

    // Check cache freshness
    if (skipIfFresh) {
      final lastCache = _cacheService.getLastCacheTime(eventId);
      if (lastCache != null) {
        final elapsed = DateTime.now().difference(lastCache);
        if (elapsed.inMinutes < _cacheFreshnessMinutes) {
          return _emitProgress(const PrefetchProgress(
            status: PrefetchStatus.skipped,
          ));
        }
      }
    }

    _isPrefetching = true;
    final stopwatch = Stopwatch()..start();

    _emitProgress(const PrefetchProgress(
      status: PrefetchStatus.fetching,
    ));

    try {
      int totalFetched = 0;
      int page = 0;
      bool hasMore = true;

      while (hasMore) {
        // Fetch a page of tickets
        final result = await _scannerRepository.prefetchTickets(
          eventId: eventId,
          page: page,
          pageSize: AppEnvironment.prefetchPageSize,
        );

        final tickets =
            (result['tickets'] as List<dynamic>?)?.cast<Map<String, dynamic>>() ?? [];
        final totalCount = result['total_count'] as int? ?? 0;

        if (tickets.isEmpty) {
          hasMore = false;
          break;
        }

        // Cache this batch
        await _cacheService.cacheTickets(eventId, tickets);
        totalFetched += tickets.length;
        page++;

        _emitProgress(PrefetchProgress(
          status: PrefetchStatus.fetching,
          totalTickets: totalCount,
          fetchedTickets: totalFetched,
          pagesFetched: page,
        ));

        // Check if we've fetched all tickets
        if (totalFetched >= totalCount) {
          hasMore = false;
        }
      }

      stopwatch.stop();
      _isPrefetching = false;

      return _emitProgress(PrefetchProgress(
        status: PrefetchStatus.success,
        totalTickets: totalFetched,
        fetchedTickets: totalFetched,
        pagesFetched: page,
        elapsed: stopwatch.elapsed,
      ));
    } catch (e) {
      stopwatch.stop();
      _isPrefetching = false;

      return _emitProgress(PrefetchProgress(
        status: PrefetchStatus.failed,
        errorMessage: e.toString(),
        elapsed: stopwatch.elapsed,
      ));
    }
  }

  PrefetchProgress _emitProgress(PrefetchProgress progress) {
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
