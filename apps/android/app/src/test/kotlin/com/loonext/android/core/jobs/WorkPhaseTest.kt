package com.loonext.android.core.jobs

import java.io.File
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * #294 — before and after, and that this phone groups a job the way the laptop does.
 *
 * A drift here means one client shows a customer four visits and another shows one
 * flat pile of photos. It would not fail to compile, which is why the port gets its
 * own test.
 */
class WorkPhaseTest {

    private data class Photo(
        override val id: String,
        override val noteId: String? = null,
        override val workPhase: String? = null,
        override val addedByUserId: String? = null,
        override val createdAt: String = "2026-08-08T10:00:00Z",
    ) : JobPhotoLike

    // ------------------------------------------------------------ the two labels

    @Test
    fun `it is before and after, and nothing else`() {
        // "During" is a category somebody invented in a meeting. A tech takes a
        // handful when they arrive and a handful when they finish.
        assertEquals(listOf("before", "after"), WorkPhase.ALL)
        assertEquals("Before", WorkPhase.label("before"))
        assertEquals("After", WorkPhase.label("after"))
    }

    @Test
    fun `anything else is not a phase`() {
        assertTrue(WorkPhase.isPhase("before"))
        assertTrue(WorkPhase.isPhase("after"))
        for (bad in listOf("during", "BEFORE", "", null)) {
            assertTrue(bad ?: "null", !WorkPhase.isPhase(bad))
        }
    }

    // --------------------------------------------------------------- the grouping

    @Test
    fun `each note's files go together`() {
        val groups = groupJobPhotos(
            listOf(
                Photo("a", noteId = "n1", createdAt = "2026-08-08T09:00:00Z"),
                Photo("b", noteId = "n2", createdAt = "2026-08-08T15:00:00Z"),
                Photo("c", noteId = "n1", createdAt = "2026-08-08T09:00:05Z"),
            ),
        )
        assertEquals(2, groups.size)
        assertEquals(listOf("a", "c"), groups[0].items.map { it.id })
        assertEquals(listOf("b"), groups[1].items.map { it.id })
    }

    @Test
    fun `two notes written in the same second stay apart`() {
        // THE CASE THAT MATTERS for keying on the note rather than on the time: two
        // visits merged into one is a job record that says something untrue.
        val same = "2026-08-08T09:00:00Z"
        val groups = groupJobPhotos(
            listOf(
                Photo("a", noteId = "n1", createdAt = same),
                Photo("b", noteId = "n2", createdAt = same),
            ),
        )
        assertEquals(2, groups.size)
    }

    @Test
    fun `everything the customer texted is one group`() {
        val groups = groupJobPhotos(
            listOf(
                Photo("a", noteId = null, createdAt = "2026-08-08T08:00:00Z"),
                Photo("b", noteId = null, createdAt = "2026-08-08T08:00:01Z"),
                Photo("c", noteId = "n1", createdAt = "2026-08-08T09:00:00Z"),
            ),
        )
        assertEquals(2, groups.size)
        assertNull(groups[0].noteId)
        assertEquals(listOf("a", "b"), groups[0].items.map { it.id })
    }

    @Test
    fun `a visit is ordered by when it started, not by its last upload`() {
        val groups = groupJobPhotos(
            listOf(
                Photo("late", noteId = "n1", createdAt = "2026-08-08T18:00:00Z"),
                Photo("early", noteId = "n1", createdAt = "2026-08-08T08:00:00Z"),
                Photo("midday", noteId = "n2", createdAt = "2026-08-08T12:00:00Z"),
            ),
        )
        assertEquals(listOf("n1", "n2"), groups.map { it.noteId })
        assertEquals("2026-08-08T08:00:00Z", groups[0].at)
    }

    @Test
    fun `the label and the author come from the note`() {
        val groups = groupJobPhotos(
            listOf(Photo("a", noteId = "n1", workPhase = "after", addedByUserId = "u1")),
        )
        assertEquals("after", groups[0].workPhase)
        assertEquals("u1", groups[0].addedByUserId)
    }

    @Test
    fun `nothing in, nothing out`() {
        assertEquals(emptyList<JobPhotoGroup<Photo>>(), groupJobPhotos(emptyList<Photo>()))
    }

    // ---------------------------------------------------------------- the summary

    @Test
    fun `the summary counts each label`() {
        assertEquals(
            "2 before, 1 after",
            jobPhaseSummary(
                listOf(
                    Photo("a", workPhase = "before"),
                    Photo("b", workPhase = "before"),
                    Photo("c", workPhase = "after"),
                ),
            ),
        )
    }

    @Test
    fun `an unlabelled job gets no summary at all`() {
        // Not "0 before, 0 after", which reads as a broken count rather than as a
        // job whose photos nobody classified — and most jobs will be that.
        assertNull(jobPhaseSummary(listOf(Photo("a"), Photo("b"))))
        assertNull(jobPhaseSummary(emptyList()))
    }

    // ------------------------------------------------------- against the original

    /** The shared source, with carriage returns stripped — this tree is CRLF. */
    private fun repoFile(relative: String): String {
        var dir: File? = File("").absoluteFile
        while (dir != null) {
            val candidate = File(dir, relative)
            if (candidate.exists()) return candidate.readText().filterNot { it == '\r' }
            dir = dir.parentFile
        }
        throw AssertionError("$relative not found from ${File("").absolutePath}")
    }

    @Test
    fun `the labels match the shared module`() {
        // #228: the WORDS live in the web catalogue now. The shared module
        // names keys, and the phase ids ("before"/"after") — which are wire
        // values a photo carries — are still asserted against it below.
        //
        // Sliced to the English half: the French holds the same keys, and a
        // `contains` over the whole file would ask whether a label appears in
        // EITHER language.
        val shared = repoFile("apps/web/src/i18n/sections/domain.ts")
            .substringAfter("export const domainEn")
            .substringBefore("export const domainFr")
        for (label in listOf(
            WorkPhase.label("before"),
            WorkPhase.label("after"),
            WorkPhase.UNSET_LABEL,
        )) {
            assertTrue("this label has drifted: $label", shared.contains("\"$label\""))
        }
        assertTrue(
            "the hint has drifted: ${WorkPhase.HINT}",
            shared.replace(Regex("\\s+"), " ").contains(
                WorkPhase.HINT.replace(Regex("\\s+"), " "),
            ),
        )
    }

    @Test
    fun `the shared module still knows only these two phases`() {
        // A third phase added there and not here would leave this phone unable to
        // draw a label the server accepts.
        val shared = repoFile("packages/shared/src/work-phase.ts")
        val declared = Regex("""WORK_PHASES = \[([^\]]*)\]""")
            .find(shared)
            ?.groupValues
            ?.get(1)
            ?: throw AssertionError("WORK_PHASES has moved — point this test at it")
        val names = Regex("\"([a-z]+)\"").findAll(declared).map { it.groupValues[1] }.toList()
        assertEquals(WorkPhase.ALL, names)
    }
}
