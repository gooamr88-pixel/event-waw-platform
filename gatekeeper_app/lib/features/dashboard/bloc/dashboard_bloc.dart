/// ═══════════════════════════════════
/// Dashboard BLoC — Business Logic
/// ═══════════════════════════════════
///
/// Manages the Gate Lead Dashboard:
///   - Auto-refresh every 15 seconds
///   - Parallel stats + team fetch
///   - Manual admit with optimistic UI feedback

import 'dart:async';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

import 'dashboard_event.dart';
import 'dashboard_state.dart';

class DashboardBloc extends Bloc<DashboardEvent, DashboardState> {
  final SupabaseClient _client;
  Timer? _autoRefreshTimer;
  String? _eventId;

  static const _refreshIntervalSeconds = 15;

  DashboardBloc({required SupabaseClient client})
      : _client = client,
        super(const DashboardInitial()) {
    on<DashboardLoadRequested>(_onLoad);
    on<DashboardRefreshRequested>(_onRefresh);
    on<DashboardManualAdmitRequested>(_onManualAdmit);
    on<DashboardManualAdmitDismissed>(_onAdmitDismissed);
  }

  // ═══════════════════════════════════
  // LOAD
  // ═══════════════════════════════════

  Future<void> _onLoad(
    DashboardLoadRequested event,
    Emitter<DashboardState> emit,
  ) async {
    _eventId = event.eventId;
    emit(const DashboardLoading());

    try {
      final results = await Future.wait([
        _fetchStats(event.eventId),
        _fetchTeam(event.eventId),
      ]);

      final statsJson = results[0] as Map<String, dynamic>;
      final teamJson = results[1] as Map<String, dynamic>;

      if (statsJson.containsKey('error')) {
        emit(DashboardError(statsJson['error'] as String));
        return;
      }

      emit(DashboardLoaded(
        eventId: event.eventId,
        eventTitle: event.eventTitle,
        stats: EventScanStats.fromJson(statsJson),
        team: _parseTeam(teamJson),
        onlineCount: (teamJson['online_count'] as int?) ?? 0,
      ));

      // Start auto-refresh
      _startAutoRefresh();
    } catch (e) {
      emit(DashboardError(e.toString()));
    }
  }

  // ═══════════════════════════════════
  // REFRESH
  // ═══════════════════════════════════

  Future<void> _onRefresh(
    DashboardRefreshRequested event,
    Emitter<DashboardState> emit,
  ) async {
    final currentState = state;
    if (currentState is! DashboardLoaded) return;

    emit(currentState.copyWith(isRefreshing: true));

    try {
      final results = await Future.wait([
        _fetchStats(currentState.eventId),
        _fetchTeam(currentState.eventId),
      ]);

      final statsJson = results[0] as Map<String, dynamic>;
      final teamJson = results[1] as Map<String, dynamic>;

      if (!statsJson.containsKey('error')) {
        emit(currentState.copyWith(
          stats: EventScanStats.fromJson(statsJson),
          team: _parseTeam(teamJson),
          onlineCount: (teamJson['online_count'] as int?) ?? 0,
          isRefreshing: false,
        ));
      } else {
        emit(currentState.copyWith(isRefreshing: false));
      }
    } catch (_) {
      emit(currentState.copyWith(isRefreshing: false));
    }
  }

  // ═══════════════════════════════════
  // MANUAL ADMIT
  // ═══════════════════════════════════

  Future<void> _onManualAdmit(
    DashboardManualAdmitRequested event,
    Emitter<DashboardState> emit,
  ) async {
    final currentState = state;
    if (currentState is! DashboardLoaded) return;

    try {
      final response = await _client.rpc('manual_admit_ticket', params: {
        'p_event_id': currentState.eventId,
        'p_ticket_id': event.ticketId,
        'p_reason': event.reason,
      });

      final data = response as Map<String, dynamic>;
      final success = data['success'] as bool? ?? false;

      emit(currentState.copyWith(
        admitResult: ManualAdmitResult(
          success: success,
          message: (data['message'] ?? data['error'] ?? 'Unknown') as String,
          buyerName: data['buyer_name'] as String?,
          tierName: data['tier_name'] as String?,
        ),
      ));

      // Refresh stats after manual admit
      if (success) {
        add(const DashboardRefreshRequested());
      }
    } catch (e) {
      emit(currentState.copyWith(
        admitResult: ManualAdmitResult(
          success: false,
          message: 'Failed: ${e.toString()}',
        ),
      ));
    }
  }

  Future<void> _onAdmitDismissed(
    DashboardManualAdmitDismissed event,
    Emitter<DashboardState> emit,
  ) async {
    final currentState = state;
    if (currentState is DashboardLoaded) {
      emit(currentState.copyWith(clearAdmitResult: true));
    }
  }

  // ═══════════════════════════════════
  // DATA FETCHING
  // ═══════════════════════════════════

  Future<Map<String, dynamic>> _fetchStats(String eventId) async {
    final response = await _client.rpc('get_event_scan_stats', params: {
      'p_event_id': eventId,
    });
    return response as Map<String, dynamic>;
  }

  Future<Map<String, dynamic>> _fetchTeam(String eventId) async {
    final response = await _client.rpc('get_scanner_team_status', params: {
      'p_event_id': eventId,
    });
    return response as Map<String, dynamic>;
  }

  List<TeamMember> _parseTeam(Map<String, dynamic> json) {
    final teamList = (json['team'] as List<dynamic>?) ?? [];
    return teamList
        .map((e) => TeamMember.fromJson(e as Map<String, dynamic>))
        .toList();
  }

  // ═══════════════════════════════════
  // AUTO-REFRESH
  // ═══════════════════════════════════

  void _startAutoRefresh() {
    _autoRefreshTimer?.cancel();
    _autoRefreshTimer = Timer.periodic(
      const Duration(seconds: _refreshIntervalSeconds),
      (_) => add(const DashboardRefreshRequested()),
    );
  }

  @override
  Future<void> close() {
    _autoRefreshTimer?.cancel();
    return super.close();
  }
}
