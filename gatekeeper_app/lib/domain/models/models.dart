/// ═══════════════════════════════════
/// EVENTSLI GATEKEEPER — Domain Models
/// ═══════════════════════════════════
///
/// Pure Dart models — no framework dependencies.
/// Matches the JSONB structures returned by Supabase RPCs.

import 'package:equatable/equatable.dart';

// ═══════════════════════════════════
// GateTeamAssignment
// Represents a gate team assignment returned by authenticate_scanner RPC.
// ═══════════════════════════════════

class GateTeamAssignment extends Equatable {
  final String gateTeamId;
  final String organizerId;
  final String? eventId;
  final String role; // 'scanner' or 'gate_lead'
  final String status;
  final String? eventTitle;
  final DateTime? eventDate;
  final DateTime? eventEndDate;
  final String? eventVenue;
  final String? eventCoverImage;
  final String? eventStatus;
  final String? organizerName;

  const GateTeamAssignment({
    required this.gateTeamId,
    required this.organizerId,
    this.eventId,
    this.role = 'scanner',
    this.status = 'active',
    this.eventTitle,
    this.eventDate,
    this.eventEndDate,
    this.eventVenue,
    this.eventCoverImage,
    this.eventStatus,
    this.organizerName,
  });

  factory GateTeamAssignment.fromJson(Map<String, dynamic> json) {
    return GateTeamAssignment(
      gateTeamId: json['gate_team_id'] as String,
      organizerId: json['organizer_id'] as String,
      eventId: json['event_id'] as String? ?? json['event_id_resolved'] as String?,
      role: json['role'] as String? ?? 'scanner',
      status: json['status'] as String? ?? 'active',
      eventTitle: json['event_title'] as String?,
      eventDate: json['event_date'] != null
          ? DateTime.tryParse(json['event_date'] as String)
          : null,
      eventEndDate: json['event_end_date'] != null
          ? DateTime.tryParse(json['event_end_date'] as String)
          : null,
      eventVenue: json['event_venue'] as String?,
      eventCoverImage: json['event_cover_image'] as String?,
      eventStatus: json['event_status'] as String?,
      organizerName: json['organizer_name'] as String?,
    );
  }

  bool get isGateLead => role == 'gate_lead';
  bool get isEventLive => eventStatus == 'published';

  @override
  List<Object?> get props => [gateTeamId, eventId, role, status];
}

// ═══════════════════════════════════
// OwnEvent
// An event the user organizes directly.
// ═══════════════════════════════════

class OwnEvent extends Equatable {
  final String id;
  final String title;
  final DateTime? date;
  final DateTime? endDate;
  final String? venue;
  final String? coverImage;
  final String status;

  const OwnEvent({
    required this.id,
    required this.title,
    this.date,
    this.endDate,
    this.venue,
    this.coverImage,
    this.status = 'published',
  });

  factory OwnEvent.fromJson(Map<String, dynamic> json) {
    return OwnEvent(
      id: json['id'] as String,
      title: json['title'] as String? ?? 'Untitled Event',
      date: json['date'] != null
          ? DateTime.tryParse(json['date'] as String)
          : null,
      endDate: json['end_date'] != null
          ? DateTime.tryParse(json['end_date'] as String)
          : null,
      venue: json['venue'] as String?,
      coverImage: json['cover_image'] as String?,
      status: json['status'] as String? ?? 'published',
    );
  }

  @override
  List<Object?> get props => [id, title, status];
}

// ═══════════════════════════════════
// ScannerAuthResult
// Top-level result from authenticate_scanner RPC.
// ═══════════════════════════════════

class ScannerAuthResult extends Equatable {
  final bool authorized;
  final List<GateTeamAssignment> assignments;
  final List<OwnEvent> ownEvents;
  final String userId;
  final String email;

  const ScannerAuthResult({
    required this.authorized,
    required this.assignments,
    required this.ownEvents,
    required this.userId,
    required this.email,
  });

