package com.loonext.android.features.settings

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * #232 — the one line an owner pastes into their own website, built twice.
 *
 * `widgetSnippet` exists in TypeScript and again in Kotlin, and the two have to
 * produce byte-identical markup. This is the exact shape that has gone wrong in
 * this repository before: a shared rule hand-ported to a second language drifts,
 * and the drift is invisible because each copy works perfectly on its own.
 *
 * It would be invisible here too. An owner copies the line from their phone,
 * pastes it into WordPress, and the button either appears or does not — with no
 * error anywhere in our system, because nothing of ours ever reads it back.
 *
 * The expectation is written out in full rather than assembled from parts. A
 * test that builds its expectation the same way the code does passes whatever
 * the code does.
 */
class WidgetSnippetTest {

    @Test
    fun `builds the exact line the web app builds`() {
        assertEquals(
            "<script src=\"https://app.loonext.com/widget.js\" " +
                "data-key=\"aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa\" defer></script>",
            widgetSnippet("aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa"),
        )
    }

    @Test
    fun `is a closed element, so a page does not swallow the rest of itself`() {
        // An unclosed script tag does not fail loudly — it eats whatever markup
        // follows it, which on somebody's homepage is their homepage.
        val snippet = widgetSnippet("k")
        assertTrue(snippet.startsWith("<script "))
        assertTrue(snippet.endsWith("</script>"))
    }

    @Test
    fun `has no line breaks, because it is pasted into a text field`() {
        // Several site builders offer a one-line "header code" box, and a
        // newline in a value pasted there is silently truncated at the break.
        assertFalse(widgetSnippet("k").contains("\n"))
    }
}
