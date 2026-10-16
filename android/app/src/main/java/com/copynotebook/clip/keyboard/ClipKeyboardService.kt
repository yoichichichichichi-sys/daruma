package com.copynotebook.clip.keyboard

import android.content.ClipboardManager
import android.inputmethodservice.InputMethodService
import android.os.Build
import android.text.InputType
import android.view.KeyEvent
import android.view.LayoutInflater
import android.view.View
import android.view.inputmethod.EditorInfo
import android.view.inputmethod.InputMethodManager
import android.widget.LinearLayout
import android.widget.TextView
import androidx.core.content.ContextCompat
import androidx.recyclerview.widget.LinearLayoutManager
import androidx.recyclerview.widget.RecyclerView
import com.copynotebook.clip.R
import com.copynotebook.clip.data.ClipCategory
import com.copynotebook.clip.data.ClipEntry
import com.copynotebook.clip.data.ClipRepository
import com.copynotebook.clip.data.category
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch

/**
 * The "paste from the list" half of the app.
 *
 * Neither Android nor iOS lets a third-party app change the system's
 * long-press "Paste" menu - it always pastes only the latest copy. The one
 * place an app is allowed to type into *any* other app's text field is the
 * keyboard, so this is a small keyboard whose keys are the saved clips:
 * switch to it with the keyboard-switch (🌐) button, tap any clip - the
 * latest, 2 before, 30 before, it doesn't matter - and it is inserted at
 * the cursor. Then switch back to your normal keyboard.
 *
 * Bonus: while it is the active keyboard, Android lets an input method read
 * the clipboard, so whatever is on the clipboard when it opens is also
 * filed into the history (useful when the accessibility service is off).
 */
class ClipKeyboardService : InputMethodService() {

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main)
    private lateinit var repository: ClipRepository
    private lateinit var adapter: KeyboardClipAdapter
    private lateinit var tabContainer: LinearLayout
    private lateinit var emptyView: TextView

    private var allEntries: List<ClipEntry> = emptyList()
    private var lastCapturedText: String? = null
    /** null = 「すべて」 tab. */
    private var selectedCategory: ClipCategory? = null

    override fun onCreate() {
        super.onCreate()
        repository = ClipRepository(applicationContext)
    }

    override fun onCreateInputView(): View {
        val view = LayoutInflater.from(this).inflate(R.layout.keyboard_clip_picker, null)

        adapter = KeyboardClipAdapter { entry -> insert(entry.text) }
        view.findViewById<RecyclerView>(R.id.keyboard_clip_list).apply {
            layoutManager = LinearLayoutManager(this@ClipKeyboardService)
            adapter = this@ClipKeyboardService.adapter
        }
        tabContainer = view.findViewById(R.id.keyboard_tabs)
        emptyView = view.findViewById(R.id.keyboard_empty)

        view.findViewById<View>(R.id.key_switch).setOnClickListener { switchBack() }
        view.findViewById<View>(R.id.key_space).setOnClickListener { insert(" ") }
        view.findViewById<View>(R.id.key_backspace).setOnClickListener { backspace() }
        view.findViewById<View>(R.id.key_enter).setOnClickListener { enter() }

        buildTabs()
        scope.launch {
            repository.observeAll().collect { entries ->
                allEntries = entries
                render()
            }
        }
        return view
    }

    override fun onStartInputView(info: EditorInfo?, restarting: Boolean) {
        super.onStartInputView(info, restarting)
        captureClipboard()
    }

    private fun captureClipboard() {
        val clipboard = getSystemService(ClipboardManager::class.java) ?: return
        val text = clipboard.primaryClip
            ?.takeIf { it.itemCount > 0 }
            ?.getItemAt(0)
            ?.coerceToText(this)
            ?.toString()
        // Only file it once - otherwise every time the keyboard opens the same
        // clip would jump back to the top of the history.
        if (text.isNullOrBlank() || text == lastCapturedText) return
        lastCapturedText = text
        scope.launch(Dispatchers.IO) { repository.capture(text) }
    }

    private fun buildTabs() {
        tabContainer.removeAllViews()
        val tabs = listOf<ClipCategory?>(null) + ClipCategory.values()
        val inflater = LayoutInflater.from(this)
        tabs.forEach { category ->
            val tab = inflater.inflate(R.layout.keyboard_tab, tabContainer, false) as TextView
            tab.text = category?.let { "${it.emoji} ${it.label}" } ?: getString(R.string.category_all)
            tab.tag = category
            tab.setOnClickListener {
                selectedCategory = category
                render()
            }
            tabContainer.addView(tab)
        }
    }

    private fun render() {
        for (i in 0 until tabContainer.childCount) {
            val tab = tabContainer.getChildAt(i) as TextView
            val selected = tab.tag == selectedCategory
            tab.isSelected = selected
            tab.setTextColor(
                ContextCompat.getColor(this, if (selected) R.color.white else R.color.ink_soft)
            )
        }
        val visible = selectedCategory?.let { c -> allEntries.filter { it.category == c } } ?: allEntries
        adapter.submitList(visible)
        emptyView.visibility = if (visible.isEmpty()) View.VISIBLE else View.GONE
    }

    private fun insert(text: String) {
        currentInputConnection?.commitText(text, 1)
    }

    private fun backspace() {
        val ic = currentInputConnection ?: return
        val selected = ic.getSelectedText(0)
        if (selected.isNullOrEmpty()) {
            ic.deleteSurroundingText(1, 0)
        } else {
            ic.commitText("", 1)
        }
    }

    private fun enter() {
        val ic = currentInputConnection ?: return
        val action = currentInputEditorInfo?.imeOptions?.and(EditorInfo.IME_MASK_ACTION)
        val inputType = currentInputEditorInfo?.inputType ?: 0
        val multiLine = (inputType and InputType.TYPE_TEXT_FLAG_MULTI_LINE) != 0
        if (!multiLine && action != null && action != EditorInfo.IME_ACTION_NONE &&
            action != EditorInfo.IME_ACTION_UNSPECIFIED
        ) {
            ic.performEditorAction(action)
        } else {
            ic.sendKeyEvent(KeyEvent(KeyEvent.ACTION_DOWN, KeyEvent.KEYCODE_ENTER))
            ic.sendKeyEvent(KeyEvent(KeyEvent.ACTION_UP, KeyEvent.KEYCODE_ENTER))
        }
    }

    /** Back to whatever keyboard the user was typing with before. */
    private fun switchBack() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P && switchToPreviousInputMethod()) return
        getSystemService(InputMethodManager::class.java)?.showInputMethodPicker()
    }

    override fun onDestroy() {
        super.onDestroy()
        scope.cancel()
    }
}