  factory ScannerAuthResult.fromJson(Map<String, dynamic> json) {
    final assignmentsList = (json['assignments'] as List<dynamic>?)
            ?.map((e) =>
                GateTeamAssignment.fromJson(e as Map<String, dynamic>))
            .toList() ??
        [];

    final ownEventsList = (json['own_events'] as List<dynamic>?)
            ?.map((e) => OwnEvent.fromJson(e as Map<String, dynamic>))
            .toList() ??
        [];

    return ScannerAuthResult(
      authorized: json['authorized'] as bool? ?? false,
      assignments: assignmentsList,
      ownEvents: ownEventsList,
      userId: json['user_id'] as String? ?? '',
      email: json['email'] as String? ?? '',
    );
  }

  /// All scannable events — merge assignments + own events into a unified list.
  List<ScannableEvent> get allEvents {
    final events = <ScannableEvent>[];

    // Own events first
    for (final oe in ownEvents) {
      events.add(ScannableEvent(
        eventId: oe.id,
        title: oe.title,
        date: oe.date,
        endDate: oe.endDate,
        venue: oe.venue,
        coverImage: oe.coverImage,
        eventStatus: oe.status,
        role: 'organizer',
        organizerName: 'You',
      ));
    }

    // Assigned events (avoid duplicates with own events)
    final ownIds = ownEvents.map((e) => e.id).toSet();
    for (final a in assignments) {
      if (a.eventId != null && !ownIds.contains(a.eventId)) {
        events.add(ScannableEvent(
          eventId: a.eventId!,
          title: a.eventTitle ?? 'Unknown Event',
          date: a.eventDate,
          endDate: a.eventEndDate,
          venue: a.eventVenue,
          coverImage: a.eventCoverImage,
          eventStatus: a.eventStatus ?? 'published',
          role: a.role,
          organizerName: a.organizerName,
          gateTeamId: a.gateTeamId,
        ));
      }
    }

    // Sort by date descending
    events.sort((a, b) {
      if (a.date == null && b.date == null) return 0;
      if (a.date == null) return 1;
      if (b.date == null) return -1;
      return b.date!.compareTo(a.date!);
    });

    return events;
  }

  @override
  List<Object?> get props => [authorized, userId, assignments, ownEvents];
}

// ═══════════════════════════════════
// ScannableEvent
// Unified event model for the event selection screen.
// ═══════════════════════════════════

class ScannableEvent extends Equatable {
  final String eventId;
  final String title;
  final DateTime? date;
  final DateTime? endDate;
  final String? venue;
  final String? coverImage;
  final String eventStatus;
  final String role; // 'organizer', 'scanner', 'gate_lead'
  final String? organizerName;
  final String? gateTeamId;

  const ScannableEvent({
    required this.eventId,
    required this.title,
    this.date,
    this.endDate,
    this.venue,
    this.coverImage,
    this.eventStatus = 'published',
    this.role = 'scanner',
    this.organizerName,
    this.gateTeamId,
  });

  bool get isOrganizer => role == 'organizer';
  bool get isGateLead => role == 'gate_lead';
  bool get isLive => eventStatus == 'published';

  String get roleLabel {
    switch (role) {
      case 'organizer':
        return 'Organizer';
      case 'gate_lead':
        return 'Gate Lead';
      default:
        return 'Scanner';
    }
  }

  @override
  List<Object?> get props => [eventId, role];
}

// ═══════════════════════════════════
// ScannerSession
// ═══════════════════════════════════

class ScannerSession extends Equatable {
  final String sessionId;
  final String eventId;
  final String? gateTeamId;
  final DateTime startedAt;

  const ScannerSession({
    required this.sessionId,
    required this.eventId,
    this.gateTeamId,
    required this.startedAt,
  });

  factory ScannerSession.fromJson(Map<String, dynamic> json) {
    return ScannerSession(
      sessionId: json['session_id'] as String,
      eventId: json['event_id'] as String,
      gateTeamId: json['gate_team_id'] as String?,
      startedAt: json['started_at'] != null
          ? DateTime.parse(json['started_at'] as String)
          : DateTime.now(),
    );
  }

  @override
  List<Object?> get props => [sessionId, eventId];
}
