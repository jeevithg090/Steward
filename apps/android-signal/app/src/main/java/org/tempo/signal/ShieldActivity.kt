package org.tempo.signal

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.graphics.Color
import android.os.Bundle
import android.os.VibrationEffect
import android.os.Vibrator
import android.util.TypedValue
import android.view.Gravity
import android.view.View
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView

/**
 * The Shield card: the warning in the largest text the screen allows, two or three big buttons,
 * TalkBack labels on everything, and a short buzz. Nothing here shows the message itself.
 *
 * - "Read it again" speaks the warning once more (as often as needed).
 * - "I know this sender" trusts a phone number on this phone only; it refuses for a sender id.
 * - "I'm fine" closes the card.
 */
class ShieldActivity : Activity() {
    private var speaker: Speaker? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setShowWhenLocked(true)
        setTurnScreenOn(true)
        val say = intent.getStringExtra(EXTRA_SAY) ?: return finish()
        val sender = intent.getStringExtra(EXTRA_SENDER) ?: ""
        val zone = intent.getStringExtra(EXTRA_ZONE) ?: "warn"
        val language = getSharedPreferences(TempoListener.PREFS, MODE_PRIVATE)
            .getString(TempoListener.KEY_LANGUAGE, null) ?: "en"
        speaker = Speaker(this, language)
        (getSystemService(Context.VIBRATOR_SERVICE) as? Vibrator)
            ?.vibrate(VibrationEffect.createWaveform(longArrayOf(0, 300, 150, 300), -1))

        val background = if (zone == "warn") Color.rgb(127, 29, 29) else Color.rgb(17, 94, 89)
        val heading = TextView(this).apply {
            text = if (zone == "warn") "Stop" else if (zone == "hold") "Wait" else "Tempo"
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 44f)
            setTextColor(Color.WHITE)
            gravity = Gravity.CENTER
            contentDescription = text
        }
        val body = TextView(this).apply {
            text = say
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 30f)
            setTextColor(Color.WHITE)
            setLineSpacing(0f, 1.25f)
            gravity = Gravity.CENTER
            setPadding(0, 32, 0, 32)
            accessibilityLiveRegion = View.ACCESSIBILITY_LIVE_REGION_ASSERTIVE
        }
        val again = bigButton("Read it again") { speaker?.say(say) }
        val known = bigButton("I know this sender") {
            val ok = Allowlist.trust(this, sender)
            body.text = if (ok) "All right. Messages from this number will not be checked on this phone."
            else "That sender is a name, not a number, so it cannot be trusted. Scammers use names."
            speaker?.say(body.text.toString())
        }
        val fine = bigButton("I'm fine") { finish() }
        setContentView(LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(background)
            setPadding(48, 96, 48, 48)
            listOf(heading, body, again, known, fine).forEach { addView(it) }
        })
    }

    private fun bigButton(label: String, onClick: () -> Unit) = Button(this).apply {
        text = label
        contentDescription = label
        setTextSize(TypedValue.COMPLEX_UNIT_SP, 24f)
        minHeight = (72 * resources.displayMetrics.density).toInt()
        setOnClickListener { onClick() }
    }

    override fun onDestroy() {
        speaker?.shutdown()
        super.onDestroy()
    }

    companion object {
        const val EXTRA_SAY = "say"
        const val EXTRA_SENDER = "sender"
        const val EXTRA_ZONE = "zone"

        fun show(context: Context, sender: String, say: String, zone: String) {
            context.startActivity(
                Intent(context, ShieldActivity::class.java)
                    .putExtra(EXTRA_SAY, say).putExtra(EXTRA_SENDER, sender).putExtra(EXTRA_ZONE, zone)
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP),
            )
        }
    }
}
