package com.videourlnotebook.ui

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.videourlnotebook.data.UrlEntry
import com.videourlnotebook.data.UrlRepository
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch

class UrlGridViewModel(application: Application) : AndroidViewModel(application) {

    private val repository = UrlRepository(application)
    private val searchQuery = MutableStateFlow("")

    val items = combine(repository.observeAll(), searchQuery) { entries, query ->
        if (query.isBlank()) {
            entries
        } else {
            entries.filter {
                it.title.contains(query, ignoreCase = true) ||
                    it.siteName.contains(query, ignoreCase = true) ||
                    it.url.contains(query, ignoreCase = true)
            }
        }
    }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5000), emptyList())

    fun setSearchQuery(query: String) {
        searchQuery.value = query
    }

    fun addManualEntry(text: String, onResult: (Boolean) -> Unit) {
        viewModelScope.launch {
            onResult(repository.capture(text) != null)
        }
    }

    fun delete(entry: UrlEntry) {
        viewModelScope.launch { repository.delete(entry) }
    }

    fun clearAll() {
        viewModelScope.launch { repository.clearAll() }
    }
}
