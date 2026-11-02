package com.loonext.android

import java.io.File
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The libraries the release build ships, each read for what R8 does to it.
 *
 * Unit tests and the debug APK run unshrunk, so a library that finds classes or
 * fields by name works everywhere except the build users install. The Telnyx
 * SDK was that: no rules of its own, Gson over its message classes, and every
 * release shipped with calling broken. This fails when a library arrives that
 * `r8-inventory.json` has not reviewed, so the next one is looked at before it
 * ships. `scripts/check-shrunk-build.mjs` then checks the names against the
 * shrunk build itself.
 */
class R8InventoryTest {

    private val inventory: JsonObject = Json.parseToJsonElement(appFile("r8-inventory.json").readText()).jsonObject
    private val directReviewed: JsonObject = inventory.getValue("direct").jsonObject
    private val groupsReviewed: JsonObject = inventory.getValue("groups").jsonObject

    @Test
    fun `every library the app declares is in the inventory`() {
        val unreviewed = declaredDependencies() - directReviewed.keys
        assertTrue(
            "These dependencies are declared but not reviewed for R8: ${unreviewed.sorted()}. " +
                "For each, find out whether it reads classes, fields or enum names by reflection, " +
                "JSON, JNI or ServiceLoader, and whether it ships its own keep rules. Add a rule to " +
                "proguard-rules.pro if it needs one, then add an entry under `direct` in " +
                "r8-inventory.json saying why.",
            unreviewed.isEmpty(),
        )
    }

    @Test
    fun `every library the release build ships is in the inventory`() {
        val shipped = releaseModules()
        assertTrue("the release module list is empty; the check would pass by finding nothing", shipped.size > 50)
        val unreviewed = shipped.filter { module ->
            module !in directReviewed && module.substringBefore(':') !in groupsReviewed
        }
        assertTrue(
            "These modules reach the release build and nothing has reviewed their group: $unreviewed. " +
                "A library that arrived through another one still reads names at run time, so find out " +
                "what it does under R8, then add its group under `groups` in r8-inventory.json.",
            unreviewed.isEmpty(),
        )
    }

    @Test
    fun `the inventory lists no library the app no longer has`() {
        val stale = (directReviewed.keys - declaredDependencies()).sorted()
        assertTrue("r8-inventory.json reviews dependencies the app no longer declares: $stale", stale.isEmpty())

        val groups = releaseModules().map { it.substringBefore(':') }.toSet()
        val staleGroups = (groupsReviewed.keys - groups).sorted()
        assertTrue("r8-inventory.json reviews groups the release build no longer ships: $staleGroups", staleGroups.isEmpty())
    }

    @Test
    fun `every entry says what it does under R8`() {
        val reasons = directReviewed.mapValues { (_, entry) -> entry.jsonObject.getValue("why").jsonPrimitive.content } +
            groupsReviewed.mapValues { (_, why) -> why.jsonPrimitive.content }
        val empty = reasons.filterValues { it.trim().length < 10 }.keys
        assertTrue("these inventory entries have no reason: $empty", empty.isEmpty())

        val verdicts = directReviewed.mapValues { (_, entry) -> entry.jsonObject.getValue("r8").jsonPrimitive.content }
        val unknown = verdicts.filterValues { it !in VERDICTS }
        assertTrue("r8 must be one of $VERDICTS: $unknown", unknown.isEmpty())
    }

    @Test
    fun `a library that needs our rule has the rule`() {
        val rules = proguardRules()
        directReviewed.forEach { (module, entry) ->
            val keep = entry.jsonObject["keepRules"]?.jsonArray?.map { it.jsonPrimitive.content }.orEmpty()
            val own = entry.jsonObject.getValue("r8").jsonPrimitive.content == "own-rules"
            assertTrue("$module is `own-rules` but names no keepRules", !own || keep.isNotEmpty())
            keep.forEach { rule ->
                assertTrue("proguard-rules.pro does not contain `$rule`, which $module needs", rule in rules)
            }
        }
    }

