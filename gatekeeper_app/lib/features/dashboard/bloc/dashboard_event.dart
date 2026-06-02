/// ═══════════════════════════════════
/// Dashboard BLoC — Events
/// ═══════════════════════════════════

import 'package:equatable/equatable.dart';

abstract class DashboardEvent extends Equatable {
  const DashboardEvent();
  @override
  List<Object?> get props => [];
}

/// Load dashboard data for an event.
class DashboardLoadRequested extends DashboardEvent {
  final String eventId;
  final String eventTitle;

  const DashboardLoadRequested({
    required this.eventId,
    required this.eventTitle,
  });

  @override
  List<Object?> get props => [eventId];
}

/// Refresh stats (pull-to-refresh or auto-refresh).
class DashboardRefreshRequested extends DashboardEvent {
  const DashboardRefreshRequested();
}

/// Manual admit a ticket.
class DashboardManualAdmitRequested extends DashboardEvent {
  final String ticketId;
  final String reason;

  const DashboardManualAdmitRequested({
    required this.ticketId,
    this.reason = 'Manual gate lead override',
  });

  @override
  List<Object?> get props => [ticketId];
}

/// Dismiss the manual admit result.
class DashboardManualAdmitDismissed extends DashboardEvent {
  const DashboardManualAdmitDismissed();
}
