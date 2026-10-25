package org.tempo.signal

import android.app.Activity
import android.content.Intent
import android.os.Bundle
import android.provider.Settings
import android.widget.ArrayAdapter
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.Spinner
import android.widget.TextView

/**
 * Set the Gateway URL and this device's token, choose the language the phone speaks in, grant
 * notification access, see the privacy log. For most people this screen is seen once.
 */
class MainActivity : Activity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val prefs = getSharedPreferences(TempoListener.PREFS, MODE_PRIVATE)
        val url = EditText(this).apply { hint = "Gateway URL"; setText(prefs.getString(TempoListener.KEY_URL, "")) }
        val token = EditText(this).apply { hint = "Device token (from pairing)" }
        val languages = listOf("en", "hi", "pa", "pl", "ur", "cy")
        val names = listOf("English", "हिन्दी", "ਪੰਜਾਬੀ", "Polski", "اردو", "Cymraeg")
        val language = Spinner(this).apply {
            adapter = ArrayAdapter(this@MainActivity, android.R.layout.simple_spinner_dropdown_item, names)
            setSelection(languages.indexOf(prefs.getString(TempoListener.KEY_LANGUAGE, "en")).coerceAtLeast(0))
            contentDescription = "Language Tempo speaks in"
        }
        val log = TextView(this).apply {
            text = PrivacyLog.read(this@MainActivity).ifBlank { "Nothing has left this phone." }
            contentDescription = "Privacy log: what left this phone"
        }
        val save = Button(this).apply {
            text = "Save"
            setOnClickListener {
                prefs.edit().putString(TempoListener.KEY_URL, url.text.toString())
                    .putString(TempoListener.KEY_TOKEN, token.text.toString())
                    .putString(TempoListener.KEY_LANGUAGE, languages[language.selectedItemPosition]).apply()
            }
        }
        val access = Button(this).apply {
            text = "Allow notification access"
            setOnClickListener { startActivity(Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS)) }
        }
        val contacts = Button(this).apply {
            text = "Let Tempo skip messages from my contacts"
            setOnClickListener { requestPermissions(arrayOf(android.Manifest.permission.READ_CONTACTS), 1) }
        }
        val test = Button(this).apply {
            text = "Hear the warning"
            setOnClickListener {
                ShieldActivity.show(this@MainActivity, "", Warnings.warn(languages[language.selectedItemPosition]), "warn")
            }
        }
        setContentView(LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            listOf(url, token, language, save, access, contacts, test, log).forEach { addView(it) }
        })
    }
}
