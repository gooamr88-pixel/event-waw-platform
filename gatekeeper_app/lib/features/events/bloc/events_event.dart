/// ═══════════════════════════════════
/// Events BLoC — Events (event = BLoC event, not calendar event)
/// ═══════════════════════════════════

import 'package:equatable/equatable.dart';

abstract class EventsEvent extends Equatable {
  const EventsEvent();

  @override
  List<Object?> get props => [];
}

/// Load scannable events (calls authenticate_scanner RPC).
class EventsLoadRequested extends EventsEvent {
  const EventsLoadRequested();
}

/// User selected an event to start scanning.
class EventSelected extends EventsEvent {
  final String eventId;
  final String eventTitle;

  const EventSelected({required this.eventId, required this.eventTitle});

  @override
  List<Object?> get props => [eventId, eventTitle];
}

/// Refresh events list.
class EventsRefreshRequested extends EventsEvent {
  const EventsRefreshRequested();
}
