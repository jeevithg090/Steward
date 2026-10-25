package org.tempo.signal

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/** The same vectors as tests/unit/test_signals*.py: the phone and the reference must agree. */
class SignalFilterTest {
    private val rail = SignalSpec(
        id = "rail_delay_notification",
        senderAny = listOf("GWR", "Great Western Railway", "Chiltern Railways", "CrossCountry", "Trainline", "National Rail"),
        textAny = listOf("delayed", "cancelled", "running late", "disruption"),
        extract = listOf("service_time", "origin", "destination", "delay_minutes"),
    )

    private fun repo(): File {
        var dir: File? = File("").absoluteFile
        while (dir != null && !File(dir, "fixtures/signals/notifications.json").exists()) dir = dir.parentFile
        return dir ?: error("run from inside the Tempo repository")
    }

    private fun json(path: String) = JSONObject(File(repo(), path).readText())

    /** The scam_text spec exactly as the Gateway serves it (fixtures/signals/scam_text.spec.json). */
    private fun scamSpec(): SignalSpec = SignalPoster.parseSpec(json("fixtures/signals/scam_text.spec.json"))

    private fun expectedMap(expected: JSONObject): Map<String, String> =
        expected.keys().asSequence().associateWith { expected.getString(it) }

    @Test
    fun railFilterMatchesTheSharedVectors() {
        val cases = json("fixtures/signals/notifications.json").getJSONArray("cases")
        for (i in 0 until cases.length()) {
            val case = cases.getJSONObject(i)
            val actual = SignalFilter.extract(rail, case.getString("sender"), case.getString("text"))
            if (case.isNull("expected")) assertNull(case.getString("text"), actual)
            else assertEquals(case.getString("text"), expectedMap(case.getJSONObject("expected")), actual)
        }
    }

    @Test
    fun scamFilterMatchesTheSharedVectors() {
        val spec = scamSpec()
        val cases = json("fixtures/signals/scam_messages.json").getJSONArray("cases")
        for (i in 0 until cases.length()) {
            val case = cases.getJSONObject(i)
            val actual = SignalFilter.extract(spec, case.getString("sender"), case.getString("text"))
            if (case.isNull("expected")) assertNull(case.getString("text"), actual)
            else assertEquals(case.getString("text"), expectedMap(case.getJSONObject("expected")), actual)
        }
    }

    @Test
    fun theModelGivesTheTrainersProbabilities() {
        val model = ScamModel(json("skills/scam-shield/model.json"))
        val vectors = json("fixtures/signals/model_vectors.json")
        val cases = vectors.getJSONArray("cases")
        for (i in 0 until cases.length()) {
            val case = cases.getJSONObject(i)
            val fams = case.getJSONArray("families").let { a -> (0 until a.length()).map { a.getString(it) } }
            val score = model.score(case.getString("text"), fams)
            assertTrue(case.getString("text"), kotlin.math.abs(score.probability - case.getDouble("probability")) < 0.001)
            assertEquals(case.getString("text"), case.getString("zone"), score.zone)
        }
    }

    @Test
    fun nothingLeavesForAGenuineBankCode() {
        val spec = scamSpec()
        assertNull(SignalFilter.extract(spec, "HSBC", "Your HSBC one-time passcode is 482913. Never share this code with anyone."))
    }

    @Test
    fun onlyTheFourFieldsLeaveAndNeverTheBody() {
        val spec = scamSpec()
        val fields = SignalFilter.extract(spec, "+447700900123",
            "HMRC: You are due a tax refund of 248.20 GBP. Claim within 24 hours at http://hmrc-refunds-gov.uk/claim")!!
        assertEquals(setOf("rules", "link_hosts"), fields.keys)
        assertEquals("hmrc-refunds-gov.uk", fields["link_hosts"])
    }

    @Test
    fun aBigAskIsRecognisedButANeverShareIsNot() {
        assertTrue(Asks.bigAsk("Please read me the code we sent you"))
        assertTrue(!Asks.bigAsk("Never share this code with anyone, including HSBC staff."))
    }
}
