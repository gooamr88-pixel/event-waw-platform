/// ═══════════════════════════════════
/// EVENTSLI GATEKEEPER — Offline Cache Service
/// ═══════════════════════════════════
///
/// Uses Hive for local persistence of:
///   1. Ticket hash cache (for offline HMAC validation)
///   2. Offline scan queue (scans made while disconnected)
///
/// Key design decisions from the master plan:
///   - The HMAC secret is NEVER stored on device (Q1: Option A)
///   - Offline cache stores pre-computed hashes for comparison
///   - Scan queue is FIFO — synced in order when back online
///   - Server-wins conflict resolution

import 'package:hive_ce_flutter/hive_ce_flutter.dart';

class OfflineCacheService {
  static const String _ticketCacheBox = 'ticket_cache';
  static const String _scanQueueBox = 'scan_queue';
  static const String _metadataBox = 'cache_metadata';

  late Box<Map> _ticketCache;
  late Box<Map> _scanQueue;
  late Box _metadata;

  bool _isInitialized = false;

  /// Initialize Hive boxes.
  Future<void> init() async {
    if (_isInitialized) return;

    _ticketCache = await Hive.openBox<Map>(_ticketCacheBox);
    _scanQueue = await Hive.openBox<Map>(_scanQueueBox);
    _metadata = await Hive.openBox(_metadataBox);
    _isInitialized = true;
  }

  // ═══════════════════════════════════
  // TICKET HASH CACHE
  // ═══════════════════════════════════

  /// Cache a batch of ticket data for offline verification.
  /// Called during prefetch when scanner is online.
  ///
  /// Each entry: { ticket_id: { hash, status, scan_count, max_scans, tier_name, buyer_name, seat_label } }
  Future<void> cacheTickets(String eventId, List<Map<String, dynamic>> tickets) async {
    await init();

    for (final ticket in tickets) {
      final ticketId = ticket['id'] as String;
      await _ticketCache.put('${eventId}_$ticketId', {
        'ticket_id': ticketId,
        'event_id': eventId,
        'hash': ticket['qr_hash'],
        'status': ticket['status'],
        'scan_count': ticket['scan_count'] ?? 0,
        'max_scans': ticket['max_scans_allowed'] ?? 0,
        'tier_name': ticket['tier_name'],
        'buyer_name': ticket['buyer_name'],
        'seat_label': ticket['seat_label'],
        'cached_at': DateTime.now().toIso8601String(),
      });
    }

    // Track when this event was last cached
    await _metadata.put('last_cache_$eventId', DateTime.now().toIso8601String());
  }

  /// Look up a ticket in the local cache.
  Map<String, dynamic>? getTicket(String eventId, String ticketId) {
    if (!_isInitialized) return null;
    final data = _ticketCache.get('${eventId}_$ticketId');
    return data?.cast<String, dynamic>();
  }

  /// Verify a QR hash against the local cache.
  /// Returns a result map similar to the server response,
  /// or null if the ticket is not in cache.
  Map<String, dynamic>? verifyOffline({
    required String eventId,
    required String ticketId,
    required String hash,
  }) {
    final cached = getTicket(eventId, ticketId);
    if (cached == null) return null;

    // Hash mismatch → forgery
    if (cached['hash'] != hash) {
      return {
        'valid': false,
        'scan_result': 'rejected',
        'message': 'Invalid ticket signature (offline check)',
        'is_offline': true,
      };
    }

    // Status check
    final status = cached['status'] as String?;
    if (status == 'cancelled' || status == 'revoked' || status == 'refunded') {
      return {
        'valid': false,
        'scan_result': 'rejected',
        'message': 'Ticket is $status',
        'is_offline': true,
      };
    }

    // Scan limit check
    final scanCount = (cached['scan_count'] as int?) ?? 0;
    final maxScans = (cached['max_scans'] as int?) ?? 0;
    final isUnlimited = maxScans == 0;

    if (!isUnlimited && scanCount >= maxScans) {
      return {
        'valid': false,
        'scan_result': 'rejected',
        'message': 'Maximum entries reached ($maxScans)',
        'is_offline': true,
        'scan_count': scanCount,
        'max_scans': maxScans,
      };
    }

    // Determine result type
    final scanResult = scanCount == 0 ? 'admitted' : 're_entry';
    final newCount = scanCount + 1;

    // Update local cache counters
    _ticketCache.put('${eventId}_$ticketId', {
      ...cached,
      'scan_count': newCount,
      'status': (!isUnlimited && newCount >= maxScans) ? 'used' : 'valid',
    });

    return {
      'valid': true,
      'scan_result': scanResult,
      'message': scanResult == 'admitted' ? 'Welcome! First entry.' : 'Re-entry confirmed.',
      'is_offline': true,
      'buyer_name': cached['buyer_name'] ?? 'Guest',
      'tier_name': cached['tier_name'],
      'seat_label': cached['seat_label'],
      'scan_count': newCount,
      'max_scans': maxScans,
      'scans_remaining': isUnlimited ? -1 : (maxScans - newCount),
      'is_unlimited': isUnlimited,
    };
  }

