/// ═══════════════════════════════════
/// Auth BLoC — Business Logic
/// ═══════════════════════════════════

import 'dart:async';
import 'package:flutter_bloc/flutter_bloc.dart';

import '../../../domain/repositories/auth_repository.dart';
import 'auth_event.dart';
import 'auth_state.dart';

class AuthBloc extends Bloc<AuthEvent, AuthState> {
  final AuthRepository _authRepository;
  StreamSubscription? _authSubscription;

  AuthBloc({required AuthRepository authRepository})
      : _authRepository = authRepository,
        super(const AuthInitial()) {
    on<AuthCheckRequested>(_onCheckRequested);
    on<AuthSignInRequested>(_onSignInRequested);
    on<AuthSignOutRequested>(_onSignOutRequested);
  }

  Future<void> _onCheckRequested(
    AuthCheckRequested event,
    Emitter<AuthState> emit,
  ) async {
    emit(const AuthLoading());

    final user = _authRepository.currentUser;
    if (user != null) {
      emit(AuthAuthenticated(
        userId: user.id,
        email: user.email ?? '',
      ));
    } else {
      emit(const AuthUnauthenticated());
    }
  }

  Future<void> _onSignInRequested(
    AuthSignInRequested event,
    Emitter<AuthState> emit,
  ) async {
    emit(const AuthLoading());

    try {
      final user = await _authRepository.signIn(
        email: event.email.trim(),
        password: event.password,
      );

      emit(AuthAuthenticated(
        userId: user.id,
        email: user.email ?? event.email,
      ));
    } catch (e) {
      String message = 'Sign in failed';
      final errorStr = e.toString();

      if (errorStr.contains('Invalid login credentials')) {
        message = 'Invalid email or password';
      } else if (errorStr.contains('network') ||
          errorStr.contains('SocketException')) {
        message = 'No internet connection';
      } else if (errorStr.contains('too many requests') ||
          errorStr.contains('429')) {
        message = 'Too many attempts. Please wait a moment.';
      }

      emit(AuthError(message));
      // Return to unauthenticated so user can retry
      emit(const AuthUnauthenticated());
    }
  }

  Future<void> _onSignOutRequested(
    AuthSignOutRequested event,
    Emitter<AuthState> emit,
  ) async {
    emit(const AuthLoading());
    try {
      await _authRepository.signOut();
    } catch (_) {
      // Sign out should always succeed from UI perspective
    }
    emit(const AuthUnauthenticated());
  }

  @override
  Future<void> close() {
    _authSubscription?.cancel();
    return super.close();
  }
}
