/// ═══════════════════════════════════
/// Auth BLoC — Events
/// ═══════════════════════════════════

import 'package:equatable/equatable.dart';

abstract class AuthEvent extends Equatable {
  const AuthEvent();

  @override
  List<Object?> get props => [];
}

/// Check if user is already signed in (app startup).
class AuthCheckRequested extends AuthEvent {
  const AuthCheckRequested();
}

/// User submits login form.
class AuthSignInRequested extends AuthEvent {
  final String email;
  final String password;

  const AuthSignInRequested({required this.email, required this.password});

  @override
  List<Object?> get props => [email, password];
}

/// User signs out.
class AuthSignOutRequested extends AuthEvent {
  const AuthSignOutRequested();
}
