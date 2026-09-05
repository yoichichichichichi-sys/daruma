package com.copynotebook.clip.util

import java.text.SimpleDateFormat
import java.util.Calendar
import java.util.Date
import java.util.Locale

object DateFormatting {

    private val weekdayFormat = SimpleDateFormat("M月d日(E)", Locale.JAPAN)
    private val timeFormat = SimpleDateFormat("H:mm", Locale.JAPAN)

    /** "今日" / "昨日" / "9月3日(木)" style label for a date-grouped section header. */
    fun dayLabel(timestampMillis: Long): String {
        val target = Calendar.getInstance().apply { timeInMillis = timestampMillis }
        val today = Calendar.getInstance()
        val yesterday = Calendar.getInstance().apply { add(Calendar.DAY_OF_YEAR, -1) }

        return when {
            isSameDay(target, today) -> "今日"
            isSameDay(target, yesterday) -> "昨日"
            else -> weekdayFormat.format(Date(timestampMillis))
        }
    }

    fun timeLabel(timestampMillis: Long): String = timeFormat.format(Date(timestampMillis))

    private fun isSameDay(a: Calendar, b: Calendar): Boolean =
        a.get(Calendar.YEAR) == b.get(Calendar.YEAR) && a.get(Calendar.DAY_OF_YEAR) == b.get(Calendar.DAY_OF_YEAR)

    /** Midnight-aligned key used to detect when a new date-header should be inserted. */
    fun dayKey(timestampMillis: Long): Long {
        val cal = Calendar.getInstance().apply {
            timeInMillis = timestampMillis
            set(Calendar.HOUR_OF_DAY, 0)
            set(Calendar.MINUTE, 0)
            set(Calendar.SECOND, 0)
            set(Calendar.MILLISECOND, 0)
        }
        return cal.timeInMillis
    }
}
