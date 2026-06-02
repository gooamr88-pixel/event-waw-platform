/// ═══════════════════════════════════
/// EVENTSLI GATEKEEPER — Supabase Auth Datasource
/// ═══════════════════════════════════
///
/// Handles all Supabase auth operations and the
/// authenticate_scanner RPC call.

import 'package:supabase_flutter/supabase_flutter.dart';

class SupabaseAuthDatasource {
  final SupabaseClient _client;

  SupabaseAuthDatasource({required SupabaseClient client}) : _client = client;

  /// Auth state stream for reactive auth changes.
  Stream<AuthState> get authStateChanges => _client.auth.onAuthStateChange;

  /// Current authenticated user.
  User? get currentUser => _client.auth.currentUser;

  /// Current session.
  Session? get currentSession => _client.auth.currentSession;

  /// Sign in with email and password.
  Future<User> signIn({
    required String email,
    required String password,
  }) async {
    final response = await _client.auth.signInWithPassword(
      email: email,
      password: password,
    );

    final user = response.user;
    if (user == null) {
      throw Exception('Sign in failed: no user returned');
    }
    return user;
  }

  /// Sign out.
  Future<void> signOut() async {
    await _client.auth.signOut();
  }

  /// Call the authenticate_scanner RPC.
  /// Returns raw JSONB map from the RPC.
  Future<Map<String, dynamic>> authenticateScanner() async {
    final response = await _client.rpc('authenticate_scanner');

    if (response == null) {
      throw Exception('authenticate_scanner returned null');
    }

    // RPC returns JSONB which Supabase client auto-decodes
    if (response is Map<String, dynamic>) {
      if (response.containsKey('error')) {
        throw Exception(response['error'] as String);
      }
      return response;
    }

    throw Exception('Unexpected response format from authenticate_scanner');
  }
}
