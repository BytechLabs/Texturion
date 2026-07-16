package com.loonext.android.features.thread

import com.loonext.android.core.model.Tag

/** Server-mirrored limit (SPEC §7: tag names are ≤50 chars). */
const val TAG_NAME_MAX = 50

/**
 * What attaching the sheet's text input should do — pure, so the
 * create-on-attach decision is unit-tested on the JVM. The server ALSO
 * matches case-insensitively on create-on-attach; resolving here lets the
 * sheet attach by id (skipping the create path) and show the existing chip
 * it's about to attach.
 */
sealed interface TagAttachPlan {
    /** The input names a tag the company already has — attach it by id. */
    data class Existing(val tag: Tag) : TagAttachPlan

    /** No such tag yet — POST { name } and let the server create-on-attach. */
    data class CreateNew(val name: String) : TagAttachPlan
}

/**
 * Resolve free-typed tag input against the loaded tag list: trim, reject
 * blank/oversized input (null = the Add affordance stays disabled), match
 * case-insensitively (tags_name_uq is on lower(name)), else create.
 */
fun resolveTagInput(input: String, existing: List<Tag>): TagAttachPlan? {
    val name = input.trim()
    if (name.isEmpty() || name.length > TAG_NAME_MAX) return null
    val match = existing.firstOrNull { it.name.equals(name, ignoreCase = true) }
    return if (match != null) TagAttachPlan.Existing(match) else TagAttachPlan.CreateNew(name)
}
