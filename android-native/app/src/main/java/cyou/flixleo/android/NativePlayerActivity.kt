package cyou.flixleo.android

import android.app.Activity
import android.app.AlertDialog
import android.content.Intent
import android.content.pm.ActivityInfo
import android.graphics.Color
import android.net.Uri
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.view.WindowManager
import android.widget.Button
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.SeekBar
import android.widget.TextView
import android.widget.Toast
import org.videolan.libvlc.LibVLC
import org.videolan.libvlc.Media
import org.videolan.libvlc.MediaPlayer
import org.videolan.libvlc.util.VLCVideoLayout
import kotlin.math.max

/**
 * In-app VLC player: a real native decoder, not the Android WebView HTML video
 * element nor an intent to an external VLC installation.
 */
class NativePlayerActivity : Activity() {
    private var library: LibVLC? = null
    private var player: MediaPlayer? = null
    private var surface: VLCVideoLayout? = null
    private lateinit var controls: LinearLayout
    private lateinit var seek: SeekBar
    private lateinit var elapsed: TextView
    private lateinit var playButton: Button
    private val handler = Handler(Looper.getMainLooper())
    private var scrubbing = false
    private var controlsShown = true
    private var resumeAtMs = 0L
    private var ended = false
    private var lastDuration = 0L
    private var lastPosition = 0L
    private var displayAspect = 0

