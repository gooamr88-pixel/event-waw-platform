/// ═══════════════════════════════════
/// Scanner Repository — Implementation
/// ═══════════════════════════════════

import '../../domain/models/models.dart';
import '../../domain/repositories/scanner_repository.dart';
import '../datasources/supabase_scanner_datasource.dart';

class ScannerRepositoryImpl implements ScannerRepository {
  final SupabaseScannerDatasource _datasource;

  ScannerRepositoryImpl({required SupabaseScannerDatasource datasource})
      : _datasource = datasource;

  @override
  Future<ScannerSession> startSession({
    required String eventId,
    Map<String, dynamic>? deviceInfo,
  }) async {
    final raw = await _datasource.startSession(
      eventId: eventId,
      deviceInfo: deviceInfo,
    );
    return ScannerSession.fromJson(raw);
  }

  @override
  Future<void> endSession(String sessionId) async {
    await _datasource.endSession(sessionId);
  }

  @override
  Future<Map<String, dynamic>> verifyTicket(String qrPayload) async {
    return _datasource.verifyTicket(qrPayload);
  }

  @override
  Future<Map<String, dynamic>> syncOfflineScans({
    required String eventId,
    String? sessionId,
    required List<Map<String, dynamic>> scans,
  }) async {
    return _datasource.syncOfflineScans(
      eventId: eventId,
      sessionId: sessionId,
      scans: scans,
    );
  }

  @override
  Future<Map<String, dynamic>> prefetchTickets({
    required String eventId,
    required int page,
    required int pageSize,
  }) async {
    return _datasource.prefetchTickets(
      eventId: eventId,
      page: page,
      pageSize: pageSize,
    );
  }
}
