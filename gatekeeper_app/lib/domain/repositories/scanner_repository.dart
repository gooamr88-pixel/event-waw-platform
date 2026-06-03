/// ═══════════════════════════════════
/// Scanner Repository — Contract
/// ═══════════════════════════════════

import '../../domain/models/models.dart';

abstract class ScannerRepository {
  /// Start a scanner session for an event.
  Future<ScannerSession> startSession({
    required String eventId,
    Map<String, dynamic>? deviceInfo,
  });

  /// End a scanner session.
  Future<void> endSession(String sessionId);

  /// Verify a ticket online via the verify-ticket Edge Function.
  Future<Map<String, dynamic>> verifyTicket(String qrPayload);

  /// Sync offline scans via the sync-scans Edge Function.
  Future<Map<String, dynamic>> syncOfflineScans({
    required String eventId,
    String? sessionId,
    required List<Map<String, dynamic>> scans,
  });

  /// Prefetch ticket data for offline verification.
  /// Returns { tickets: [...], total_count: int }
  Future<Map<String, dynamic>> prefetchTickets({
    required String eventId,
    required int page,
    required int pageSize,
  });
}