  /// Get the number of cached tickets for an event.
  int getCacheSize(String eventId) {
    if (!_isInitialized) return 0;
    return _ticketCache.keys.where((k) => k.toString().startsWith('${eventId}_')).length;
  }

  /// Clear the ticket cache for an event.
  Future<void> clearEventCache(String eventId) async {
    await init();
    final keys = _ticketCache.keys
        .where((k) => k.toString().startsWith('${eventId}_'))
        .toList();
    for (final key in keys) {
      await _ticketCache.delete(key);
    }
  }

  /// Update a single ticket in the cache (server-wins reconciliation).
  /// Called by SyncManager after sync to apply server's authoritative state.
  Future<void> updateTicket(
    String eventId,
    String ticketId,
    Map<String, dynamic> data,
  ) async {
    await init();
    await _ticketCache.put('${eventId}_$ticketId', data);
  }

  // ═══════════════════════════════════
  // OFFLINE SCAN QUEUE
  // ═══════════════════════════════════

  /// Add a scan to the offline queue.
  Future<void> queueScan({
    required String eventId,
    required String ticketId,
    required String deviceInfo,
  }) async {
    await init();

    final key = '${DateTime.now().microsecondsSinceEpoch}_$ticketId';
    await _scanQueue.put(key, {
      'ticket_id': ticketId,
      'event_id': eventId,
      'scanned_at': DateTime.now().toIso8601String(),
      'device_info': deviceInfo,
      'queued_at': DateTime.now().toIso8601String(),
    });
  }

  /// Get all queued scans for an event.
  List<Map<String, dynamic>> getQueuedScans(String eventId) {
    if (!_isInitialized) return [];
    return _scanQueue.values
        .where((entry) => entry['event_id'] == eventId)
        .map((e) => e.cast<String, dynamic>())
        .toList();
  }

  /// Get total queue size across all events.
  int get totalQueueSize => _isInitialized ? _scanQueue.length : 0;

  /// Get queue size for a specific event.
  int getEventQueueSize(String eventId) {
    if (!_isInitialized) return 0;
    return _scanQueue.values
        .where((entry) => entry['event_id'] == eventId)
        .length;
  }

  /// Remove synced scans from the queue.
  Future<void> removeSyncedScans(List<String> ticketIds, String eventId) async {
    await init();
    final keysToRemove = <dynamic>[];
    for (final entry in _scanQueue.toMap().entries) {
      final data = entry.value;
      if (data['event_id'] == eventId &&
          ticketIds.contains(data['ticket_id'])) {
        keysToRemove.add(entry.key);
      }
    }
    for (final key in keysToRemove) {
      await _scanQueue.delete(key);
    }
  }

  /// Clear the entire scan queue for an event.
  Future<void> clearEventQueue(String eventId) async {
    await init();
    final keys = _scanQueue.toMap()
        .entries
        .where((e) => e.value['event_id'] == eventId)
        .map((e) => e.key)
        .toList();
    for (final key in keys) {
      await _scanQueue.delete(key);
    }
  }

  // ═══════════════════════════════════
  // METADATA
  // ═══════════════════════════════════

  /// Get the last cache time for an event.
  DateTime? getLastCacheTime(String eventId) {
    if (!_isInitialized) return null;
    final str = _metadata.get('last_cache_$eventId') as String?;
    return str != null ? DateTime.tryParse(str) : null;
  }

  /// Close all boxes.
  Future<void> close() async {
    if (!_isInitialized) return;
    await _ticketCache.close();
    await _scanQueue.close();
    await _metadata.close();
    _isInitialized = false;
  }
}
