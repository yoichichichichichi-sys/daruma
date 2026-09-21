package com.videourlnotebook.ui

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.provider.Settings
import android.text.TextUtils
import android.view.View
import android.widget.Toast
import androidx.activity.viewModels
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import androidx.core.widget.addTextChangedListener
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.lifecycleScope
import androidx.lifecycle.repeatOnLifecycle
import androidx.recyclerview.widget.GridLayoutManager
import com.videourlnotebook.R
import com.videourlnotebook.data.UrlEntry
import com.videourlnotebook.databinding.ActivityMainBinding
import kotlinx.coroutines.launch

private const val ACCESSIBILITY_SERVICE_COMPONENT =
    "com.videourlnotebook/com.videourlnotebook.service.UrlCaptureAccessibilityService"
private const val GRID_SPAN_COUNT = 2

class MainActivity : AppCompatActivity() {

    private lateinit var binding: ActivityMainBinding
    private val viewModel: UrlGridViewModel by viewModels()
    private lateinit var adapter: UrlGridAdapter

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivityMainBinding.inflate(layoutInflater)
        setContentView(binding.root)

        adapter = UrlGridAdapter(
            onOpen = { openUrl(it) },
            onLongPress = { showItemMenu(it) }
        )
        binding.itemGrid.layoutManager = GridLayoutManager(this, GRID_SPAN_COUNT)
        binding.itemGrid.adapter = adapter

        binding.searchInput.addTextChangedListener { editable ->
            viewModel.setSearchQuery(editable?.toString().orEmpty())
        }

        binding.addButton.setOnClickListener {
            val text = binding.newUrlInput.text?.toString().orEmpty()
            if (text.isNotBlank()) {
                viewModel.addManualEntry(text) { success ->
                    if (success) {
                        binding.newUrlInput.setText("")
                        Toast.makeText(this, R.string.toast_saved, Toast.LENGTH_SHORT).show()
                    } else {
                        Toast.makeText(this, R.string.toast_invalid_url, Toast.LENGTH_SHORT).show()
                    }
                }
            }
        }

        binding.readClipboardButton.setOnClickListener {
            val clipboardManager = getSystemService(ClipboardManager::class.java)
            val text = clipboardManager.primaryClip
                ?.takeIf { it.itemCount > 0 }
                ?.getItemAt(0)
                ?.coerceToText(this)
                ?.toString()
                .orEmpty()
            if (text.isBlank()) {
                Toast.makeText(this, R.string.toast_clipboard_empty, Toast.LENGTH_SHORT).show()
                return@setOnClickListener
            }
            viewModel.addManualEntry(text) { success ->
                val message = if (success) R.string.toast_saved else R.string.toast_invalid_url
                Toast.makeText(this, message, Toast.LENGTH_SHORT).show()
            }
        }

        binding.clearAllButton.setOnClickListener {
            AlertDialog.Builder(this)
                .setMessage(R.string.confirm_clear_all)
                .setPositiveButton(R.string.delete_all) { _, _ -> viewModel.clearAll() }
                .setNegativeButton(R.string.cancel, null)
                .show()
        }

        binding.enableAccessibilityButton.setOnClickListener {
            startActivity(Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS))
        }

        lifecycleScope.launch {
            repeatOnLifecycle(Lifecycle.State.STARTED) {
                viewModel.items.collect { items ->
                    adapter.submitList(items)
                    binding.emptyMessage.visibility = if (items.isEmpty()) View.VISIBLE else View.GONE
                }
            }
        }
    }

    override fun onResume() {
        super.onResume()
        binding.accessibilityBanner.visibility =
            if (isAccessibilityServiceEnabled()) View.GONE else View.VISIBLE
    }

    private fun openUrl(entry: UrlEntry) {
        startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(entry.url)))
    }

    private fun showItemMenu(entry: UrlEntry) {
        AlertDialog.Builder(this)
            .setTitle(entry.title)
            .setItems(arrayOf(getString(R.string.copy_url_action), getString(R.string.delete_action))) { _, which ->
                when (which) {
                    0 -> {
                        val clipboardManager = getSystemService(ClipboardManager::class.java)
                        clipboardManager.setPrimaryClip(ClipData.newPlainText("url", entry.url))
                        Toast.makeText(this, R.string.toast_copied, Toast.LENGTH_SHORT).show()
                    }
                    1 -> viewModel.delete(entry)
                }
            }
            .show()
    }

    private fun isAccessibilityServiceEnabled(): Boolean {
        val enabledServices = Settings.Secure.getString(
            contentResolver,
            Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES
        ) ?: return false

        val splitter = TextUtils.SimpleStringSplitter(':')
        splitter.setString(enabledServices)
        while (splitter.hasNext()) {
            if (splitter.next().equals(ACCESSIBILITY_SERVICE_COMPONENT, ignoreCase = true)) {
                return true
            }
        }
        return false
    }
}
