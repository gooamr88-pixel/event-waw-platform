/// ═══════════════════════════════════
/// Auth Repository — Contract
/// ═══════════════════════════════════

import 'package:supabase_flutter/supabase_flutter.dart';
import '../../domain/models/models.dart';

abstract class AuthRepository {
  /// Current auth state stream.
  Stream<AuthState> get authStateChanges;

  /// Current user (nullable).
  User? get currentUser;

  /// Whether user is signed in.
  bool get isSignedIn;

  /// Sign in with email and password.
  Future<User> signIn({required String email, required String password});

  /// Sign out.
  Future<void> signOut();

  /// Call authenticate_scanner RPC — returns gate team assignments + own events.
  Future<ScannerAuthResult> authenticateScanner();
}