    @Test
    fun `every package the shrunk build is checked for is kept by a rule`() {
        val rules = proguardRules()
        inventory.getValue("expect").jsonObject.getValue("packages").jsonArray
            .map { it.jsonObject.getValue("prefix").jsonPrimitive.content }
            .also { assertTrue("expect.packages is empty", it.isNotEmpty()) }
            .forEach { prefix ->
                assertTrue(
                    "expect.packages says $prefix** keeps its names, but proguard-rules.pro has no `-keep class $prefix** { *; }`.",
                    "-keep class $prefix** { *; }" in rules,
                )
            }
    }

    // --- Reading the build ------------------------------------------------------

    /** `group:module` for every dependency that ships in the app, from the build script and the version catalog. */
    private fun declaredDependencies(): Set<String> {
        val catalog = catalogLibraries()
        val script = appFile("build.gradle.kts").readLines()
        val declared = sortedSetOf<String>()
        for (line in script) {
            val args = SHIPPED_DEPENDENCY.matchEntire(line)?.groupValues?.get(2) ?: continue
            val reference = args.trim().removePrefix("platform(").removeSuffix(")").trim()
            when {
                reference.startsWith("libs.") -> declared += catalog.getValue(alias(reference.removePrefix("libs.")))
                reference.startsWith("\"") -> declared += reference.trim('"').split(':').take(2).joinToString(":")
                else -> throw AssertionError("cannot read the dependency declaration `$line`; teach R8InventoryTest about it")
            }
        }
        assertTrue("no dependencies were read from build.gradle.kts", declared.size > 10)
        return declared
    }

    private fun catalogLibraries(): Map<String, String> {
        val libraries = linkedMapOf<String, String>()
        var inLibraries = false
        for (line in appFile("../gradle/libs.versions.toml").readLines()) {
            if (line.startsWith("[")) inLibraries = line.trim() == "[libraries]"
            val entry = if (inLibraries) CATALOG_ENTRY.matchEntire(line.trim()) else null
            entry ?: continue
            val body = entry.groupValues[2]
            val module = Regex("""module\s*=\s*"([^"]+)"""").find(body)?.groupValues?.get(1)
                ?: run {
                    val group = Regex("""group\s*=\s*"([^"]+)"""").find(body)?.groupValues?.get(1)
                    val name = Regex("""name\s*=\s*"([^"]+)"""").find(body)?.groupValues?.get(1)
                    if (group != null && name != null) "$group:$name" else null
                }
            if (module != null) libraries[alias(entry.groupValues[1])] = module
        }
        return libraries
    }

    private fun releaseModules(): List<String> {
        val file = listOf(".", "app").map { File(it, "build/r8-inventory/release-runtime-modules.txt") }.firstOrNull { it.isFile }
            ?: throw AssertionError("release-runtime-modules.txt is missing; :app:writeReleaseRuntimeModules should run before the tests")
        return file.readLines().filter { it.isNotBlank() }
    }

    /** The rules with comments and spacing removed, so a reformatted rule still matches. */
    private fun proguardRules(): String =
        appFile("proguard-rules.pro").readLines()
            .map { it.substringBefore('#').trim() }
            .filter { it.isNotEmpty() }
            .joinToString(" ")
            .replace(Regex("""\s+"""), " ")

    private fun appFile(name: String): File =
        listOf(".", "app", "apps/android/app").map { File(it, name) }.firstOrNull { it.isFile }
            ?: throw AssertionError("$name not found from ${File("").absolutePath}")

    /** `androidx-core-ktx` in the catalog is `libs.androidx.core.ktx` in the script. */
    private fun alias(name: String) = name.replace('.', '-').replace('_', '-')

    private companion object {
        val VERDICTS = setOf("no-reflection", "ships-rules", "own-rules")

        /** `implementation(...)`, `api(...)` and `runtimeOnly(...)` ship; debug, test and nonprod-only ones do not match. */
        val SHIPPED_DEPENDENCY = Regex("""\s*(implementation|api|runtimeOnly)\((.+)\)\s*""")

        val CATALOG_ENTRY = Regex("""([\w-]+)\s*=\s*\{(.*)\}.*""")
    }
}
