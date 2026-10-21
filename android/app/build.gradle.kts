import java.util.Properties

plugins {
    id("com.android.application")
}

// Ключ подписи лежит вне проекта (~/.android/kooly-release.properties), в git он не попадает.
// Все версии APK нужно подписывать одним ключом — иначе обновление не встанет поверх старой.
val signing = Properties().apply {
    val f = file(System.getProperty("user.home") + "/.android/kooly-release.properties")
    if (f.exists()) f.inputStream().use { load(it) }
}

android {
    namespace = "ee.kooly.app"
    compileSdk = 35

    defaultConfig {
        applicationId = "ee.kooly.app"
        minSdk = 26 // Android 8.0 и новее
        targetSdk = 35
        versionCode = 2
        versionName = "1.1"
    }

    signingConfigs {
        create("release") {
            if (signing.isNotEmpty()) {
                storeFile = file(signing.getProperty("storeFile"))
                storePassword = signing.getProperty("storePassword")
                keyAlias = signing.getProperty("keyAlias")
                keyPassword = signing.getProperty("keyPassword")
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            signingConfig = signingConfigs.getByName("release")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}
