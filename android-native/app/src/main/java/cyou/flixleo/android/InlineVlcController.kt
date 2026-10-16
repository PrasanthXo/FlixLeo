package cyou.flixleo.android

import android.content.Context
import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.util.Log
import androidx.compose.runtime.*
import org.videolan.libvlc.LibVLC
import org.videolan.libvlc.Media
import org.videolan.libvlc.MediaPlayer
import org.videolan.libvlc.util.VLCVideoLayout

/** All three player presentations share ONE libVLC instance and ONE video surface. */
enum class PlayerMode { CLOSED, BIG, MINI, FULLSCREEN }
enum class DecoderMode { AUTO, HARDWARE, SOFTWARE }

data class AudioChoice(val id: Int, val label: String)

class InlineVlcController(context: Context) {
    private val appContext = context.applicationContext
    private val handler = Handler(Looper.getMainLooper())
    private var libVlc: LibVLC? = null
    private var engine: MediaPlayer? = null
    private var surface: VLCVideoLayout? = null
    private var attached = false
    private var pendingStart = false
    private var resumeMs = 0L
    private var lastSavedAt = 0L
    private var closing = false
    private var playbackStarted = false
    private var recoveryUsed = false
    var decoderMode by mutableStateOf(DecoderMode.AUTO)
        private set
    private var softwareFallback = false
    private var activeStream: FlixStream? = null
    private var activeResume = 0.0
    private var retryTask: Runnable? = null
    var bufferPercent by mutableIntStateOf(0)
        private set

    private fun diagnose(event: String) {
        // Never log stream URLs or access tokens.
        Log.w("FlixLeoPlayer", "$event quality=$quality posMs=$position")
    }

    private fun failWithRecovery(reason: String) {
        diagnose(reason)
        buffering = false
        playing = false
        val stream = activeStream
        if (!recoveryUsed && stream != null && mode != PlayerMode.CLOSED) {
            recoveryUsed = true
            if (decoderMode == DecoderMode.AUTO) softwareFallback = true
            problem = "Recovering video playback…"
            val saved = if (position > 0) position / 1000.0 else activeResume
            val task = Runnable { if (!closing) start(stream, title, saved, true) }
            retryTask = task
            handler.postDelayed(task, 700)
        } else {
            problem = "Playback failed. Select another server."
            onError(problem)
        }
    }

    var mode by mutableStateOf(PlayerMode.CLOSED)
        private set
    var previousMode by mutableStateOf(PlayerMode.BIG)
        private set
    var title by mutableStateOf("")
        private set
    var quality by mutableStateOf("")
        private set
    var playing by mutableStateOf(false)
        private set
    var position by mutableLongStateOf(0L)
        private set
    var duration by mutableLongStateOf(0L)
        private set
    var buffering by mutableStateOf(true)
        private set
    var problem by mutableStateOf("")
        private set
    var controlsVisible by mutableStateOf(true)
    var inPictureInPicture by mutableStateOf(false)
    var canSeek by mutableStateOf(false)
        private set
    var trackRevision by mutableIntStateOf(0)
        private set
    var aspect by mutableIntStateOf(0)
        private set
    var onProgress: (Long, Long) -> Unit = { _, _ -> }
    var onCompleted: () -> Unit = {}
    var onError: (String) -> Unit = {}

    private val ticker = object : Runnable {
        override fun run() {
            try {
                engine?.let { video ->
                    val length = video.length.coerceAtLeast(0)
                    val time = video.time.coerceAtLeast(0)
                    if (length > 0) duration = length
                    if (time > 0) position = time
                    playing = video.isPlaying
                    canSeek = video.isSeekable
                    if (resumeMs > 0 && length > 0 && resumeMs < length - 10_000) {
                        video.setTime(resumeMs)
                        resumeMs = 0
                    }
                    if (time > 0 && System.currentTimeMillis() - lastSavedAt >= 15000) {
                        lastSavedAt = System.currentTimeMillis()
                        onProgress(time, length)
                    }
                }
            } catch (_: Exception) { /* a transient libVLC stream state */ }
            handler.postDelayed(this, 500)
        }
    }

