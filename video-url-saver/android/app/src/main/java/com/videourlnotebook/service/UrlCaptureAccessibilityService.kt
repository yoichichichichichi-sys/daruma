package com.videourlnotebook.service

import android.accessibilityservice.AccessibilityService
import android.content.ClipboardManager
import android.view.accessibility.AccessibilityEvent
import com.videourlnotebook.data.UrlRepository
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch

/**
 * No-op accessibility service that exists only to keep clipboard read
 * access outside this app's own foreground window (see コピペ帳's
 * ClipCaptureAccessibilityService for the full rationale - Android blocks
 * background clipboard reads for privacy, and accessibility services are
 * exempted). Unlike that generic tool, this one silently ignores anything
 * that isn't a URL.
 */
class UrlCaptureAccessibilityService : AccessibilityService() {

    private val serviceScope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private lateinit var clipboardManager: ClipboardManager
    private lateinit var repository: UrlRepository
    private var lastSeenClip: String? = null

    private val clipListener = ClipboardManager.OnPrimaryClipChangedListener {
        captureCurrentClip()
    }

    override fun onServiceConnected() {
        super.onServiceConnected()
        clipboardManager = getSystemService(ClipboardManager::class.java)
        repository = UrlRepository(applicationContext)
        clipboardManager.addPrimaryClipChangedListener(clipListener)
    }

    private fun captureCurrentClip() {
        val clip = clipboardManager.primaryClip ?: return
        if (clip.itemCount == 0) return

        val text = clip.getItemAt(0).coerceToText(this)?.toString()?.trim()
        if (text.isNullOrEmpty()) return
        if (text == lastSeenClip) return
        lastSeenClip = text

        serviceScope.launch {
            repository.capture(text)
        }
    }

    override fun onAccessibilityEvent(event: AccessibilityEvent?) = Unit

    override fun onInterrupt() = Unit

    override fun onDestroy() {
        super.onDestroy()
        if (::clipboardManager.isInitialized) {
            clipboardManager.removePrimaryClipChangedListener(clipListener)
        }
    }
}
