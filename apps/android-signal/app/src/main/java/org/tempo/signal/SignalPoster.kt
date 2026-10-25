package org.tempo.signal

import org.json.JSONArray
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL

/** Talks to the Gateway as this paired device: the filters, the model, and a matched signal's fields. */
class SignalPoster(private val gatewayUrl: String, private val deviceToken: String) {
    /** Sends the declared fields; returns the Gateway's answer (zone, say, …) or null on failure. */
    fun post(signalId: String, fields: Map<String, String>): JSONObject? {
        val body = JSONObject().put("signal_id", signalId).put("fields", JSONObject(fields)).toString()
        val connection = open("/mesh/signals")
        return try {
            connection.requestMethod = "POST"
            connection.doOutput = true
            connection.setRequestProperty("Content-Type", "application/json")
            connection.outputStream.use { it.write(body.toByteArray()) }
            if (connection.responseCode in 200..299) {
                JSONObject(connection.inputStream.bufferedReader().readText()).put("status", connection.responseCode)
            } else JSONObject().put("status", connection.responseCode)
        } finally {
            connection.disconnect()
        }
    }

    fun filters(): List<SignalSpec> {
        val connection = open("/mesh/signals")
        return try {
            val specs = JSONArray(connection.inputStream.bufferedReader().readText())
            (0 until specs.length()).map { i -> parseSpec(specs.getJSONObject(i)) }
        } finally {
            connection.disconnect()
        }
    }

    /** The text model as data (about 400 KB); null when the Gateway has none. */
    fun model(): ScamModel? {
        val connection = open("/mesh/signals/model")
        return try {
            if (connection.responseCode != 200) null
            else ScamModel(JSONObject(connection.inputStream.bufferedReader().readText()))
        } finally {
            connection.disconnect()
        }
    }

    private fun open(path: String): HttpURLConnection {
        val connection = URL("${gatewayUrl.trimEnd('/')}$path").openConnection() as HttpURLConnection
        connection.connectTimeout = 10_000
        connection.readTimeout = 20_000
        connection.setRequestProperty("X-Tempo-Device", deviceToken)
        return connection
    }

    companion object {
        fun parseSpec(json: JSONObject): SignalSpec {
            val match = json.getJSONObject("match")
            fun strings(name: String, from: JSONObject): List<String> =
                if (!from.has(name) || from.isNull(name)) emptyList()
                else from.getJSONArray(name).let { a -> (0 until a.length()).map { a.getString(it) } }
            val families = LinkedHashMap<String, List<String>>()
            if (match.has("families")) {
                val fams = match.getJSONObject("families")
                fams.keys().forEach { k -> families[k] = strings(k, fams) }
            }
            return SignalSpec(
                id = json.getString("id"),
                senderAny = strings("sender_any", match),
                textAny = strings("text_any", match),
                families = families,
                links = match.optBoolean("links", false),
                model = if (match.has("model") && !match.isNull("model")) match.getString("model") else null,
                extract = strings("extract", json),
            )
        }
    }
}
