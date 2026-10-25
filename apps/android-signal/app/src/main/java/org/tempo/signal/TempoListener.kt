package org.tempo.signal

import android.app.Notification
import android.content.Intent
import android.service.notification.NotificationListenerService
import android.service.notification.StatusBarNotification
import java.util.concurrent.Executors

/**
 * Reads notifications on this phone (the person grants access in Settings). Each one is checked
 * HERE against the skills' filters (SignalFilter, Links, ScamModel); only a match's declared
 * fields are sent, and every send is written to the privacy log: what left this phone, when, and
 * for which skill.
 *
 * Scam Shield (docs/scam-shield.md §3, tier 1): the phone decides first. If the message is a plain
 * trick (a keyword family or a link finding together with the model's warn zone, or a brand
 * look-alike link) the phone speaks the warning now, before anything reaches the Gateway. If it
 * is doubtful, the phone says "I'm checking that message", sends the four derived fields, and
 * speaks the Gateway's words when they come back. Messages from senders the person trusts, and
 * from contacts when the app may read them, are left alone.
 */
class TempoListener : NotificationListenerService() {
    private val worker = Executors.newSingleThreadExecutor()
    @Volatile private var specs: List<SignalSpec> = emptyList()
    @Volatile private var model: ScamModel? = null
    private var speaker: Speaker? = null

    override fun onListenerConnected() {
        speaker = Speaker(this, language())
        worker.execute {
            val poster = poster() ?: return@execute
            specs = runCatching { poster.filters() }.getOrNull() ?: specs
            if (specs.any { it.model != null }) model = runCatching { poster.model() }.getOrNull() ?: model
        }
    }

    override fun onListenerDisconnected() {
        speaker?.shutdown()
        speaker = null
    }

    override fun onNotificationPosted(sbn: StatusBarNotification) {
        if (sbn.packageName == packageName) return
        val extras = sbn.notification.extras
        val sender = extras.getCharSequence(Notification.EXTRA_TITLE)?.toString() ?: sbn.packageName
        val text = (extras.getCharSequence(Notification.EXTRA_BIG_TEXT)
            ?: extras.getCharSequence(Notification.EXTRA_TEXT))?.toString() ?: return
        if (Allowlist.trusted(this, sender) || Contacts.isContact(this, sender)) return
        for (spec in specs) {
            val score = if (spec.model != null) model?.score(text, SignalFilter.firedFamilies(spec, text)) else null
            val fields = SignalFilter.extract(spec, sender, text, score) ?: continue
            val shield = spec.model != null || spec.families.isNotEmpty()
            if (shield) speakFirst(spec, sender, text, score)
            worker.execute {
                val answer = runCatching { poster()?.post(spec.id, fields) }.getOrNull()
                PrivacyLog.record(this, spec.id, fields.keys, answer?.optInt("status"))
                if (shield && answer != null) speakGatewaysWords(answer, sender)
            }
        }
    }

    /** Tier 1: speak before anything leaves the phone, but only when code already agrees. */
    private fun speakFirst(spec: SignalSpec, sender: String, text: String, score: ScamModel.Score?) {
        val families = SignalFilter.firedFamilies(spec, text).filter { it != "scam_short_link" }
        val links = Links.findLinks(text)
        val lookAlike = links.any { l -> l.findings.any { it.startsWith("brand_lookalike") || it == "punycode" } }
        val doubtful = links.any { !it.official }
        val corroborated = lookAlike || (families.isNotEmpty() && doubtful) || Asks.bigAsk(text)
        val language = language()
        when {
            corroborated && (score == null || score.zone == "warn" || lookAlike || Asks.bigAsk(text)) -> {
                speaker?.say(Warnings.warn(language))
                ShieldActivity.show(this, sender, Warnings.warn(language), "warn")
            }
            links.any { it.suspicious } || (score != null && score.zone != "quiet" && doubtful) -> {
                speaker?.say(Warnings.hold(language))
                ShieldActivity.show(this, sender, Warnings.hold(language), "hold")
            }
        }
    }

    /** Tier 2 and 3: the Gateway's verdict replaces whatever the phone said first. */
    private fun speakGatewaysWords(answer: org.json.JSONObject, sender: String) {
        val say = answer.optString("say", "")
        val zone = answer.optString("zone", "")
        if (say.isEmpty() || zone == "quiet" && answer.optString("level") == "no_flags") return
        speaker?.say(say)
        ShieldActivity.show(this, sender, say, zone)
    }

    private fun poster(): SignalPoster? {
        val prefs = getSharedPreferences(PREFS, MODE_PRIVATE)
        val url = prefs.getString(KEY_URL, null) ?: return null
        val token = prefs.getString(KEY_TOKEN, null) ?: return null
        return SignalPoster(url, token)
    }

    private fun language(): String =
        getSharedPreferences(PREFS, MODE_PRIVATE).getString(KEY_LANGUAGE, null) ?: "en"

    companion object {
        const val PREFS = "tempo"
        const val KEY_URL = "gateway_url"
        const val KEY_TOKEN = "device_token"
        const val KEY_LANGUAGE = "language"
    }
}

/** The big asks (tempo_core.scam.BIG_ASKS): a safe account, or a request for a code or password. */
object Asks {
    private val safeAccount = Regex("""\bsafe account\b""", RegexOption.IGNORE_CASE)
    private val codeWords = """one[- ]time (?:pass)?code|otp|\bpin\b|pin number|password|passcode|security code|verification code|login code|access code|(?:the|your|this|that|my) codes?\b"""
    private val request = Regex("""\b(?:read|send|tell|give|share|enter|confirm|provide|text|forward|type|quote|repeat|reply with|what'?s|whats|need|key in|input)\b[^.!?\n]{0,40}?(?:$codeWords)""", RegexOption.IGNORE_CASE)
    private val negated = Regex("""\b(?:never|don'?t|do not|not|nobody|no one|no-one|won'?t|will never)\b[\w\s',/-]{0,24}$""", RegexOption.IGNORE_CASE)

    fun bigAsk(text: String): Boolean {
        if (safeAccount.containsMatchIn(text)) return true
        return request.findAll(text).any { m -> !negated.containsMatchIn(text.substring(maxOf(0, m.range.first - 30), m.range.first)) }
    }
}

/** Contacts are trusted senders when the person has allowed the app to read them (optional). */
object Contacts {
    fun isContact(context: android.content.Context, sender: String): Boolean {
        val number = Allowlist.normalise(sender)
        if (number.isEmpty()) return false
        if (context.checkSelfPermission(android.Manifest.permission.READ_CONTACTS) !=
            android.content.pm.PackageManager.PERMISSION_GRANTED) return false
        val uri = android.net.Uri.withAppendedPath(
            android.provider.ContactsContract.PhoneLookup.CONTENT_FILTER_URI, android.net.Uri.encode(sender),
        )
        return runCatching {
            context.contentResolver.query(uri, arrayOf(android.provider.ContactsContract.PhoneLookup._ID), null, null, null)
                ?.use { it.count > 0 } ?: false
        }.getOrDefault(false)
    }
}
