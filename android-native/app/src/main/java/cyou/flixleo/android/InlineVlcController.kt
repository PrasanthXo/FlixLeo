package cyou.flixleo.android

import android.content.Context
import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.util.Log
import java.util.concurrent.Executors
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
    private val vlcTeardown = Executors.newSingleThreadExecutor { job ->
        Thread(job, "FlixLeo-VLC-teardown").apply { isDaemon = true }
    }
    private val media3 = Media3PlaybackEngine(appContext)
    var usingMedia3 by mutableStateOf(false)
        private set
    private var media3Failed = false
    private var media3ErrorCode: Int? = null
    private var media3FailureDetail: String? = null
    private fun classifyMedia3Failure(error: androidx.media3.common.PlaybackException): String {
        val causes = generateSequence(error.cause) { it.cause }.take(8).toList()
        val response = causes.filterIsInstance<
            androidx.media3.datasource.HttpDataSource.InvalidResponseCodeException
        >().firstOrNull()
        if (response != null) return "HTTP ${response.responseCode}"
        if (causes.any { it is java.net.UnknownHostException }) return "DNS lookup failed"
        if (causes.any { it is java.net.SocketTimeoutException }) return "Connection timed out"
        if (causes.any { it is javax.net.ssl.SSLException }) return "TLS connection failed"
        if (causes.any { it is java.net.ConnectException }) return "Connection refused"
        return when (error.errorCode) {
            androidx.media3.common.PlaybackException.ERROR_CODE_IO_BAD_HTTP_STATUS ->
                "Streaming server rejected the HTTP request (status unavailable)"
            androidx.media3.common.PlaybackException.ERROR_CODE_IO_NETWORK_CONNECTION_FAILED ->
                "Network connection failed"
            androidx.media3.common.PlaybackException.ERROR_CODE_IO_NETWORK_CONNECTION_TIMEOUT ->
                "Network connection timed out"
            androidx.media3.common.PlaybackException.ERROR_CODE_DECODING_FAILED ->
                "Video decoder failed"
            else -> "Media3 error ${error.errorCode}"
        }
    }

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
            // A failed network request at 0:00 is not evidence of a decoder failure.
            // Preserve hardware 4K decoding for startup retries; switch only after
            // playback has actually started and the decoder subsequently fails.
            if (decoderMode == DecoderMode.AUTO && (playbackStarted || position > 0L)) {
                softwareFallback = true
            }
            problem = "Recovering video playback…"
            val saved = if (position > 0) position / 1000.0 else activeResume
            val task = Runnable { if (!closing) start(stream, title, saved, true) }
            retryTask = task
            handler.postDelayed(task, 700)
        } else {
            // Keep detailed diagnostics in Logcat, not on the customer-facing player.
            diagnose("final_failure_${media3ErrorCode ?: "vlc"}_${reason}")
            problem = "Stream unavailable. Select another server."
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

    private fun startMedia3(stream: FlixStream, resumeSeconds: Double) {
        usingMedia3 = true
        media3.onBuffering = { isBuffering, percent ->
            buffering = isBuffering
            bufferPercent = percent
        }
        media3.onPlaying = {
            playing = true
            playbackStarted = true
            buffering = false
            problem = ""
            trackRevision++
        }
        media3.onPaused = { playing = false }
        media3.onTrackChanged = { trackRevision++ }
        media3.onEnded = { if (!closing) onCompleted() }
        media3.onFailed = { error ->
            if (!closing && usingMedia3) {
                media3ErrorCode = error.errorCode
                media3FailureDetail = classifyMedia3Failure(error)
                diagnose("media3_error_${error.errorCode}")
                val lastPosition = media3.positionMs.takeIf { it > 0L } ?: position
                val previous = if (lastPosition > 0L) lastPosition / 1000.0 else resumeSeconds
                // Do not release the ExoPlayer instance or rebuild the Compose surface
                // from inside its own listener callback. Defer the switch one UI loop.
                media3Failed = true
                problem = "Trying VLC compatibility playback…"
                handler.post {
                    if (!closing && usingMedia3 && activeStream == stream) {
                        start(stream, title, previous, recovering = true)
                    }
                }
            }
        }
        media3.play(stream.url, (resumeSeconds * 1000).toLong())
    }

    fun attachMedia3(view: androidx.media3.ui.PlayerView) = media3.attach(view)
    fun detachMedia3(view: androidx.media3.ui.PlayerView) = media3.detach(view)

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
                if (usingMedia3) {
                    val length = media3.durationMs
                    val time = media3.positionMs
                    if (length > 0) duration = length
                    position = time
                    playing = media3.isPlaying
                    canSeek = media3.canSeek
                    if (buffering) bufferPercent = media3.bufferedPercent
                    if (time > 0 && System.currentTimeMillis() - lastSavedAt >= 15000) {
                        lastSavedAt = System.currentTimeMillis()
                        onProgress(time, length)
                    }
                }
            } catch (_: Exception) { /* a transient player state */ }
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
        // Keep the Compose video host mounted while changing server or decoder.
        // A transient CLOSED state can dispose VLCVideoLayout before reattachment.
        stop(notifyProgress = !recovering, keepSurfaceHost = true,
            preserveMedia3 = !recovering && usingMedia3 && decoderMode != DecoderMode.SOFTWARE)
        closing = false
        if (!recovering) { media3Failed = false; media3ErrorCode = null; media3FailureDetail = null }
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
            // Explicit Software mode retains VLC's CPU decoder; Auto and Hardware use Media3.
            if (!recovering && !media3Failed && decoderMode != DecoderMode.SOFTWARE) {
                startMedia3(stream, resumeSeconds)
                handler.removeCallbacks(ticker)
                handler.post(ticker)
                return
            }
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
            diagnose("player_initialization_failed_${e.javaClass.simpleName}")
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
            // Restore SurfaceView output used before the recent 4K regression.
            // TextureView can add GPU composition overhead for high-bitrate HDR frames.
            // Decoder selection remains configurable (Auto / Hardware / Software).
            video.attachViews(view, null, false, false)
            attached = true
            if (pendingStart) {
                pendingStart = false
                video.play()
            }
        } catch (e: Exception) {
            diagnose("surface_attachment_failed_${e.javaClass.simpleName}")
            problem = "Video surface failed: ${e.localizedMessage ?: "unknown"}"
            onError(problem)
        }
    }
    /** Rebind the existing VLC output after Android's document picker/backgrounding.
     * Never recreates the media player or resets the playing stream/position.
     */
    fun restoreVideoSurface() {
        if (usingMedia3 || mode == PlayerMode.CLOSED) return
        val view = surface ?: return
        if (engine == null) return
        if (attached) {
            runCatching { engine?.detachViews() }
            attached = false
        }
        attach(view)
        controlsVisible = true
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
        if (usingMedia3) { media3.toggle(); controlsVisible = true; return }
        val video = engine ?: return
        try { if (video.isPlaying) video.pause() else video.play() }
        catch (_: Exception) { }
        controlsVisible = true
    }
    fun jump(milliseconds: Long) {
        if (usingMedia3) { media3.seekTo((media3.positionMs + milliseconds).coerceAtLeast(0)); return }
        val video = engine ?: return
        try {
            if (video.isSeekable) {
                video.setTime((video.time + milliseconds).coerceIn(0L, video.length.coerceAtLeast(0L)))
            }
        } catch (_: Exception) { }
        controlsVisible = true
    }
    fun seekTo(milliseconds: Long) {
        if (usingMedia3) { media3.seekTo(milliseconds); controlsVisible = true; return }
        try { engine?.let { if (it.isSeekable) it.setTime(milliseconds.coerceIn(0L, it.length.coerceAtLeast(0L))) } }
        catch (_: Exception) { }
        controlsVisible = true
    }
    fun audioChoices(): List<AudioChoice> =
        if (usingMedia3) media3.audioTracks() else runCatching { engine?.audioTracks?.filter { it.id >= 0 }?.map { AudioChoice(it.id, it.name ?: "Audio ${it.id}") } ?: emptyList() }
            .getOrDefault(emptyList())
    fun subtitleChoices(): List<AudioChoice> =
        if (usingMedia3) media3.subtitleTracks() else listOf(AudioChoice(-1, "Off")) +
            runCatching { engine?.spuTracks?.filter { it.id >= 0 }?.map { AudioChoice(it.id, it.name ?: "Subtitle ${it.id}") } ?: emptyList() }
                .getOrDefault(emptyList())
    fun selectedAudio(): Int = if (usingMedia3) media3.selectedAudio() else runCatching { engine?.audioTrack ?: -1 }.getOrDefault(-1)
    fun selectedSubtitle(): Int = if (usingMedia3) media3.selectedSubtitle() else runCatching { engine?.spuTrack ?: -1 }.getOrDefault(-1)
    fun chooseAudio(id: Int) { if (usingMedia3) { media3.chooseAudio(id); return }; runCatching { engine?.setAudioTrack(id) }; controlsVisible = true }
    fun chooseSubtitle(id: Int) { if (usingMedia3) { media3.chooseSubtitle(id); return }; runCatching { engine?.setSpuTrack(id) }; controlsVisible = true }
    fun importSubtitle(uri: Uri): Boolean {
        if (mode == PlayerMode.CLOSED) return false
        val format = if (uri.path.orEmpty().endsWith(".vtt", true))
            androidx.media3.common.MimeTypes.TEXT_VTT else
            androidx.media3.common.MimeTypes.APPLICATION_SUBRIP
        return runCatching {
            if (usingMedia3) {
                media3.importSubtitle(uri, format).also { if (it) subtitleDelayMs = 0L }
            } else {
                val path = uri.path ?: return@runCatching false
                engine?.addSlave(org.videolan.libvlc.interfaces.IMedia.Slave.Type.Subtitle, path, true) == true
            }
        }.getOrDefault(false).also { if (it) trackRevision++ }
    }
    var subtitleDelayMs by mutableLongStateOf(0L)
        private set
    fun adjustSubtitleDelay(deltaMs: Long): Boolean {
        if (mode == PlayerMode.CLOSED) return false
        val next = (subtitleDelayMs + deltaMs).coerceIn(-10_000L, 10_000L)
        return runCatching {
            val success = if (usingMedia3) media3.shiftUploadedSubtitle(next)
                else {
                    val vlc = engine ?: return@runCatching false
                    vlc.setSpuDelay(next * 1000L)
                    true
                }
            if (success) {
                subtitleDelayMs = next
                controlsVisible = true
                trackRevision++
            }
            success
        }.getOrDefault(false)
    }
    fun resetSubtitleDelay(): Boolean = adjustSubtitleDelay(-subtitleDelayMs)
    fun changeAspect() {
        aspect = (aspect + 1) % 4
        if (usingMedia3) { media3.setAspect(aspect); return }
        runCatching {
            engine?.setAspectRatio(when (aspect) { 1 -> "16:9"; 2 -> "4:3"; 3 -> "21:9"; else -> null })
            engine?.setScale(0f)
        }
    }
    fun stop(notifyProgress: Boolean = true, keepSurfaceHost: Boolean = false,
             preserveMedia3: Boolean = false) {
        closing = true
        if (notifyProgress && position > 0) onProgress(position, duration)
        handler.removeCallbacks(ticker)
        if (!preserveMedia3) media3.stop()
        usingMedia3 = false
        retryTask?.let { handler.removeCallbacks(it) }
        retryTask = null
        pendingStart = false
        playbackStarted = false
        // Detach the video surface on UI thread, but native stop/release may
        // block for seconds while the remote server/decoder shuts down.
        val oldEngine = engine
        engine = null
        if (oldEngine != null) {
            runCatching { oldEngine.setEventListener(null) }
            if (attached) runCatching { oldEngine.detachViews() }
            vlcTeardown.execute {
                runCatching { oldEngine.stop() }
                runCatching { oldEngine.release() }
            }
        }
        attached = false
        // Keep LibVLC alive until controller release; only release the media player here.
        if (!keepSurfaceHost) mode = PlayerMode.CLOSED
        position = 0L
        duration = 0L
        playing = false
        buffering = false
        bufferPercent = 0
    }
    fun release() {
        stop(notifyProgress = false)
        media3.release()
        surface = null
        val previousLib = libVlc
        libVlc = null
        vlcTeardown.execute { runCatching { previousLib?.release() } }
        vlcTeardown.shutdown()
    }
}
