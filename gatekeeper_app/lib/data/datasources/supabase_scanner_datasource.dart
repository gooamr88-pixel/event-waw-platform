/// ═══════════════════════════════════
/// EVENTSLI GATEKEEPER — Supabase Scanner Datasource
/// ═══════════════════════════════════
///
/// Handles scanner session management, ticket verification,
/// and offline scan syncing via Supabase RPCs and Edge Functions.

import 'dart:convert';
import 'package:supabase_flutter/supabase_flutter.dart';

class SupabaseScannerDatasource {
  final SupabaseClient _client;

  SupabaseScannerDatasource({required SupabaseClient client})
      : _client = client;

  /// Start a scanner session for an event.
  Future<Map<String, dynamic>> startSession({
    required String eventId,
    Map<String, dynamic>? deviceInfo,
  }) async {
    final response = await _client.rpc('start_scanner_session', params: {
      'p_event_id': eventId,
      'p_device_info': deviceInfo ?? {},
    });

    if (response is Map<String, dynamic>) {
      if (response.containsKey('error')) {
        throw Exception(response['error'] as String);
      }
      return response;
    }

    throw Exception('Unexpected response from start_scanner_session');
  }

  /// End a scanner session.
  Future<Map<String, dynamic>> endSession(String sessionId) async {
    final response = await _client.rpc('end_scanner_session', params: {
      'p_session_id': sessionId,
    });

    if (response is Map<String, dynamic>) {
      if (response.containsKey('error')) {
        throw Exception(response['error'] as String);
      }
      return response;
    }

    throw Exception('Unexpected response from end_scanner_session');
  }

  /// Verify a ticket by calling the verify-ticket Edge Function.
  /// Returns the full scan result map.
  Future<Map<String, dynamic>> verifyTicket(String qrPayload) async {
    final session = _client.auth.currentSession;
    if (session == null) {
      throw Exception('Not authenticated');
    }

    final response = await _client.functions.invoke(
      'verify-ticket',
      body: {'qr_payload': qrPayload},
    );

    if (response.status >= 400) {
      final data = response.data;
      if (data is Map<String, dynamic>) {
        // Kill-switch response (HTTP 423)
        if (response.status == 423) {
          return {
            'valid': false,
            'locked': true,
            ...data,
          };
        }
        return {
          'valid': false,
          ...data,
        };
      }
      throw Exception('Verification failed (HTTP ${response.status})');
    }

    final data = response.data;
    if (data is Map<String, dynamic>) {
      return data;
    }

    throw Exception('Invalid response from verify-ticket');
  }

  /// Sync offline scans via the sync-scans Edge Function.
  Future<Map<String, dynamic>> syncOfflineScans({
    required String eventId,
    String? sessionId,
    required List<Map<String, dynamic>> scans,
  }) async {
    final session = _client.auth.currentSession;
    if (session == null) {
      throw Exception('Not authenticated');
    }

    final response = await _client.functions.invoke(
      'sync-scans',
      body: {
        'event_id': eventId,
        'session_id': sessionId,
        'scans': scans,
      },
    );

    if (response.status >= 400) {
      final data = response.data;
      if (data is Map<String, dynamic>) {
        if (response.status == 423) {
          return {'success': false, 'locked': true, ...data};
        }
        throw Exception(
            data['error'] as String? ?? 'Sync failed (HTTP ${response.status})');
      }
      throw Exception('Sync failed (HTTP ${response.status})');
    }

    final data = response.data;
    if (data is Map<String, dynamic>) {
      return data;
    }

    throw Exception('Invalid response from sync-scans');
  }

  /// Prefetch ticket data for offline verification.
  /// Queries the tickets table directly (via RLS — organizer/gate_team can read).
  /// Returns { tickets: [...], total_count: int }
  Future<Map<String, dynamic>> prefetchTickets({
    required String eventId,
    required int page,
    required int pageSize,
  }) async {
    final session = _client.auth.currentSession;
    if (session == null) {
      throw Exception('Not authenticated');
    }

    final offset = page * pageSize;

    // Fetch tickets with relevant fields for offline cache.
    // Uses a Supabase RPC that returns ticket data scoped to
    // events the scanner is authorized for.
    try {
      final response = await _client.rpc('prefetch_event_tickets', params: {
        'p_event_id': eventId,
        'p_limit': pageSize,
        'p_offset': offset,
      });

      if (response is Map<String, dynamic>) {
        if (response.containsKey('error')) {
          throw Exception(response['error'] as String);
        }
        return response;
      }

      // RPC may return the list directly
      if (response is List) {
        return {
          'tickets': response,
          'total_count': response.length + offset,
        };
      }

      throw Exception('Unexpected response from prefetch_event_tickets');
    } catch (e) {
      // Fallback: query tickets table directly if RPC doesn't exist
      // (graceful degradation for deployments without the prefetch RPC)
      return _prefetchFallback(eventId, pageSize, offset);
    }
  }

  /// Fallback prefetch using direct table query.
  /// Requires RLS to allow gate_team/organizer SELECT on tickets.
  Future<Map<String, dynamic>> _prefetchFallback(
    String eventId,
    int pageSize,
    int offset,
  ) async {
    // First get total count
    final countResponse = await _client
        .from('tickets')
        .select('id')
        .eq('event_id', eventId)
        .inFilter('status', ['valid', 'used'])
        .count();

    final totalCount = countResponse.count;

    // Fetch page of tickets with the fields needed for offline cache
    final ticketsResponse = await _client
        .from('tickets')
        .select('''
          id,
          qr_hash,
          status,
          scan_count,
          max_scans_allowed,
          ticket_types!inner(name),
          orders!inner(buyer_name, buyer_email)
        ''')
        .eq('event_id', eventId)
        .inFilter('status', ['valid', 'used'])
        .order('created_at', ascending: true)
        .range(offset, offset + pageSize - 1);

    // Map to flat structure expected by cache
    final tickets = (ticketsResponse as List<dynamic>).map((t) {
      final ticketType = t['ticket_types'] as Map<String, dynamic>?;
      final order = t['orders'] as Map<String, dynamic>?;
      return {
        'id': t['id'],
        'qr_hash': t['qr_hash'],
        'status': t['status'],
        'scan_count': t['scan_count'] ?? 0,
        'max_scans_allowed': t['max_scans_allowed'] ?? 0,
        'tier_name': ticketType?['name'],
        'buyer_name': order?['buyer_name'] ?? order?['buyer_email'],
        'seat_label': t['seat_label'],
      };
    }).toList();

    return {
      'tickets': tickets,
      'total_count': totalCount,
    };
  }
}
