package com.thestackcore.app

import android.content.Intent
import android.net.Uri
import android.provider.OpenableColumns
import io.flutter.embedding.android.FlutterActivity
import io.flutter.embedding.engine.FlutterEngine
import io.flutter.plugin.common.MethodChannel
import java.io.File
import java.util.UUID

/**
 * Receives shared/opened statement files (SEND/VIEW intents), stages a copy
 * in the cache dir, and hands the path to Dart over the stackcore/share
 * channel — parking it for the drain call when Dart isn't attached yet.
 */
class MainActivity : FlutterActivity() {
    private var shareChannel: MethodChannel? = null
    private var pendingSharedFile: Map<String, String>? = null

    override fun configureFlutterEngine(flutterEngine: FlutterEngine) {
        super.configureFlutterEngine(flutterEngine)
        val channel = MethodChannel(
            flutterEngine.dartExecutor.binaryMessenger,
            "stackcore/share"
        )
        shareChannel = channel
        channel.setMethodCallHandler { call, result ->
            when (call.method) {
                "getLaunchSharedFile" -> {
                    result.success(pendingSharedFile)
                    pendingSharedFile = null
                }
                else -> result.notImplemented()
            }
        }
        // Cold start via a share/open intent.
        handleShareIntent(intent)
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        handleShareIntent(intent)
    }

    private fun handleShareIntent(intent: Intent?) {
        if (intent == null) return
        @Suppress("DEPRECATION")
        val uri: Uri = when (intent.action) {
            Intent.ACTION_SEND -> intent.getParcelableExtra(Intent.EXTRA_STREAM)
            Intent.ACTION_VIEW -> intent.data
            else -> null
        } ?: return
        // Consume the action so a configuration change doesn't re-import.
        intent.action = Intent.ACTION_MAIN

        val name = displayNameFor(uri) ?: "statement"
        val staged = try {
            val dir = File(cacheDir, "shared-${UUID.randomUUID()}")
            dir.mkdirs()
            val out = File(dir, name)
            contentResolver.openInputStream(uri)?.use { input ->
                out.outputStream().use { output -> input.copyTo(output) }
            } ?: return
            out
        } catch (e: Exception) {
            return
        }

        val payload = mapOf("path" to staged.path, "name" to name)
        val channel = shareChannel
        if (channel != null) {
            channel.invokeMethod(
                "onSharedFile",
                payload,
                object : MethodChannel.Result {
                    override fun success(result: Any?) {}
                    override fun error(code: String, msg: String?, details: Any?) {}
                    override fun notImplemented() {
                        // No Dart handler yet (cold start) — park it.
                        pendingSharedFile = payload
                    }
                }
            )
        } else {
            pendingSharedFile = payload
        }
    }

    private fun displayNameFor(uri: Uri): String? {
        if (uri.scheme == "file") return uri.lastPathSegment
        return contentResolver.query(uri, null, null, null, null)?.use { cursor ->
            val index = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME)
            if (index >= 0 && cursor.moveToFirst()) cursor.getString(index) else null
        }
    }
}
