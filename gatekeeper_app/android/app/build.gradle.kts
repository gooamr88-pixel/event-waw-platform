plugins {
    id("com.android.application")
    // The Flutter Gradle Plugin must be applied after the Android and Kotlin Gradle plugins.
    id("dev.flutter.flutter-gradle-plugin")
}

android {
    namespace = "com.eventsli.gatekeeper"
    compileSdk = flutter.compileSdkVersion
    ndkVersion = flutter.ndkVersion

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    defaultConfig {
        applicationId = "com.eventsli.gatekeeper"
        minSdk = 24  // Required for camera2, Hive, and connectivity_plus
        targetSdk = flutter.targetSdkVersion
        versionCode = flutter.versionCode
        versionName = flutter.versionName
        
        // Multi-dex for large dependency tree
        multiDexEnabled = true
    }

    buildTypes {
        release {
            // TODO: Replace with your production signing config:
            // 1. Create keystore: keytool -genkey -v -keystore gatekeeper-release.jks ...
            // 2. Create android/key.properties with storePassword, keyPassword, etc.
            // 3. Load signingConfigs from key.properties
            signingConfig = signingConfigs.getByName("debug")

            // Enable R8 code shrinking and resource optimization
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro"
            )
        }
    }
}

kotlin {
    compilerOptions {
        jvmTarget = org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17
    }
}

flutter {
    source = "../.."
}
