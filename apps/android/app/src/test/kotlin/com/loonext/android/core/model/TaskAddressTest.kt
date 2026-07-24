package com.loonext.android.core.model

import com.loonext.android.core.data.taskAddressJson
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/** #214 pure logic: the provenance badge mapping + the address-body encoder. */
class TaskAddressTest {

    @Test
    fun `provenance label shows only for AI sources`() {
        assertEquals("From the message", addressProvenanceLabel("message"))
        assertEquals("From the contact", addressProvenanceLabel("contact"))
        assertEquals("Inferred from area code", addressProvenanceLabel("company"))
        // A hand-edited or absent address carries no badge.
        assertNull(addressProvenanceLabel("manual"))
        assertNull(addressProvenanceLabel(null))
        assertNull(addressProvenanceLabel("nonsense"))
    }

    @Test
    fun `address json emits explicit nulls for absent fields and always the provenance`() {
        val json = taskAddressJson(
            TaskAddressInput(
                street = "12 Elm St",
                unit = null,
                city = "Toronto",
                state = null,
                postal_code = null,
                country = null,
                provenance = AddressProvenance.MESSAGE,
            ),
        )
        assertEquals(
            """{"street":"12 Elm St","unit":null,"city":"Toronto","state":null,""" +
                """"postal_code":null,"country":null,"provenance":"message"}""",
            json.toString(),
        )
    }

    @Test
    fun `manual provenance rides a hand-typed address`() {
        val json = taskAddressJson(
            TaskAddressInput(city = "Ottawa", provenance = AddressProvenance.MANUAL),
        )
        assertEquals(
            """{"street":null,"unit":null,"city":"Ottawa","state":null,""" +
                """"postal_code":null,"country":null,"provenance":"manual"}""",
            json.toString(),
        )
    }
}
