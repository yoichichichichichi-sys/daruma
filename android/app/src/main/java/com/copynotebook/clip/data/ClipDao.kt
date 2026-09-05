package com.copynotebook.clip.data

import androidx.room.Dao
import androidx.room.Delete
import androidx.room.Insert
import androidx.room.Query
import kotlinx.coroutines.flow.Flow

@Dao
interface ClipDao {

    @Query("SELECT * FROM clip_entries ORDER BY pinned DESC, createdAt DESC")
    fun observeAll(): Flow<List<ClipEntry>>

    @Query("SELECT * FROM clip_entries WHERE text = :text LIMIT 1")
    suspend fun findByText(text: String): ClipEntry?

    @Insert
    suspend fun insert(entry: ClipEntry): Long

    @Delete
    suspend fun delete(entry: ClipEntry)

    @Query("UPDATE clip_entries SET pinned = :pinned WHERE id = :id")
    suspend fun setPinned(id: Long, pinned: Boolean)

    @Query("DELETE FROM clip_entries")
    suspend fun deleteAll()

    /**
     * Synchronous query used by the home screen widget's RemoteViewsFactory,
     * which already runs off the main thread on a binder callback thread.
     */
    @Query("SELECT * FROM clip_entries ORDER BY pinned DESC, createdAt DESC LIMIT :limit")
    fun getRecentForWidget(limit: Int): List<ClipEntry>

    /** Synchronous lookup used by the widget's tap-to-copy broadcast receiver. */
    @Query("SELECT text FROM clip_entries WHERE id = :id")
    fun getTextByIdBlocking(id: Long): String?
}