    private val hideControls = Runnable {
        if (!isFinishing && ::controls.isInitialized) {
            controls.visibility = View.GONE
            controlsShown = false
        }
    }
    private val ticker = object : Runnable {
        override fun run() {
            val video = player
            if (video != null) {
                try {
                    val duration = video.length.coerceAtLeast(0L)
                    val position = video.time.coerceAtLeast(0L)
                    if (duration > 0) lastDuration = duration
                    if (position > 0) lastPosition = position
                    if (resumeAtMs > 0 && duration > 0 && resumeAtMs < duration - 10_000) {
                        video.time = resumeAtMs
                        resumeAtMs = 0
                    }
                    if (!scrubbing) {
                        seek.isEnabled = duration > 0 && video.isSeekable
                        seek.max = max(1, (duration / 1000L).coerceAtMost(Int.MAX_VALUE.toLong()).toInt())
                        seek.progress = (position / 1000L).coerceAtMost(seek.max.toLong()).toInt()
                    }
                    elapsed.text = if (duration > 0) "${time(position)} / ${time(duration)}" else "LIVE"
                    playButton.text = if (video.isPlaying) "Ⅱ" else "▶"
                } catch (_: Exception) { }
            }
            handler.postDelayed(this, 500)
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        requestedOrientation = ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON or WindowManager.LayoutParams.FLAG_FULLSCREEN)
        window.decorView.systemUiVisibility = (View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
            or View.SYSTEM_UI_FLAG_HIDE_NAVIGATION or View.SYSTEM_UI_FLAG_FULLSCREEN
            or View.SYSTEM_UI_FLAG_LAYOUT_STABLE or View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION)
        val uri = intent.getStringExtra("stream_url")?.let { runCatching { Uri.parse(it) }.getOrNull() }
        if (uri == null || uri.scheme != "https" || uri.host.isNullOrBlank() ||
            uri.host.equals("localhost", true)) {
            Toast.makeText(this, "Invalid HTTPS stream", Toast.LENGTH_LONG).show()
            finish()
            return
        }
        resumeAtMs = intent.getLongExtra("resume_ms", 0).coerceAtLeast(0L)
        val root = FrameLayout(this).apply { setBackgroundColor(Color.BLACK) }
        val videoView = VLCVideoLayout(this)
        surface = videoView
        root.addView(videoView, FrameLayout.LayoutParams(-1, -1))

        val toolbar = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(Color.argb(230, 10, 13, 20))
            setPadding(dp(14), dp(8), dp(14), dp(10))
        }
        controls = toolbar
        val header = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL }
        header.addView(button("✕") { closePlayer() })
        header.addView(TextView(this).apply {
            text = intent.getStringExtra("title")?.take(90).orEmpty().ifBlank { "FlixLeo" }
            setTextColor(Color.WHITE); textSize = 16f; setSingleLine(true)
            setPadding(dp(12), 0, 0, 0)
        }, LinearLayout.LayoutParams(0, dp(42), 1f))
        toolbar.addView(header)
        seek = SeekBar(this)
        toolbar.addView(seek, LinearLayout.LayoutParams(-1, dp(35)))
        seek.setOnSeekBarChangeListener(object : SeekBar.OnSeekBarChangeListener {
            override fun onStartTrackingTouch(bar: SeekBar) { scrubbing = true; showControls() }
            override fun onStopTrackingTouch(bar: SeekBar) {
                player?.let { if (it.isSeekable) it.time = bar.progress.toLong() * 1000L }
                scrubbing = false; showControls()
            }
            override fun onProgressChanged(bar: SeekBar, value: Int, fromUser: Boolean) {
                if (fromUser) elapsed.text = time(value.toLong() * 1000L)
            }
        })
        val row = LinearLayout(this).apply { gravity = Gravity.CENTER_VERTICAL; orientation = LinearLayout.HORIZONTAL }
        elapsed = TextView(this).apply {
            text = "0:00"; setTextColor(Color.WHITE); textSize = 12f; setPadding(dp(3), 0, dp(10), 0)
        }
        row.addView(elapsed)
        row.addView(button("↶10") { skip(-10_000L) })
        playButton = button("Ⅱ") {
            player?.let { if (it.isPlaying) it.pause() else it.play() }
            showControls()
        }
        row.addView(playButton)
        row.addView(button("10↷") { skip(10_000L) })
        row.addView(button("Audio") { selectAudio() })
        row.addView(button("CC") { selectSubtitles() })
        row.addView(button("Aspect") { changeAspect() })
        toolbar.addView(row)
        root.addView(toolbar, FrameLayout.LayoutParams(-1, -2, Gravity.BOTTOM))
        root.setOnClickListener { if (controlsShown) { controls.visibility = View.GONE; controlsShown = false } else showControls() }
        setContentView(root)

        try {
            val vlc = LibVLC(this, arrayListOf("--network-caching=1200", "--audio-time-stretch"))
            library = vlc
            val video = MediaPlayer(vlc)
            player = video
            video.attachViews(videoView, null, false, false)
            video.setEventListener { event ->
                runOnUiThread {
                    if (isFinishing) return@runOnUiThread
                    when (event.type) {
                        MediaPlayer.Event.Playing -> { playButton.text = "Ⅱ"; showControls() }
                        MediaPlayer.Event.Paused -> { playButton.text = "▶"; showControls() }
                        MediaPlayer.Event.EndReached -> { ended = true; closePlayer() }
                        MediaPlayer.Event.EncounteredError -> {
                            Toast.makeText(this, "This server could not play. Try another quality.", Toast.LENGTH_LONG).show()
                            showControls()
                        }
                    }
                }
            }
            val media = Media(vlc, uri)
            media.setHWDecoderEnabled(true, false)
            media.addOption(":network-caching=1200")
            video.media = media
            media.release()
            video.play()
            handler.post(ticker)
            showControls()
        } catch (e: Exception) {
            Toast.makeText(this, "Native video player unavailable: ${e.localizedMessage}", Toast.LENGTH_LONG).show()
            closePlayer()
        }
    }

    private fun time(ms: Long): String {
        val t = ms.coerceAtLeast(0L) / 1000L
        return if (t >= 3600) "%d:%02d:%02d".format(t / 3600, (t % 3600) / 60, t % 60)
        else "%d:%02d".format(t / 60, t % 60)
    }

    private fun dp(value: Int): Int = (value * resources.displayMetrics.density).toInt()
    private fun button(label: String, action: () -> Unit): Button = Button(this).apply {
        text = label
        isAllCaps = false
        textSize = 12f
        setTextColor(Color.WHITE)
        setBackgroundColor(Color.rgb(34, 39, 52))
        minWidth = dp(44)
        minHeight = dp(42)
        setOnClickListener { action(); showControls() }
    }
    private fun showControls() {
        if (!::controls.isInitialized) return
        controls.visibility = View.VISIBLE
        controlsShown = true
        handler.removeCallbacks(hideControls)
        handler.postDelayed(hideControls, 4500L)
    }
    private fun skip(amount: Long) {
        player?.let {
            if (it.isSeekable) it.time = (it.time + amount).coerceIn(0L, max(it.length, 0L))
        }
    }
    private fun selectAudio() {
        val video = player ?: return
        val tracks = video.audioTracks?.filter { it.id >= 0 } ?: emptyList()
        if (tracks.isEmpty()) { Toast.makeText(this, "No audio tracks detected yet", Toast.LENGTH_SHORT).show(); return }
        AlertDialog.Builder(this).setTitle("Audio language")
            .setSingleChoiceItems(tracks.map { it.name ?: "Audio ${it.id}" }.toTypedArray(),
                tracks.indexOfFirst { it.id == video.audioTrack }) { dialog, which ->
                video.audioTrack = tracks[which].id
                dialog.dismiss()
            }.setNegativeButton("Cancel", null).show()
    }
    private fun selectSubtitles() {
        val video = player ?: return
        val tracks = video.spuTracks?.filter { it.id >= 0 } ?: emptyList()
        val names = arrayOf("Off") + tracks.map { it.name ?: "Subtitle ${it.id}" }
        AlertDialog.Builder(this).setTitle("Subtitle language")
            .setSingleChoiceItems(names, tracks.indexOfFirst { it.id == video.spuTrack } + 1) { dialog, which ->
                video.spuTrack = if (which == 0) -1 else tracks[which - 1].id
                dialog.dismiss()
            }.setNegativeButton("Cancel", null).show()
    }
    private fun changeAspect() {
        val video = player ?: return
        val names = arrayOf("Original (Auto)", "16:9", "4:3", "21:9")
        AlertDialog.Builder(this).setTitle("Aspect ratio")
            .setSingleChoiceItems(names, displayAspect) { dialog, which ->
                displayAspect = which
                video.aspectRatio = when(which) { 1 -> "16:9"; 2 -> "4:3"; 3 -> "21:9"; else -> null }
                video.scale = 0f
                dialog.dismiss()
            }.setNegativeButton("Cancel", null).show()
    }

    private fun closePlayer() {
        try {
            player?.let {
                if (it.time > 0) lastPosition = it.time
                if (it.length > 0) lastDuration = it.length
            }
        } catch (_: Exception) { }
        setResult(RESULT_OK, Intent().apply {
            putExtra("position_ms", lastPosition)
            putExtra("duration_ms", lastDuration)
            putExtra("ended", ended)
            putExtra("mirror_id", intent.getStringExtra("mirror_id"))
        })
        finish()
    }
    @Deprecated("Deprecated in Java")
    override fun onBackPressed() { closePlayer() }

    override fun onPause() {
        super.onPause()
        if (!isFinishing) player?.let { if (it.isPlaying) it.pause() }
    }
    override fun onDestroy() {
        handler.removeCallbacks(ticker)
        handler.removeCallbacks(hideControls)
        player?.let {
            try { it.setEventListener(null); it.stop(); it.detachViews(); it.release() } catch (_: Exception) { }
        }
        player = null
        library?.release()
        library = null
        surface = null
        super.onDestroy()
    }
}
