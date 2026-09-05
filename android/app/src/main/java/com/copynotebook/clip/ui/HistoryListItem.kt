package com.copynotebook.clip.ui

import com.copynotebook.clip.data.ClipEntry

sealed class HistoryListItem {
    data class SectionHeader(val label: String) : HistoryListItem()
    data class Clip(val entry: ClipEntry) : HistoryListItem()
}
