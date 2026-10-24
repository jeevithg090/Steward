package org.tempo.signal

import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL

/** Sends a matched signal's declared fields to the Gateway, as this paired device. */
class SignalPoster(private val gatewayUrl: String, private val deviceToken: String) {
    fun post(signalId: String, fields: Map<String, String>): Int {
        val body = JSONObject().put("signal_id", signalId).put("fields", JSONObject(fields)).toString()
        val connection = URL("${gatewayUrl.trimEnd('/')}/mesh/signals").openConnection() as HttpURLConnection
        return try {
            connection.requestMethod = "POST"
            connection.doOutput = true
            connection.connectTimeout = 10_000
            connection.readTimeout = 10_000
            connection.setRequestProperty("Content-Type", "application/json")
            connection.setRequestProperty("X-Tempo-Device", deviceToken)
            connection.outputStream.use { it.write(body.toByteArray()) }
            connection.responseCode
        } finally {
            connection.disconnect()
        }
    }

    fun filters(): List<SignalSpec> {
        val connection = URL("${gatewayUrl.trimEnd('/')}/mesh/signals").openConnection() as HttpURLConnection
        connection.setRequestProperty("X-Tempo-Device", deviceToken)
        return try {
            val specs = org.json.JSONArray(connection.inputStream.bufferedReader().readText())
            (0 until specs.length()).map { i -> parseSpec(specs.getJSONObject(i)) }
        } finally {
            connection.disconnect()
        }
    }

    companion object {
        fun parseSpec(json: JSONObject): SignalSpec {
            val match = json.getJSONObject("match")
            fun strings(name: String, from: JSONObject) =
                from.getJSONArray(name).let { a -> (0 until a.length()).map { a.getString(it) } }
            return SignalSpec(
                id = json.getString("id"),
                senderAny = strings("sender_any", match),
                textAny = strings("text_any", match),
                extract = strings("extract", json),
            )
        }
    }
}