    /** More prebuffering for high-bitrate VOD, but keep live channel latency low. */
    private fun networkCacheMs(stream: FlixStream): Int {
        val label = (stream.quality + " " + stream.name).lowercase()
        val live = stream.id.startsWith("plavio-live-") ||
            stream.url.contains(".m3u8", ignoreCase = true)
        if (live) return 1500
        return when {
            Regex("""2160p|4k|uhd""").containsMatchIn(label) -> 5000
            Regex("""1080p|fhd""").containsMatchIn(label) -> 3200
            else -> 2200
        }
    }

    fun chooseDecoder(mode: DecoderMode) {
        decoderMode = mode
        softwareFallback = mode == DecoderMode.SOFTWARE
        diagnose("decoder_selection_${mode.name}")
        val stream = activeStream ?: return
        if (this.mode != PlayerMode.CLOSED) {
            val at = if (position > 0) position / 1000.0 else activeResume
            start(stream, title, at)
        }
    }

    fun start(stream: FlixStream, displayTitle: String, resumeSeconds: Double = 0.0, recovering: Boolean = false) {
        if (Uri.parse(stream.url).scheme != "https") {
            onError("Only HTTPS video sources are supported")
            return
        }
        stop(notifyProgress = !recovering)
        closing = false
        recoveryUsed = recovering
        if (!recovering) softwareFallback = decoderMode == DecoderMode.SOFTWARE
        activeStream = stream
        activeResume = resumeSeconds
        playbackStarted = false
        title = displayTitle
        quality = stream.quality
        position = 0
        duration = 0
        playing = false
        buffering = true
        bufferPercent = 0
        canSeek = false
        problem = ""
        aspect = 0
        resumeMs = (resumeSeconds.coerceIn(0.0, 86400.0) * 1000).toLong()
        previousMode = PlayerMode.BIG
        controlsVisible = true
        mode = PlayerMode.BIG
        try {
            val cacheMs = networkCacheMs(stream)
            // Reuse the VLC library across server changes; repeated native library shutdown
            // and recreation can race Android surface/decoder teardown and crash the app.
            val vlc = libVlc ?: LibVLC(appContext, arrayListOf("--audio-time-stretch")).also { libVlc = it }
            val video = MediaPlayer(vlc)
            engine = video
            video.setEventListener { event ->
                handler.post {
                    if (engine !== video || closing) return@post
                    when (event.type) {
                        MediaPlayer.Event.Playing -> {
                            playbackStarted = true
                            playing = true
                            buffering = false
                            problem = ""
                            trackRevision++
                        }
                        MediaPlayer.Event.Paused -> {
                            playing = false
                            onProgress(position, duration)
                        }
                        MediaPlayer.Event.Buffering -> {
                            bufferPercent = event.buffering.toInt().coerceIn(0, 100)
                            buffering = bufferPercent < 100
                        }
                        MediaPlayer.Event.EndReached -> {
                            // A failed server or unsupported high-bitrate decoder can send
                            // EndReached before a single frame is actually played.
                            // Do not dismiss the player or mark the title watched.
                            val elapsed = maxOf(position, runCatching { video.time }.getOrDefault(0L))
                            val length = maxOf(duration, runCatching { video.length }.getOrDefault(0L))
                            if (playbackStarted && length > 0L && elapsed >= length - 2500L &&
                                elapsed >= 3000L) {
                                onCompleted()
                            } else {
                                playing = false
                                buffering = false
                                failWithRecovery("premature_end")
                            }
                        }
                        MediaPlayer.Event.EncounteredError -> {
                            buffering = false
                            playing = false
                            failWithRecovery("decoder_or_stream_error")
                        }
                    }
                }
            }
            val media = Media(vlc, Uri.parse(stream.url))
            val software = decoderMode == DecoderMode.SOFTWARE ||
                (decoderMode == DecoderMode.AUTO && softwareFallback)
            media.setHWDecoderEnabled(!software, false)
            if (software) media.addOption(":avcodec-hw=none")
            diagnose(if (software) "software_decoder" else "hardware_decoder")
            media.addOption(":network-caching=$cacheMs")
            media.addOption(":http-reconnect=true")
            video.setMedia(media)
            media.release()
            pendingStart = true
            surface?.let { attach(it) }
            handler.removeCallbacks(ticker)
            handler.post(ticker)
        } catch (e: Exception) {
            problem = e.localizedMessage ?: "Unable to start native playback"
            onError(problem)
            stop()
        }
    }

