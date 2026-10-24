package org.tempo.signal

import android.content.Context
import java.time.Instant

/** "What left this phone, when, and for which skill": field names only, never their values. */
object PrivacyLog {
    private const val KEY = "privacy_log"

    fun record(context: Context, signalId: String, fields: Set<String>, status: Int?) {
        val prefs = context.getSharedPreferences(TempoListener.PREFS, Context.MODE_PRIVATE)
        val line = "${Instant.now()} $signalId sent ${fields.sorted().joinToString(",")} (HTTP ${status ?: "failed"})"
        val log = (prefs.getString(KEY, "") ?: "").lines().filter { it.isNotBlank() }.takeLast(199) + line
        prefs.edit().putString(KEY, log.joinToString("\n")).apply()
    }

    fun read(context: Context): String =
        context.getSharedPreferences(TempoListener.PREFS, Context.MODE_PRIVATE).getString(KEY, "") ?: ""
}
