package org.tempo.signal

import android.app.Notification
import android.service.notification.NotificationListenerService
import android.service.notification.StatusBarNotification
import java.util.concurrent.Executors

/**
 * Reads notifications on this phone (the person grants access in Settings). Each one is checked
 * here against the skills' filters; only a match's declared fields are sent, and every send is
 * written to the privacy log: what left this phone, when, and for which skill.
 */
class TempoListener : NotificationListenerService() {
    private val worker = Executors.newSingleThreadExecutor()
    @Volatile private var specs: List<SignalSpec> = emptyList()

    override fun onListenerConnected() {
        worker.execute { specs = runCatching { poster()?.filters() }.getOrNull() ?: specs }
    }

    override fun onNotificationPosted(sbn: StatusBarNotification) {
        val extras = sbn.notification.extras
        val sender = extras.getCharSequence(Notification.EXTRA_TITLE)?.toString() ?: sbn.packageName
        val text = (extras.getCharSequence(Notification.EXTRA_BIG_TEXT)
            ?: extras.getCharSequence(Notification.EXTRA_TEXT))?.toString() ?: return
        for (spec in specs) {
            val fields = SignalFilter.extract(spec, sender, text) ?: continue
            worker.execute {
                val status = runCatching { poster()?.post(spec.id, fields) }.getOrNull()
                PrivacyLog.record(this, spec.id, fields.keys, status)
            }
        }
    }

    private fun poster(): SignalPoster? {
        val prefs = getSharedPreferences(PREFS, MODE_PRIVATE)
        val url = prefs.getString(KEY_URL, null) ?: return null
        val token = prefs.getString(KEY_TOKEN, null) ?: return null
        return SignalPoster(url, token)
    }

    companion object {
        const val PREFS = "tempo"
        const val KEY_URL = "gateway_url"
        const val KEY_TOKEN = "device_token"
    }
}
