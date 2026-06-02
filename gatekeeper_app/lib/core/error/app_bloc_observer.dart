/// ═══════════════════════════════════
/// EVENTSLI GATEKEEPER — BLoC Observer
/// ═══════════════════════════════════
///
/// Observes all BLoC lifecycle events for:
///   - Debug logging (state transitions)
///   - Error capture and forwarding to GlobalErrorHandler
///   - Performance monitoring (transition timing)

import 'package:flutter/foundation.dart';
import 'package:flutter_bloc/flutter_bloc.dart';

import 'global_error_handler.dart';

class AppBlocObserver extends BlocObserver {
  @override
  void onCreate(BlocBase bloc) {
    super.onCreate(bloc);
    if (kDebugMode) {
      debugPrint('🟢 BLoC created: ${bloc.runtimeType}');
    }
  }

  @override
  void onTransition(Bloc bloc, Transition transition) {
    super.onTransition(bloc, transition);
    if (kDebugMode) {
      debugPrint(
        '🔄 ${bloc.runtimeType}: '
        '${transition.currentState.runtimeType} → '
        '${transition.nextState.runtimeType}',
      );
    }
  }

  @override
  void onError(BlocBase bloc, Object error, StackTrace stackTrace) {
    super.onError(bloc, error, stackTrace);
    GlobalErrorHandler.reportError(
      error,
      stackTrace,
      context: 'BLoC: ${bloc.runtimeType}',
    );
  }

  @override
  void onClose(BlocBase bloc) {
    super.onClose(bloc);
    if (kDebugMode) {
      debugPrint('🔴 BLoC closed: ${bloc.runtimeType}');
    }
  }
}
