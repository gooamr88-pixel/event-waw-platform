/// ═══════════════════════════════════
/// Events BLoC — Business Logic
/// ═══════════════════════════════════

import 'package:flutter_bloc/flutter_bloc.dart';

import '../../../domain/repositories/auth_repository.dart';
import '../../../domain/repositories/scanner_repository.dart';
import 'events_event.dart';
import 'events_state.dart';

class EventsBloc extends Bloc<EventsEvent, EventsState> {
  final AuthRepository _authRepository;
  final ScannerRepository _scannerRepository;

  EventsBloc({
    required AuthRepository authRepository,
    required ScannerRepository scannerRepository,
  })  : _authRepository = authRepository,
        _scannerRepository = scannerRepository,
        super(const EventsInitial()) {
    on<EventsLoadRequested>(_onLoadRequested);
    on<EventsRefreshRequested>(_onRefreshRequested);
  }

  Future<void> _onLoadRequested(
    EventsLoadRequested event,
    Emitter<EventsState> emit,
  ) async {
    emit(const EventsLoading());
    await _loadEvents(emit);
  }

  Future<void> _onRefreshRequested(
    EventsRefreshRequested event,
    Emitter<EventsState> emit,
  ) async {
    // Don't show loading for pull-to-refresh
    await _loadEvents(emit);
  }

  Future<void> _loadEvents(Emitter<EventsState> emit) async {
    try {
      final result = await _authRepository.authenticateScanner();

      if (!result.authorized) {
        emit(EventsUnauthorized(email: result.email));
        return;
      }

      final events = result.allEvents;
      emit(EventsLoaded(authResult: result, events: events));
    } catch (e) {
      String message = 'Failed to load events';
      final errorStr = e.toString();

      if (errorStr.contains('network') ||
          errorStr.contains('SocketException')) {
        message = 'No internet connection. Please check your network.';
      } else if (errorStr.contains('JWT') || errorStr.contains('401')) {
        message = 'Session expired. Please sign in again.';
      }

      emit(EventsError(message));
    }
  }
}
