/// ═══════════════════════════════════
/// Auth Repository — Implementation
/// ═══════════════════════════════════

import 'package:supabase_flutter/supabase_flutter.dart';

import '../../domain/models/models.dart';
import '../../domain/repositories/auth_repository.dart';
import '../datasources/supabase_auth_datasource.dart';

class AuthRepositoryImpl implements AuthRepository {
  final SupabaseAuthDatasource _datasource;

  AuthRepositoryImpl({required SupabaseAuthDatasource datasource})
      : _datasource = datasource;

  @override
  Stream<AuthState> get authStateChanges => _datasource.authStateChanges;

  @override
  User? get currentUser => _datasource.currentUser;

  @override
  bool get isSignedIn => _datasource.currentUser != null;

  @override
  Future<User> signIn({
    required String email,
    required String password,
  }) async {
    return _datasource.signIn(email: email, password: password);
  }

  @override
  Future<void> signOut() async {
    await _datasource.signOut();
  }

  @override
  Future<ScannerAuthResult> authenticateScanner() async {
    final raw = await _datasource.authenticateScanner();
    return ScannerAuthResult.fromJson(raw);
  }
}
