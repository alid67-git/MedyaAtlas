plugins {
    id("com.android.application")
    // The Flutter Gradle Plugin must be applied after the Android and Kotlin Gradle plugins.
    id("dev.flutter.flutter-gradle-plugin")
}

import java.util.Properties
import java.io.FileInputStream

val keystoreProperties = Properties()
val keystorePropertiesFile = rootProject.file("key.properties")
if (keystorePropertiesFile.exists()) {
    keystoreProperties.load(FileInputStream(keystorePropertiesFile))
}

android {
    namespace = "com.medyaatlas.medyaatlas_mobile"
    compileSdk = 36
    ndkVersion = flutter.ndkVersion

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    defaultConfig {
        applicationId = "com.medyaatlas.medyaatlas_mobile"
        minSdk = flutter.minSdkVersion
        targetSdk = 36
        versionCode = flutter.versionCode
        versionName = flutter.versionName
    }

    signingConfigs {
        create("release") {
            // Sabit sideload imzası — her CI derlemesi aynı anahtarı kullanır;
            // böylece üzerine kurulum / uygulama içi güncelleme çalışır.
            val relative = keystoreProperties["storeFile"]?.toString()
                ?: "keystore/medyaatlas-upload.jks"
            storeFile = rootProject.file(relative)
            storePassword = keystoreProperties["storePassword"]?.toString()
                ?: "MedyaAtlasSideload2026"
            keyAlias = keystoreProperties["keyAlias"]?.toString() ?: "medyaatlas"
            keyPassword = keystoreProperties["keyPassword"]?.toString()
                ?: "MedyaAtlasSideload2026"
        }
    }

    buildTypes {
        release {
            signingConfig = signingConfigs.getByName("release")
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
