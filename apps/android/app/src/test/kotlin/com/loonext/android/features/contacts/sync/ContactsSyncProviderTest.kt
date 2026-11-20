package com.loonext.android.features.contacts.sync

import android.accounts.Account
import android.content.ContentProvider
import android.content.ContentUris
import android.content.ContentValues
import android.content.Context
import android.content.Intent
import android.content.SyncResult
import android.content.pm.PackageManager
import android.database.MatrixCursor
import android.net.Uri
import android.os.Bundle
import android.provider.ContactsContract
import android.provider.ContactsContract.AggregationExceptions
import android.provider.ContactsContract.CommonDataKinds.Phone
import android.provider.ContactsContract.Data
import android.provider.ContactsContract.RawContacts
import androidx.test.core.app.ApplicationProvider
import com.loonext.android.MainActivity
import com.loonext.android.R
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.xmlpull.v1.XmlPullParser

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class ContactsSyncProviderTest {
    @Test
    fun contactsActionsAreDeclaredAndRoutableInThisBuild() {
        val context = ApplicationProvider.getApplicationContext<Context>()
        val mimeTypes = setOf(callMimeType(context.packageName), textMimeType(context.packageName))
        val declaredTypes = mutableSetOf<String>()
        context.resources.getXml(R.xml.contacts).use { xml ->
            while (xml.next() != XmlPullParser.END_DOCUMENT) {
                if (xml.eventType == XmlPullParser.START_TAG && xml.name == "ContactsDataKind") {
                    val mimeType = xml.getAttributeValue("http://schemas.android.com/apk/res/android", "mimeType")
                    declaredTypes += checkNotNull(mimeType)
                }
            }
        }
        assertEquals(mimeTypes, declaredTypes)

        for (mimeType in mimeTypes) {
            val intent = Intent(Intent.ACTION_VIEW).setType(mimeType).setPackage(context.packageName)
            val activity = context.packageManager.resolveActivity(intent, PackageManager.MATCH_DEFAULT_ONLY)
            assertEquals(MainActivity::class.java.name, activity?.activityInfo?.name)
        }
    }

    @Test
    fun syncLeavesTheNativePhoneOnItsOriginalContact() {
        val context = ApplicationProvider.getApplicationContext<Context>()
        val provider = Robolectric.setupContentProvider(
            ContactsProbe::class.java,
            ContactsContract.AUTHORITY,
        )
        val account = Account(LOONEXT_ACCOUNT_NAME, LOONEXT_ACCOUNT_TYPE)
        val result = SyncResult()
        val providerClient = checkNotNull(
            context.contentResolver.acquireContentProviderClient(ContactsContract.AUTHORITY),
        )
        providerClient.use {
            ContactsSyncAdapter(context).onPerformSync(account, Bundle(), ContactsContract.AUTHORITY, it, result)
        }

        assertFalse(result.hasError())
        assertEquals(listOf(LOONEXT_ACCOUNT_NAME, LOONEXT_ACCOUNT_TYPE), provider.deletedAccount)
        assertEquals(LOONEXT_ACCOUNT_TYPE, provider.rawAccount)
        assertEquals(LOONEXT_ACCOUNT_TYPE, provider.excludedSourceAccount)
        assertEquals(
            setOf(callMimeType(context.packageName), textMimeType(context.packageName)),
            provider.writtenTypes,
        )
        assertFalse(Phone.CONTENT_ITEM_TYPE in provider.writtenTypes)
        assertEquals(10L, provider.attachedToRawId)
    }

    class ContactsProbe : ContentProvider() {
        var deletedAccount: List<String>? = null
        var rawAccount: String? = null
        var excludedSourceAccount: String? = null
        val writtenTypes = mutableSetOf<String>()
        var attachedToRawId: Long? = null

        override fun onCreate() = true
        override fun getType(uri: Uri): String? = null

        override fun query(
            uri: Uri,
            projection: Array<out String>?,
            selection: String?,
            selectionArgs: Array<out String>?,
            sortOrder: String?,
        ): MatrixCursor {
            require(uri == Phone.CONTENT_URI)
            excludedSourceAccount = selectionArgs?.singleOrNull()
            return MatrixCursor(arrayOf(Data.CONTACT_ID, Data.RAW_CONTACT_ID, Phone.NUMBER)).apply {
                addRow(arrayOf<Any>(1L, 10L, "+14165550100"))
            }
        }

        override fun delete(uri: Uri, selection: String?, selectionArgs: Array<out String>?): Int {
            require(uri.path == RawContacts.CONTENT_URI.path)
            deletedAccount = selectionArgs?.toList()
            return 1
        }

        override fun insert(uri: Uri, values: ContentValues?): Uri {
            val row = checkNotNull(values)
            when (uri.path) {
                RawContacts.CONTENT_URI.path -> rawAccount = row.getAsString(RawContacts.ACCOUNT_TYPE)
                Data.CONTENT_URI.path -> writtenTypes += row.getAsString(Data.MIMETYPE)
                else -> error("Unexpected contacts insert")
            }
            return ContentUris.withAppendedId(uri, 100L)
        }

        override fun update(
            uri: Uri,
            values: ContentValues?,
            selection: String?,
            selectionArgs: Array<out String>?,
        ): Int {
            require(uri.path == AggregationExceptions.CONTENT_URI.path)
            attachedToRawId = values?.getAsLong(AggregationExceptions.RAW_CONTACT_ID2)
            return 1
        }
    }
}
