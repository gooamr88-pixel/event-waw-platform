/// ═══════════════════════════════════
/// Dashboard BLoC — States
/// ═══════════════════════════════════

import 'package:equatable/equatable.dart';

// ── Data Models ──

class EventScanStats extends Equatable {
  final int totalTickets;
  final int totalScans;
  final int uniqueAdmissions;
  final int reEntries;
  final int cancelled;
  final int ticketsRemaining;
  final double admissionRate;
  final List<HourlyBucket> hourlyHistogram;
  final List<TierBreakdown> byTier;
  final DateTime fetchedAt;

  const EventScanStats({
    required this.totalTickets,
    required this.totalScans,
    required this.uniqueAdmissions,
    required this.reEntries,
    required this.cancelled,
    required this.ticketsRemaining,
    required this.admissionRate,
    required this.hourlyHistogram,
    required this.byTier,
    required this.fetchedAt,
  });

  factory EventScanStats.fromJson(Map<String, dynamic> json) {
    return EventScanStats(
      totalTickets: (json['total_tickets'] as int?) ?? 0,
      totalScans: (json['total_scans'] as int?) ?? 0,
      uniqueAdmissions: (json['unique_admissions'] as int?) ?? 0,
      reEntries: (json['re_entries'] as int?) ?? 0,
      cancelled: (json['cancelled'] as int?) ?? 0,
      ticketsRemaining: (json['tickets_remaining'] as int?) ?? 0,
      admissionRate: (json['admission_rate'] as num?)?.toDouble() ?? 0,
      hourlyHistogram: ((json['hourly_histogram'] as List<dynamic>?) ?? [])
          .map((e) => HourlyBucket.fromJson(e as Map<String, dynamic>))
          .toList(),
      byTier: ((json['by_tier'] as List<dynamic>?) ?? [])
          .map((e) => TierBreakdown.fromJson(e as Map<String, dynamic>))
          .toList(),
      fetchedAt: DateTime.tryParse(json['fetched_at'] as String? ?? '') ??
          DateTime.now(),
    );
  }

  @override
  List<Object?> get props => [totalScans, uniqueAdmissions, fetchedAt];
}

class HourlyBucket extends Equatable {
  final String hour;
  final int count;

  const HourlyBucket({required this.hour, required this.count});

  factory HourlyBucket.fromJson(Map<String, dynamic> json) {
    return HourlyBucket(
      hour: json['hour'] as String? ?? '00:00',
      count: (json['count'] as int?) ?? 0,
    );
  }

  @override
  List<Object?> get props => [hour, count];
}

class TierBreakdown extends Equatable {
  final String tierName;
  final int total;
  final int scanned;
  final int remaining;

  const TierBreakdown({
    required this.tierName,
    required this.total,
    required this.scanned,
    required this.remaining,
  });

  double get scanRate => total > 0 ? scanned / total : 0;

  factory TierBreakdown.fromJson(Map<String, dynamic> json) {
    return TierBreakdown(
      tierName: json['tier_name'] as String? ?? 'Unknown',
      total: (json['total'] as int?) ?? 0,
      scanned: (json['scanned'] as int?) ?? 0,
      remaining: (json['remaining'] as int?) ?? 0,
    );
  }

  @override
  List<Object?> get props => [tierName, total, scanned];
}

class TeamMember extends Equatable {
  final String id;
  final String staffName;
  final String staffEmail;
  final String role;
  final String status;
  final String? deviceId;
  final DateTime? lastActiveAt;
  final bool isOnline;
  final TeamMemberSession? session;

  const TeamMember({
    required this.id,
    required this.staffName,
    required this.staffEmail,
    required this.role,
    required this.status,
    this.deviceId,
    this.lastActiveAt,
    required this.isOnline,
    this.session,
  });

  bool get isGateLead => role == 'gate_lead';

  factory TeamMember.fromJson(Map<String, dynamic> json) {
    return TeamMember(
      id: json['id'] as String? ?? '',
      staffName: json['staff_name'] as String? ?? 'Unknown',
      staffEmail: json['staff_email'] as String? ?? '',
      role: json['role'] as String? ?? 'scanner',
      status: json['status'] as String? ?? 'invited',
      deviceId: json['device_id'] as String?,
      lastActiveAt: json['last_active_at'] != null
          ? DateTime.tryParse(json['last_active_at'] as String)
          : null,
      isOnline: json['is_online'] as bool? ?? false,
      session: json['session'] != null
          ? TeamMemberSession.fromJson(json['session'] as Map<String, dynamic>)
          : null,
    );
  }

  @override
  List<Object?> get props => [id, isOnline, session];
}

class TeamMemberSession extends Equatable {
  final String sessionId;
  final DateTime? startedAt;
  final int totalScans;
  final int successfulScans;
  final int rejectedScans;
  final bool isActive;

  const TeamMemberSession({
    required this.sessionId,
    this.startedAt,
    required this.totalScans,
    required this.successfulScans,
    required this.rejectedScans,
    required this.isActive,
  });

  factory TeamMemberSession.fromJson(Map<String, dynamic> json) {
    return TeamMemberSession(
      sessionId: json['session_id'] as String? ?? '',
      startedAt: json['started_at'] != null
          ? DateTime.tryParse(json['started_at'] as String)
          : null,
      totalScans: (json['total_scans'] as int?) ?? 0,
      successfulScans: (json['successful_scans'] as int?) ?? 0,
      rejectedScans: (json['rejected_scans'] as int?) ?? 0,
      isActive: json['is_active'] as bool? ?? false,
    );
  }

  @override
  List<Object?> get props => [sessionId, totalScans];
}

class ManualAdmitResult extends Equatable {
  final bool success;
  final String message;
  final String? buyerName;
  final String? tierName;

  const ManualAdmitResult({
    required this.success,
    required this.message,
    this.buyerName,
    this.tierName,
  });

  @override
  List<Object?> get props => [success, message];
}

// ── BLoC States ──

abstract class DashboardState extends Equatable {
  const DashboardState();
  @override
  List<Object?> get props => [];
}

class DashboardInitial extends DashboardState {
  const DashboardInitial();
}

class DashboardLoading extends DashboardState {
  const DashboardLoading();
}

class DashboardLoaded extends DashboardState {
  final String eventId;
  final String eventTitle;
  final EventScanStats stats;
  final List<TeamMember> team;
  final int onlineCount;
  final bool isRefreshing;
  final ManualAdmitResult? admitResult;

  const DashboardLoaded({
    required this.eventId,
    required this.eventTitle,
    required this.stats,
    required this.team,
    required this.onlineCount,
    this.isRefreshing = false,
    this.admitResult,
  });

  DashboardLoaded copyWith({
    EventScanStats? stats,
    List<TeamMember>? team,
    int? onlineCount,
    bool? isRefreshing,
    ManualAdmitResult? admitResult,
    bool clearAdmitResult = false,
  }) {
    return DashboardLoaded(
      eventId: eventId,
      eventTitle: eventTitle,
      stats: stats ?? this.stats,
      team: team ?? this.team,
      onlineCount: onlineCount ?? this.onlineCount,
      isRefreshing: isRefreshing ?? this.isRefreshing,
      admitResult: clearAdmitResult ? null : (admitResult ?? this.admitResult),
    );
  }

  @override
  List<Object?> get props => [stats, team, onlineCount, isRefreshing, admitResult];
}

class DashboardError extends DashboardState {
  final String message;
  const DashboardError(this.message);

  @override
  List<Object?> get props => [message];
}
