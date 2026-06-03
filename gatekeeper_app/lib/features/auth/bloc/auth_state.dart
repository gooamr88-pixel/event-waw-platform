/// ═══════════════════════════════════
/// Auth BLoC — States
/// ═══════════════════════════════════

import 'package:equatable/equatable.dart';

abstract class AuthState extends Equatable {
  const AuthState();

  @override
  List<Object?> get props => [];
}

/// Initial state — haven't checked auth yet.
class AuthInitial extends AuthState {
  const AuthInitial();
}

/// Checking auth status (splash screen shows).
class AuthLoading extends AuthState {
  const AuthLoading();
}

/// User is authenticated.
class AuthAuthenticated extends AuthState {
  final String userId;
  final String email;

  const AuthAuthenticated({required this.userId, required this.email});

  @override
  List<Object?> get props => [userId, email];
}

/// User is not authenticated — show login.
class AuthUnauthenticated extends AuthState {
  const AuthUnauthenticated();
}

/// Auth error (sign-in failed, network error, etc.)
class AuthError extends AuthState {
  final String message;

  const AuthError(this.message);

  @override
  List<Object?> get props => [message];
}
