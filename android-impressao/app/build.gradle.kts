plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "br.com.mirapontocom.events.we.print"
    compileSdk = 34

    defaultConfig {
        applicationId = "br.com.mirapontocom.events.we.print"
        minSdk = 24
        targetSdk = 34
        versionCode = 1
        versionName = "1.0"
    }

    buildTypes {
        release {
            isMinifyEnabled = false
        }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions {
        jvmTarget = "17"
    }
}

dependencies {
    // QR Code desenhado direto no bitmap da etiqueta
    implementation("com.google.zxing:core:3.5.3")
    // SDK da Brother: baixe o BrotherPrintLibrary.aar e coloque em app/libs (veja ../README.md)
    implementation(fileTree(mapOf("dir" to "libs", "include" to listOf("*.aar", "*.jar"))))
}
