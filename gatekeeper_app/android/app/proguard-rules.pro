# ═══════════════════════════════════
# EVENTSLI GATEKEEPER — ProGuard Rules
# ═══════════════════════════════════
#
# Rules for R8 code shrinking in release builds.
# Keep Flutter, Supabase, and Hive internals intact.

# ── Flutter ──
-keep class io.flutter.** { *; }
-keep class io.flutter.plugins.** { *; }

# ── Supabase / GoTrue / PostgREST ──
-keep class io.supabase.** { *; }
-keep class com.google.crypto.** { *; }

# ── Hive ──
-keep class com.crazecoder.openfile.** { *; }
-keep class hive.** { *; }

# ── Google Fonts ──
-keep class com.google.android.gms.** { *; }

# ── mobile_scanner (CameraX) ──
-keep class com.google.mlkit.** { *; }
-keep class androidx.camera.** { *; }

# ── Prevent stripping of Kotlin metadata ──
-keepattributes *Annotation*
-keepattributes Signature
-keepattributes InnerClasses

# ── Keep JSON serialization (for Supabase responses) ──
-keepclassmembers class * {
    @com.google.gson.annotations.SerializedName <fields>;
}

# ── Google Play Core (referenced by Flutter engine for deferred components) ──
# These classes are not used at runtime but R8 fails if they're missing.
-dontwarn com.google.android.play.core.splitcompat.**
-dontwarn com.google.android.play.core.splitinstall.**
-dontwarn com.google.android.play.core.tasks.**
