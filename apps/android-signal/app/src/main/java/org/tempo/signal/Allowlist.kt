package org.tempo.signal

import android.content.Context

/**
 * "I know this sender": numbers the person has vouched for on this phone. Kept here, never sent.
 * Only phone numbers can be trusted this way: an alphanumeric sender id ("HSBC") is exactly what
 * a scammer spoofs, so a text from one is always checked.
 */
object Allowlist {
    private const val KEY = "trusted_senders"

    fun trusted(context: Context, sender: String): Boolean =
        normalise(sender) in prefs(context).getStringSet(KEY, emptySet()).orEmpty()

    /** Returns false when the sender is not a number and so cannot be trusted. */
    fun trust(context: Context, sender: String): Boolean {
        val number = normalise(sender)
        if (number.isEmpty() || number.length < 6) return false
        val now = prefs(context).getStringSet(KEY, emptySet()).orEmpty().toMutableSet()
        now += number
        prefs(context).edit().putStringSet(KEY, now).apply()
        return true
    }

    /** Digits only, so "+44 7700 900123" and "07700900123" are the same person. */
    fun normalise(sender: String): String {
        val digits = sender.filter { it.isDigit() }
        if (digits.isEmpty() || sender.any { it.isLetter() }) return ""
        return if (digits.startsWith("0")) "44" + digits.drop(1) else digits
    }

    private fun prefs(context: Context) = context.getSharedPreferences(TempoListener.PREFS, Context.MODE_PRIVATE)
}
