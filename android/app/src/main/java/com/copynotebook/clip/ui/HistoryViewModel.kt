package com.copynotebook.clip.ui

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.copynotebook.clip.data.ClipCategory
import com.copynotebook.clip.data.ClipEntry
import com.copynotebook.clip.data.ClipRepository
import com.copynotebook.clip.data.category
import com.copynotebook.clip.util.DateFormatting
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch

class HistoryViewModel(application: Application) : AndroidViewModel(application) {

    private val repository = ClipRepository(application)
    private val searchQuery = MutableStateFlow("")
    /** null = show every category. */
    private val categoryFilter = MutableStateFlow<ClipCategory?>(null)

    val listItems = combine(repository.observeAll(), searchQuery, categoryFilter) { entries, query, category ->
        val filtered = entries.filter { entry ->
            (query.isBlank() || entry.text.contains(query, ignoreCase = true)) &&
                (category == null || entry.category == category)
        }

        val pinned = filtered.filter { it.pinned }
        val unpinned = filtered.filter { !it.pinned }

        val result = mutableListOf<HistoryListItem>()
        if (pinned.isNotEmpty()) {
            result.add(HistoryListItem.SectionHeader("📌 ピン留め"))
            pinned.forEach { result.add(HistoryListItem.Clip(it)) }
        }

        var lastDayKey: Long? = null
        unpinned.forEach { entry ->
            val dayKey = DateFormatting.dayKey(entry.createdAt)
            if (dayKey != lastDayKey) {
                result.add(HistoryListItem.SectionHeader(DateFormatting.dayLabel(entry.createdAt)))
                lastDayKey = dayKey
            }
            result.add(HistoryListItem.Clip(entry))
        }
        result
    }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5000), emptyList())

    fun setSearchQuery(query: String) {
        searchQuery.value = query
    }

    fun setCategoryFilter(category: ClipCategory?) {
        categoryFilter.value = category
    }

    fun togglePin(entry: ClipEntry) {
        viewModelScope.launch { repository.togglePin(entry) }
    }

    fun delete(entry: ClipEntry) {
        viewModelScope.launch { repository.delete(entry) }
    }

    fun addManualEntry(text: String) {
        viewModelScope.launch { repository.capture(text) }
    }

    fun clearAll() {
        viewModelScope.launch { repository.clearAll() }
    }
}
