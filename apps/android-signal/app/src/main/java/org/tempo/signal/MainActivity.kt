package org.tempo.signal

import android.app.Activity
import android.content.Intent
import android.os.Bundle
import android.provider.Settings
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.TextView

/** Set the Gateway URL and this device's token, grant notification access, see the privacy log. */
class MainActivity : Activity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val prefs = getSharedPreferences(TempoListener.PREFS, MODE_PRIVATE)
        val url = EditText(this).apply { hint = "Gateway URL"; setText(prefs.getString(TempoListener.KEY_URL, "")) }
        val token = EditText(this).apply { hint = "Device token (from pairing)" }
        val log = TextView(this).apply { text = PrivacyLog.read(this@MainActivity).ifBlank { "Nothing has left this phone." } }
        val save = Button(this).apply {
            text = "Save"
            setOnClickListener {
                prefs.edit().putString(TempoListener.KEY_URL, url.text.toString())
                    .putString(TempoListener.KEY_TOKEN, token.text.toString()).apply()
            }
        }
        val access = Button(this).apply {
            text = "Allow notification access"
            setOnClickListener { startActivity(Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS)) }
        }
        setContentView(LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            listOf(url, token, save, access, log).forEach { addView(it) }
        })
    }
}
