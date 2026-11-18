package com.loonext.android.core.auth

import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

private const val KEY_STORE = "AndroidKeyStore"
private const val KEY_ALIAS = "loonext-workspace-cache"
private const val CIPHER = "AES/GCM/NoPadding"
private const val IV_BYTES = 12
private const val TAG_BITS = 128
private const val MAX_BYTES = 5 * 1024 * 1024

internal object WorkspaceCacheCipher {
    @Synchronized
    private fun key(create: Boolean): SecretKey? {
        val store = KeyStore.getInstance(KEY_STORE).apply { load(null) }
        val existing = store.getKey(KEY_ALIAS, null) as? SecretKey
        if (existing != null || !create) return existing

        val spec = KeyGenParameterSpec.Builder(
            KEY_ALIAS,
            KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT,
        )
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
            .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
            .setKeySize(256)
            .build()
        return KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, KEY_STORE).apply {
            init(spec)
        }.generateKey()
    }

    fun encrypt(value: String): String {
        val plain = value.encodeToByteArray()
        require(plain.size <= MAX_BYTES)
        val cipher = Cipher.getInstance(CIPHER)
        cipher.init(Cipher.ENCRYPT_MODE, requireNotNull(key(create = true)))
        check(cipher.iv.size == IV_BYTES)
        return Base64.encodeToString(cipher.iv + cipher.doFinal(plain), Base64.NO_WRAP)
    }

    fun decrypt(value: String): String? {
        val bytes = Base64.decode(value, Base64.NO_WRAP)
        val key = key(create = false) ?: return null
        val cipher = Cipher.getInstance(CIPHER)
        cipher.init(Cipher.DECRYPT_MODE, key, GCMParameterSpec(TAG_BITS, bytes, 0, IV_BYTES))
        return cipher.doFinal(bytes, IV_BYTES, bytes.size - IV_BYTES).decodeToString()
    }
}
