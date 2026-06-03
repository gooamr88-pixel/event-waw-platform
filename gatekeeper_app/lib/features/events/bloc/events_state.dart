/// ═══════════════════════════════════
/// Events BLoC — States
/// ═══════════════════════════════════

import 'package:equatable/equatable.dart';
import '../../../domain/models/models.dart';

abstract class EventsState extends Equatable {
  const EventsState();

  @override
  List<Object?> get props => [];
}

class EventsInitial extends EventsState {
  const EventsInitial();
}

class EventsLoading extends EventsState {
  const EventsLoading();
}

/// Events loaded — shows event selection screen.
class EventsLoaded extends EventsState {
  final ScannerAuthResult authResult;
  final List<ScannableEvent> events;

  const EventsLoaded({required this.authResult, required this.events});

  @override
  List<Object?> get props => [authResult, events];
}

/// No events — user is not a gate team member or organizer.
class EventsUnauthorized extends EventsState {
  final String email;

  const EventsUnauthorized({required this.email});

  @override
  List<Object?> get props => [email];
}

/// Error loading events.
class EventsError extends EventsState {
  final String message;

  const EventsError(this.message);

  @override
  List<Object?> get props => [message];
}
