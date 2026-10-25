package org.tempo.signal

import android.content.Context
import android.speech.tts.TextToSpeech
import java.util.Locale
import java.util.concurrent.ConcurrentLinkedQueue

/**
 * The phone's own voice (Android TextToSpeech, offline once a voice is installed). The warning is
 * spoken the moment the filter decides, before anything reaches the Gateway, in the language the
 * person chose in the app (the Patience Profile's six, defaulting to the phone's own).
 */
class Speaker(context: Context, private val language: String) : TextToSpeech.OnInitListener {
    private val tts = TextToSpeech(context.applicationContext, this)
    private var ready = false
    private val pending = ConcurrentLinkedQueue<String>()

    override fun onInit(status: Int) {
        ready = status == TextToSpeech.SUCCESS
        if (ready) {
            val locale = LOCALES[language] ?: Locale.getDefault()
            if (tts.setLanguage(locale) < TextToSpeech.LANG_AVAILABLE) tts.language = Locale.UK
            tts.setSpeechRate(0.9f) // slower than the default: the audience is the whole point
            while (true) speakNow(pending.poll() ?: break)
        }
    }

    fun say(text: String) {
        if (ready) speakNow(text) else pending += text
    }

    private fun speakNow(text: String) {
        tts.speak(text, TextToSpeech.QUEUE_ADD, null, "tempo-${text.hashCode()}")
    }

    fun shutdown() = tts.shutdown()

    companion object {
        val LOCALES = mapOf(
            "en" to Locale.UK, "hi" to Locale("hi", "IN"), "pa" to Locale("pa", "IN"),
            "pl" to Locale("pl", "PL"), "ur" to Locale("ur", "PK"), "cy" to Locale("cy", "GB"),
        )
    }
}
