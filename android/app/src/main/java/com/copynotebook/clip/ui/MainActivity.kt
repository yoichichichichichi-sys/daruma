package com.copynotebook.clip.ui

import android.content.Intent
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
import androidx.recyclerview.widget.LinearLayoutManager
import com.copynotebook.clip.R
import com.copynotebook.clip.databinding.ActivityMainBinding
import kotlinx.coroutines.launch

private const val ACCESSIBILITY_SERVICE_COMPONENT =
    "com.copynotebook.clip/com.copynotebook.clip.service.ClipCaptureAccessibilityService"

class MainActivity : AppCompatActivity() {

    private lateinit var binding: ActivityMainBinding
    private val viewModel: HistoryViewModel by viewModels()
    private lateinit var adapter: HistoryAdapter

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivityMainBinding.inflate(layoutInflater)
        setContentView(binding.root)

        adapter = HistoryAdapter(
            onCopy = { Toast.makeText(this, R.string.toast_copied, Toast.LENGTH_SHORT).show() },
            onTogglePin = { viewModel.togglePin(it) },
            onDelete = { viewModel.delete(it) }
        )
        binding.historyList.layoutManager = LinearLayoutManager(this)
        binding.historyList.adapter = adapter

        binding.searchInput.addTextChangedListener { editable ->
            viewModel.setSearchQuery(editable?.toString().orEmpty())
        }

        binding.addButton.setOnClickListener {
            val text = binding.newEntryInput.text?.toString().orEmpty()
            if (text.isNotBlank()) {
                viewModel.addManualEntry(text)
                binding.newEntryInput.setText("")
                Toast.makeText(this, R.string.toast_saved, Toast.LENGTH_SHORT).show()
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
                viewModel.listItems.collect { items ->
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
