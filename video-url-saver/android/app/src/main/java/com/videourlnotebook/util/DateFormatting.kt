package com.videourlnotebook.util

import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

object DateFormatting {
    private val timeFormat = SimpleDateFormat("HH:mm", Locale.JAPAN)
    private val fullFormat = SimpleDateFormat("yyyy/MM/dd HH:mm", Locale.JAPAN)

    fun label(timestampMillis: Long): String {
        val date = Date(timestampMillis)
        val isToday = SimpleDateFormat("yyyyMMdd", Locale.JAPAN).format(date) ==
            SimpleDateFormat("yyyyMMdd", Locale.JAPAN).format(Date())
        return if (isToday) "今日 ${timeFormat.format(date)}" else fullFormat.format(date)
    }
}