    /** Called by the persistent Compose AndroidView; mode changes never recreate this view. */
    fun attach(view: VLCVideoLayout) {
        if (surface === view && attached) return
        if (attached) {
            runCatching { engine?.detachViews() }
            attached = false
        }
        surface = view
        val video = engine ?: return
        try {
            // TextureView avoids SurfaceView compositor issues that can leave a
            // grey/green video plane over otherwise working playback controls.
            // Important for the shared Compose player during mode changes.
            video.attachViews(view, null, false, true)
            attached = true
            if (pendingStart) {
                pendingStart = false
                video.play()
            }
        } catch (e: Exception) {
            problem = "Video surface failed: ${e.localizedMessage ?: "unknown"}"
            onError(problem)
        }
    }
    fun detach(view: VLCVideoLayout) {
        if (surface !== view) return
        if (attached) runCatching { engine?.detachViews() }
        attached = false
        surface = null
    }
    fun transitionTo(value: PlayerMode) {
        if (mode == PlayerMode.CLOSED || value == PlayerMode.CLOSED) return
        if (value == PlayerMode.FULLSCREEN && mode != PlayerMode.FULLSCREEN) previousMode = mode
        mode = value
        controlsVisible = true
    }
    fun leaveFullscreen() {
        if (mode == PlayerMode.FULLSCREEN) transitionTo(previousMode)
    }
    fun toggle() {
        val video = engine ?: return
        try { if (video.isPlaying) video.pause() else video.play() }
        catch (_: Exception) { }
        controlsVisible = true
    }
    fun jump(milliseconds: Long) {
        val video = engine ?: return
        try {
            if (video.isSeekable) {
                video.setTime((video.time + milliseconds).coerceIn(0L, video.length.coerceAtLeast(0L)))
            }
        } catch (_: Exception) { }
        controlsVisible = true
    }
    fun seekTo(milliseconds: Long) {
        try { engine?.let { if (it.isSeekable) it.setTime(milliseconds.coerceIn(0L, it.length.coerceAtLeast(0L))) } }
        catch (_: Exception) { }
        controlsVisible = true
    }
    fun audioChoices(): List<AudioChoice> =
        runCatching { engine?.audioTracks?.filter { it.id >= 0 }?.map { AudioChoice(it.id, it.name ?: "Audio ${it.id}") } ?: emptyList() }
            .getOrDefault(emptyList())
    fun subtitleChoices(): List<AudioChoice> =
        listOf(AudioChoice(-1, "Off")) +
            runCatching { engine?.spuTracks?.filter { it.id >= 0 }?.map { AudioChoice(it.id, it.name ?: "Subtitle ${it.id}") } ?: emptyList() }
                .getOrDefault(emptyList())
    fun selectedAudio(): Int = runCatching { engine?.audioTrack ?: -1 }.getOrDefault(-1)
    fun selectedSubtitle(): Int = runCatching { engine?.spuTrack ?: -1 }.getOrDefault(-1)
    fun chooseAudio(id: Int) { runCatching { engine?.setAudioTrack(id) }; controlsVisible = true }
    fun chooseSubtitle(id: Int) { runCatching { engine?.setSpuTrack(id) }; controlsVisible = true }
    fun changeAspect() {
        aspect = (aspect + 1) % 4
        runCatching {
            engine?.setAspectRatio(when (aspect) { 1 -> "16:9"; 2 -> "4:3"; 3 -> "21:9"; else -> null })
            engine?.setScale(0f)
        }
    }
    fun stop(notifyProgress: Boolean = true) {
        closing = true
        if (notifyProgress && position > 0) onProgress(position, duration)
        handler.removeCallbacks(ticker)
        retryTask?.let { handler.removeCallbacks(it) }
        retryTask = null
        pendingStart = false
        playbackStarted = false
        runCatching { engine?.setEventListener(null) }
        runCatching { engine?.stop() }
        if (attached) runCatching { engine?.detachViews() }
        attached = false
        runCatching { engine?.release() }
        engine = null
        // Keep LibVLC alive until controller release; only release the media player here.
        mode = PlayerMode.CLOSED
        position = 0L
        duration = 0L
        playing = false
        buffering = false
        bufferPercent = 0
    }
    fun release() {
        stop(notifyProgress = false)
        surface = null
        runCatching { libVlc?.release() }
        libVlc = null
    }
}
