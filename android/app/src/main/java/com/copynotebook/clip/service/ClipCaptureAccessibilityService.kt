package com.copynotebook.clip.service

import android.accessibilityservice.AccessibilityService
import android.content.ClipboardManager
import android.view.accessibility.AccessibilityEvent
import com.copynotebook.clip.data.ClipRepository
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch

/**
 * A no-op accessibility service whose only purpose is to hold clipboard
 * read access.
 *
 * Since Android 10, [ClipboardManager.getPrimaryClip] returns null for apps
 * that are not the foreground app or the default input method - this is a
 * deliberate privacy restriction. Accessibility services are exempted from
 * this restriction, which is the standard technique real clipboard-manager
 * apps (and this one) use to notice a copy anywhere on the device, not only
 * while this app itself is open.
 *
 * The user must turn this on manually from Settings > Accessibility -
 * that permission grant cannot be automated, by design.
 */
class ClipCaptureAccessibilityService : AccessibilityService() {

    private val serviceScope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private lateinit var clipboardManager: ClipboardManager
    private lateinit var repository: ClipRepository
    private var lastCapturedText: String? = null

    private val clipListener = ClipboardManager.OnPrimaryClipChangedListener {
        captureCurrentClip()
    }

    override fun onServiceConnected() {
        super.onServiceConnected()
        clipboardManager = getSystemService(ClipboardManager::class.java)
        repository = ClipRepository(applicationContext)
        clipboardManager.addPrimaryClipChangedListener(clipListener)
    }

    private fun captureCurrentClip() {
        val clip = clipboardManager.primaryClip ?: return
        if (clip.itemCount == 0) return

        val text = clip.getItemAt(0).coerceToText(this)?.toString()?.trim()
        if (text.isNullOrEmpty()) return
        if (text == lastCapturedText) return
        lastCapturedText = text

        serviceScope.launch {
            repository.capture(text)
        }
    }

    // Required override; clipboard capture happens via the listener above,
    // so no per-event handling is needed here.
    override fun onAccessibilityEvent(event: AccessibilityEvent?) = Unit

    override fun onInterrupt() = Unit

    override fun onDestroy() {
        super.onDestroy()
        if (::clipboardManager.isInitialized) {
            clipboardManager.removePrimaryClipChangedListener(clipListener)
        }
    }
}
