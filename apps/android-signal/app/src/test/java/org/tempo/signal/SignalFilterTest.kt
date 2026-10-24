package org.tempo.signal

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import java.io.File

/** The same vectors as tests/unit/test_signals.py: the phone and the reference must agree. */
class SignalFilterTest {
    private val rail = SignalSpec(
        id = "rail_delay_notification",
        senderAny = listOf("GWR", "Great Western Railway", "Chiltern Railways", "CrossCountry", "Trainline", "National Rail"),
        textAny = listOf("delayed", "cancelled", "running late", "disruption"),
        extract = listOf("service_time", "origin", "destination", "delay_minutes"),
    )

    private fun vectors(): JSONObject {
        var dir: File? = File("").absoluteFile
        while (dir != null && !File(dir, "fixtures/signals/notifications.json").exists()) dir = dir.parentFile
        return JSONObject(File(dir, "fixtures/signals/notifications.json").readText())
    }

    @Test
    fun filterMatchesTheSharedVectors() {
        val cases = vectors().getJSONArray("cases")
        for (i in 0 until cases.length()) {
            val case = cases.getJSONObject(i)
            val actual = SignalFilter.extract(rail, case.getString("sender"), case.getString("text"))
            if (case.isNull("expected")) {
                assertNull(case.getString("text"), actual)
            } else {
                val expected = case.getJSONObject("expected")
                assertEquals(case.getString("text"), expected.keys().asSequence().associateWith { expected.getString(it) }, actual)
            }
        }
    }

    @Test
    fun filterMatchesGwrDelayedText() {
        assertEquals("34", SignalFilter.extract(rail, "GWR", "08:12 delayed 34 min")?.get("delay_minutes"))
    }

    @Test
    fun nonMatchingNotificationNeverLeavesDevice() {
        assertNull(SignalFilter.extract(rail, "Evri", "Your parcel is delayed"))
    }
}
