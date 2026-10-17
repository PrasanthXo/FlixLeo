package cyou.flixleo.android

import android.app.Activity
import android.content.pm.ActivityInfo
import android.os.Build
import android.net.Uri
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.content.Context
import java.io.File
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import android.view.View
import android.view.WindowManager
import androidx.activity.compose.BackHandler
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.compose.ui.platform.LocalLifecycleOwner
import androidx.compose.foundation.*
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.*
import androidx.compose.ui.draw.clip
import androidx.compose.ui.zIndex
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.*
import androidx.compose.ui.viewinterop.AndroidView
import kotlinx.coroutines.delay
import org.videolan.libvlc.util.VLCVideoLayout

private val GoldPlayer = Color(0xFFFBBF24)
private val BackgroundPlayer = Color(0xFF080A11)
private val Glass = Color(0xDE111827)

/** Link estimate only: not a speed test or a guarantee that a stream will play. */
private data class NetworkAdvice(val label: String, val resolution: String)

@Composable
private fun rememberNetworkAdvice(): NetworkAdvice {
    val context = LocalContext.current
    var advice by remember { mutableStateOf(NetworkAdvice("Unknown", "Auto")) }
    LaunchedEffect(context) {
        val manager = context.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
        while (true) {
            advice = runCatching {
                val caps = manager.activeNetwork?.let(manager::getNetworkCapabilities)
                when {
                    caps == null || !caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET) ->
                        NetworkAdvice("Offline", "—")
                    !caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED) ->
                        NetworkAdvice("Poor", "480p")
                    else -> {
                        val kbps = caps.linkDownstreamBandwidthKbps
                        val label = when {
                            kbps >= 15_000 -> "Excellent"
                            kbps >= 3_000 -> "Good"
                            else -> "Poor"
                        }
                        val resolution = when {
                            kbps >= 25_000 -> "4K"
                            kbps >= 8_000 -> "1080p"
                            kbps >= 4_000 -> "720p"
                            else -> "480p"
                        }
                        NetworkAdvice(label, resolution)
                    }
                }
            }.getOrDefault(NetworkAdvice("Unknown", "Auto"))
            delay(1000)
        }
    }
    return advice
}

private fun stamp(ms: Long): String {
    val t = ms.coerceAtLeast(0) / 1000
    return if (t >= 3600) "%d:%02d:%02d".format(t / 3600, (t % 3600) / 60, t % 60)
    else "%d:%02d".format(t / 60, t % 60)
}

/** One Compose playback host, always at the same call site, across ALL player modes. */
@Composable
fun NativePlaybackOverlay(
    player: InlineVlcController,
    state: FlixState,
    modifier: Modifier = Modifier
) {
    val currentMode = player.mode
    if (currentMode == PlayerMode.CLOSED) return
    val context = LocalContext.current
    var importedSubtitleNotice by remember { mutableStateOf("") }
    var subtitleReturnControls by remember(player) { mutableStateOf(false) }
    var fullscreenTrackMenu by remember(player) { mutableStateOf("") }
    val subtitlePicker = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { selected ->
        if (selected != null) {
            importedSubtitleNotice = runCatching {
                val mime = context.contentResolver.getType(selected).orEmpty()
                val displayName = runCatching {
                    context.contentResolver.query(selected, arrayOf(android.provider.OpenableColumns.DISPLAY_NAME), null, null, null)?.use { cursor ->
                        if (cursor.moveToFirst()) cursor.getString(0).orEmpty() else ""
                    }.orEmpty()
                }.getOrDefault("")
                val extension = if (displayName.endsWith(".vtt", true) || mime.contains("vtt")) "vtt" else "srt"
                val bytes = context.contentResolver.openInputStream(selected)?.use { it.readBytes() }
                    ?: throw IllegalArgumentException("Unable to read subtitle")
                if (bytes.size > 3_000_000) throw IllegalArgumentException("Subtitle must be under 3 MB")
                val subtitle = File(context.cacheDir, "flixleo-uploaded-subtitle." + extension)
                subtitle.writeBytes(bytes)
                if (player.importSubtitle(Uri.fromFile(subtitle))) "Subtitle installed"
                else "Could not import subtitle; try another .srt or .vtt file"
            }.getOrElse { "Could not import subtitle file" }
        }
        // Return to expanded playback after the Android file picker closes.
        // Keep decoder and playback position unchanged.
        if (player.mode == PlayerMode.FULLSCREEN) player.leaveFullscreen()
        if (player.mode != PlayerMode.BIG && player.mode != PlayerMode.CLOSED) {
            player.transitionTo(PlayerMode.BIG)
        }
        subtitleReturnControls = true
        player.controlsVisible = true
    }
    val activity = LocalContext.current as Activity
    var lastNonPiP by remember { mutableStateOf(PlayerMode.BIG) }


    // Keep the display awake only during active playback, including mini/fullscreen.
    // Release the flag when paused, stopped, or when the player UI is disposed.
    DisposableEffect(activity, player.playing, currentMode) {
        if (player.playing && currentMode != PlayerMode.CLOSED) {
            activity.window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        } else {
            activity.window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        }
        onDispose {
            activity.window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        }
    }

    LaunchedEffect(currentMode, player.inPictureInPicture) {
        if (currentMode == PlayerMode.FULLSCREEN && !player.inPictureInPicture) {
            @Suppress("DEPRECATION")
            activity.requestedOrientation = ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE
            @Suppress("DEPRECATION")
            activity.window.decorView.systemUiVisibility = (
                View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY or View.SYSTEM_UI_FLAG_FULLSCREEN or
                View.SYSTEM_UI_FLAG_HIDE_NAVIGATION or View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN or
                View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION or View.SYSTEM_UI_FLAG_LAYOUT_STABLE
            )
        } else if (!player.inPictureInPicture) {
            activity.requestedOrientation = ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED
            @Suppress("DEPRECATION")
            activity.window.decorView.systemUiVisibility = View.SYSTEM_UI_FLAG_VISIBLE
        }
    }
    DisposableEffect(Unit) {
        onDispose {
            activity.requestedOrientation = ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED
            @Suppress("DEPRECATION")
            activity.window.decorView.systemUiVisibility = View.SYSTEM_UI_FLAG_VISIBLE
        }
    }
    BackHandler(enabled = currentMode != PlayerMode.CLOSED && !player.inPictureInPicture) {
        when (currentMode) {
            PlayerMode.FULLSCREEN -> player.leaveFullscreen()
            PlayerMode.BIG -> player.transitionTo(PlayerMode.MINI)
            PlayerMode.MINI -> state.closePlayback()
            PlayerMode.CLOSED -> Unit
        }
    }
    BoxWithConstraints(modifier.fillMaxSize()) {
        val bigVideoHeight = maxWidth * 9 / 16
        // Reset the expanded scroll offset on every transition back from mini/fullscreen.
        // Otherwise reopening Big would instantly minimize again at the previous offset.
        val bigScroll = key(currentMode) { rememberScrollState() }
        // Browsing quality/server options must never force mini mode.
        // Mini is available from the explicit button or when navigating away.

        if (currentMode == PlayerMode.BIG) {
            Column(Modifier.fillMaxSize().background(BackgroundPlayer)
                // Keep scrolling content strictly below the fixed video viewport.
                // This lets users watch each caption while tapping subtitle sync.
                .padding(top = bigVideoHeight)
                .verticalScroll(bigScroll)) {
                Column(Modifier.padding(start = 16.dp, end = 16.dp, bottom = 26.dp)) {
                    Spacer(Modifier.height(18.dp))
                    Text("NOW PLAYING", color = GoldPlayer, fontSize = 10.sp, fontWeight = FontWeight.Bold)
                    Text(player.title, fontSize = 24.sp, fontWeight = FontWeight.Black,
                        color = Color.White, maxLines = 3)
                    Spacer(Modifier.height(7.dp))
                    Text(player.quality, color = Color.LightGray, fontSize = 13.sp)
                    if (player.problem.isNotBlank()) {
                        Spacer(Modifier.height(7.dp))
                        Text(player.problem, color = Color(0xFFF87171), fontWeight = FontWeight.Bold)
                    }
                    Spacer(Modifier.height(13.dp))
                    Row(horizontalArrangement = Arrangement.spacedBy(9.dp)) {
                        OutlinedButton(onClick = { player.transitionTo(PlayerMode.MINI) }) {
                            Icon(Icons.Default.PictureInPictureAlt, null)
                            Spacer(Modifier.width(6.dp))
                            Text("Mini player")
                        }
                        OutlinedButton(onClick = { player.transitionTo(PlayerMode.FULLSCREEN) }) {
                            Icon(Icons.Default.Fullscreen, null)
                            Spacer(Modifier.width(6.dp))
                            Text("Fullscreen")
                        }
                    }
                    // Persistent transport controls are deliberately outside the
                    // AndroidView video surface. They remain clickable even when
                    // LibVLC / Media3 reorders the native video layer.
                    Surface(
                        color = Color(0xFF141D2D),
                        shape = RoundedCornerShape(12.dp),
                        modifier = Modifier.fillMaxWidth().padding(top = 10.dp)
                    ) {
                        Column(Modifier.padding(horizontal = 10.dp, vertical = 6.dp)) {
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                Text(stamp(player.position), color = Color.LightGray, fontSize = 11.sp)
                                var outsideSeek by remember { mutableFloatStateOf(-1f) }
                                val total = (player.duration / 1000L).coerceAtLeast(1).toFloat()
                                Slider(
                                    value = if (outsideSeek >= 0) outsideSeek.coerceIn(0f, total)
                                        else (player.position / 1000f).coerceIn(0f, total),
                                    onValueChange = { outsideSeek = it },
                                    onValueChangeFinished = {
                                        if (outsideSeek >= 0) player.seekTo((outsideSeek * 1000).toLong())
                                        outsideSeek = -1f
                                    },
                                    enabled = player.canSeek && player.duration > 0,
                                    valueRange = 0f..total,
                                    colors = SliderDefaults.colors(thumbColor = GoldPlayer, activeTrackColor = GoldPlayer),
                                    modifier = Modifier.weight(1f).height(26.dp)
                                )
                                Text(stamp(player.duration), color = Color.LightGray, fontSize = 11.sp)
                            }
                            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceEvenly,
                                verticalAlignment = Alignment.CenterVertically) {
                                IconButton(onClick = { player.jump(-10_000L) }) {
                                    Icon(Icons.Default.Replay10, contentDescription = "Back 10 seconds", tint = Color.White)
                                }
                                IconButton(onClick = { player.toggle() }) {
                                    Icon(if (player.playing) Icons.Default.PauseCircle else Icons.Default.PlayCircle,
                                        contentDescription = if (player.playing) "Pause" else "Play",
                                        tint = GoldPlayer, modifier = Modifier.size(34.dp))
                                }
                                IconButton(onClick = { player.jump(10_000L) }) {
                                    Icon(Icons.Default.Forward10, contentDescription = "Forward 10 seconds", tint = Color.White)
                                }
                                IconButton(onClick = { player.changeAspect() }) {
                                    Icon(Icons.Default.AspectRatio, contentDescription = "Change video aspect ratio", tint = Color.White)
                                }
                                IconButton(onClick = { player.transitionTo(PlayerMode.FULLSCREEN) }) {
                                    Icon(Icons.Default.Fullscreen, contentDescription = "Enter fullscreen", tint = Color.White)
                                }
                            }
                        }
                    }
                    Surface(
                        color = Color(0xFF172238),
                        shape = RoundedCornerShape(12.dp),
                        modifier = Modifier.fillMaxWidth().padding(top = 8.dp)
                    ) {
                        Column(Modifier.padding(horizontal = 12.dp, vertical = 9.dp)) {
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                Icon(Icons.Default.ClosedCaption, null, tint = GoldPlayer,
                                    modifier = Modifier.size(18.dp))
                                Spacer(Modifier.width(7.dp))
                                Text("Subtitles", color = Color.White, fontWeight = FontWeight.Bold,
                                    fontSize = 14.sp, modifier = Modifier.weight(1f))
                                OutlinedButton(
                                    onClick = { subtitlePicker.launch(arrayOf("text/*", "application/x-subrip", "application/octet-stream")) },
                                    contentPadding = PaddingValues(horizontal = 10.dp, vertical = 0.dp),
                                    modifier = Modifier.height(34.dp)
                                ) {
                                    Icon(Icons.Default.UploadFile, null, modifier = Modifier.size(16.dp))
                                    Spacer(Modifier.width(4.dp))
                                    Text("Upload", fontSize = 12.sp)
                                }
                            }
                            Spacer(Modifier.height(7.dp))
                            val canSync = if (player.usingMedia3) player.selectedSubtitle() == 1000000
                                else player.selectedSubtitle() != -1
                            Row(verticalAlignment = Alignment.CenterVertically,
                                horizontalArrangement = Arrangement.spacedBy(5.dp),
                                modifier = Modifier.fillMaxWidth()) {
                                Text("Sync", color = Color.LightGray, fontSize = 12.sp)
                                Spacer(Modifier.weight(1f))
                                OutlinedButton(onClick = { player.adjustSubtitleDelay(-100L) },
                                    enabled = canSync, contentPadding = PaddingValues(horizontal = 8.dp, vertical = 0.dp),
                                    modifier = Modifier.height(34.dp)) { Text("−0.1s", fontSize = 12.sp) }
                                Text(String.format(java.util.Locale.US, "%+.1f", player.subtitleDelayMs / 1000.0),
                                    color = GoldPlayer, fontWeight = FontWeight.Bold, fontSize = 12.sp)
                                OutlinedButton(onClick = { player.adjustSubtitleDelay(100L) },
                                    enabled = canSync, contentPadding = PaddingValues(horizontal = 8.dp, vertical = 0.dp),
                                    modifier = Modifier.height(34.dp)) { Text("+0.1s", fontSize = 12.sp) }
                                IconButton(onClick = { player.resetSubtitleDelay() }, enabled = canSync,
                                    modifier = Modifier.size(34.dp)) {
                                    Icon(Icons.Default.RestartAlt, contentDescription = "Reset subtitle sync",
                                        modifier = Modifier.size(18.dp))
                                }
                            }
                            if (importedSubtitleNotice.isNotBlank()) {
                                Text(importedSubtitleNotice, color = GoldPlayer, fontSize = 11.sp)
                            }
                        }
                    }
                    HorizontalDivider(Modifier.padding(vertical = 17.dp), color = Color.DarkGray)
                    Text("Video quality", fontWeight = FontWeight.Bold, color = Color.White)
                    Spacer(Modifier.height(8.dp))
                    if (state.playbackStreams.isEmpty()) Text("No streams available", color = Color.LightGray)
                    state.playbackStreams.forEach { stream ->
                        Surface(onClick = { state.play(stream) },
                            color = Color(0xFF202838), shape = RoundedCornerShape(12.dp),
                            modifier = Modifier.fillMaxWidth().padding(vertical = 4.dp)) {
                            Row(Modifier.padding(14.dp), verticalAlignment = Alignment.CenterVertically) {
                                Icon(if (player.quality == stream.quality) Icons.Default.PlayCircle
                                    else Icons.Default.PlayArrow, null, tint = GoldPlayer)
                                Spacer(Modifier.width(11.dp))
                                Column(Modifier.weight(1f)) {
                                    Text(stream.quality + if (stream.size.isNotBlank()) " · " + stream.size else "",
                                        color = Color.White, fontSize = 13.sp, fontWeight = FontWeight.Bold)
                                    // Hide add-on/provider names: only quality and size are shown.
                                }
                            }
                        }
                    }
                    Text("Scroll to browse all available servers. Tap Mini player to minimize.",
                        color = Color.Gray, fontSize = 12.sp, modifier = Modifier.padding(top = 22.dp))
                    Spacer(Modifier.height(160.dp))
                }
            }
        }
        // A SINGLE AndroidView and VLCVideoLayout stays mounted at this stable
        // Compose call-site while geometry changes between BIG/MINI/FULLSCREEN.
        val geometry = when (currentMode) {
            PlayerMode.BIG -> Modifier.align(Alignment.TopCenter)
                .fillMaxWidth().height(bigVideoHeight)
            PlayerMode.MINI -> Modifier.align(Alignment.BottomEnd)
                .padding(end = 9.dp, bottom = 9.dp)
                .width(minOf(maxWidth - 18.dp, 324.dp)).height(176.dp)
            PlayerMode.FULLSCREEN -> Modifier.fillMaxSize()
            PlayerMode.CLOSED -> Modifier.size(0.dp)
        }
        NativeVideoSurface(player, state, currentMode, subtitleReturnControls,
            onControlsRestored = { subtitleReturnControls = false },
            modifier = geometry.clip(RoundedCornerShape(if (currentMode == PlayerMode.MINI) 14.dp else 0.dp))
                .background(Color.Black))
        // Independent fullscreen chrome: a sibling of the native video view,
        // never a descendant of the VLC/Media3 surface.
        if (currentMode == PlayerMode.FULLSCREEN && !player.inPictureInPicture) {
            Row(
                Modifier.align(Alignment.TopCenter).zIndex(50f).fillMaxWidth()
                    .background(Color(0xD9000000)).padding(horizontal = 12.dp, vertical = 5.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                IconButton(onClick = { player.leaveFullscreen(); player.controlsVisible = true }) {
                    Icon(Icons.Default.ArrowBack, contentDescription = "Exit fullscreen", tint = Color.White)
                }
                Text(player.title, color = Color.White, fontSize = 13.sp,
                    maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f))
                IconButton(onClick = { state.closePlayback() }) {
                    Icon(Icons.Default.Close, contentDescription = "Close player", tint = Color.White)
                }
            }
            Column(
                Modifier.align(Alignment.BottomCenter).zIndex(50f).fillMaxWidth()
                    .background(Color(0xE6000000)).padding(horizontal = 12.dp, vertical = 5.dp)
            ) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(stamp(player.position), color = Color.White, fontSize = 11.sp)
                    var fullSeek by remember { mutableFloatStateOf(-1f) }
                    val maxSeek = (player.duration / 1000L).coerceAtLeast(1).toFloat()
                    Slider(
                        value = if (fullSeek >= 0f) fullSeek.coerceIn(0f, maxSeek)
                            else (player.position / 1000f).coerceIn(0f, maxSeek),
                        onValueChange = { fullSeek = it },
                        onValueChangeFinished = {
                            if (fullSeek >= 0f) player.seekTo((fullSeek * 1000).toLong())
                            fullSeek = -1f
                        },
                        enabled = player.canSeek && player.duration > 0,
                        valueRange = 0f..maxSeek,
                        modifier = Modifier.weight(1f),
                        colors = SliderDefaults.colors(thumbColor = GoldPlayer, activeTrackColor = GoldPlayer)
                    )
                    Text(stamp(player.duration), color = Color.White, fontSize = 11.sp)
                }
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceEvenly,
                    verticalAlignment = Alignment.CenterVertically) {
                    IconButton(onClick = { player.jump(-10_000L) }) {
                        Icon(Icons.Default.Replay10, contentDescription = "Back 10 seconds", tint = Color.White)
                    }
                    IconButton(onClick = { player.toggle() }) {
                        Icon(if (player.playing) Icons.Default.PauseCircle else Icons.Default.PlayCircle,
                            contentDescription = "Play or pause", tint = GoldPlayer, modifier = Modifier.size(34.dp))
                    }
                    IconButton(onClick = { player.jump(10_000L) }) {
                        Icon(Icons.Default.Forward10, contentDescription = "Forward 10 seconds", tint = Color.White)
                    }
                    IconButton(onClick = { fullscreenTrackMenu = "audio" }) {
                        Icon(Icons.Default.Audiotrack, contentDescription = "Change audio language", tint = Color.White)
                    }
                    IconButton(onClick = { fullscreenTrackMenu = "subtitle" }) {
                        Icon(Icons.Default.Subtitles, contentDescription = "Change subtitle track", tint = Color.White)
                    }
                    IconButton(onClick = { player.leaveFullscreen(); player.controlsVisible = true }) {
                        Icon(Icons.Default.FullscreenExit, contentDescription = "Exit fullscreen", tint = Color.White)
                    }
                }
            }
        }
    }
    if (fullscreenTrackMenu.isNotBlank()) {
        val audioMenu = fullscreenTrackMenu == "audio"
        val options = if (audioMenu) player.audioChoices() else player.subtitleChoices()
        val currentTrack = if (audioMenu) player.selectedAudio() else player.selectedSubtitle()
        AlertDialog(
            onDismissRequest = { fullscreenTrackMenu = "" },
            title = { Text(if (audioMenu) "Audio language" else "Subtitles") },
            text = {
                Column(Modifier.heightIn(max = 320.dp).verticalScroll(rememberScrollState())) {
                    if (options.isEmpty()) {
                        Text(if (audioMenu) "No other audio tracks available."
                            else "No subtitle tracks available.")
                    }
                    options.forEach { option ->
                        Row(
                            Modifier.fillMaxWidth().clickable {
                                if (audioMenu) player.chooseAudio(option.id)
                                else player.chooseSubtitle(option.id)
                                player.controlsVisible = true
                                fullscreenTrackMenu = ""
                            }.padding(vertical = 8.dp),
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            RadioButton(selected = option.id == currentTrack, onClick = null)
                            Spacer(Modifier.width(8.dp))
                            Text(option.label, color = Color.White)
                        }
                    }
                }
            },
            confirmButton = {
                TextButton(onClick = { fullscreenTrackMenu = "" }) { Text("Close") }
            }
        )
    }
}

@Composable
private fun NativeVideoSurface(
    player: InlineVlcController, state: FlixState, mode: PlayerMode,
    subtitleReturnControls: Boolean,
    onControlsRestored: () -> Unit,
    modifier: Modifier = Modifier
) {
    val context = LocalContext.current
    val view = remember(context) { VLCVideoLayout(context) }
    DisposableEffect(view, player) {
        onDispose { player.detach(view) }
    }
    val lifecycleOwner = LocalLifecycleOwner.current
    var appForeground by remember { mutableStateOf(lifecycleOwner.lifecycle.currentState.isAtLeast(Lifecycle.State.RESUMED)) }
    DisposableEffect(lifecycleOwner, player) {
        val observer = LifecycleEventObserver { _, event ->
            when (event) {
                Lifecycle.Event.ON_RESUME -> { appForeground = true; player.controlsVisible = true }
                Lifecycle.Event.ON_PAUSE, Lifecycle.Event.ON_STOP -> appForeground = false
                else -> Unit
            }
        }
        lifecycleOwner.lifecycle.addObserver(observer)
        onDispose { lifecycleOwner.lifecycle.removeObserver(observer) }
    }
    var trackMenu by remember { mutableStateOf("") }
    var holdControlsAfterSubtitle by remember(player) { mutableStateOf(false) }
    var forceFullscreenControls by remember(player) { mutableStateOf(false) }
    var subtitlePickerReturn by remember { mutableIntStateOf(0) }

    val networkAdvice = rememberNetworkAdvice()
    val showsControls = player.controlsVisible || subtitleReturnControls || holdControlsAfterSubtitle || forceFullscreenControls || mode == PlayerMode.MINI
    LaunchedEffect(showsControls, mode, player.playing, player.inPictureInPicture, appForeground, trackMenu, subtitlePickerReturn) {
        if (showsControls && !subtitleReturnControls && !holdControlsAfterSubtitle && !forceFullscreenControls && appForeground && trackMenu.isEmpty() && player.playing && mode != PlayerMode.MINI && !player.inPictureInPicture) {
            delay(if (subtitlePickerReturn > 0) 8000 else 4500)
            if (appForeground && trackMenu.isEmpty()) player.controlsVisible = false
        }
    }

    Box(modifier) {
        if (player.usingMedia3) {
            val media3View = remember(context) {
                (android.view.LayoutInflater.from(context)
                    .inflate(R.layout.flixleo_media3_player, null) as androidx.media3.ui.PlayerView).apply {
                    useController = false
                    setBackgroundColor(android.graphics.Color.BLACK)
                }
            }
            DisposableEffect(media3View, player) {
                onDispose { player.detachMedia3(media3View) }
            }
            AndroidView(
                factory = { media3View.also { player.attachMedia3(it) } },
                update = { player.attachMedia3(it) },
                modifier = Modifier.fillMaxSize().zIndex(-1f)
            )
        } else {
            AndroidView(
                factory = { view.also { player.attach(it) } },
                update = { player.attach(it) },
                modifier = Modifier.fillMaxSize().zIndex(-1f)
            )
        }
        Box(Modifier.matchParentSize().zIndex(0f).pointerInput(mode, holdControlsAfterSubtitle, forceFullscreenControls) {
            detectTapGestures(
                onTap = { 
                    if (holdControlsAfterSubtitle || forceFullscreenControls || subtitleReturnControls) { holdControlsAfterSubtitle = false; forceFullscreenControls = false; onControlsRestored(); player.controlsVisible = true }
                    else player.controlsVisible = !player.controlsVisible
                },
                onDoubleTap = {
                    forceFullscreenControls = true
                    player.controlsVisible = true
                    if (mode == PlayerMode.FULLSCREEN) player.leaveFullscreen()
                    else player.transitionTo(PlayerMode.FULLSCREEN)
                }
            )
        })
        // Independent Compose caption layer: never restart the video decoder.
        val caption = player.uploadedCaptionText()
        if (caption.isNotBlank() && !player.inPictureInPicture) {
            Text(caption, color = Color.White, fontSize = if (mode == PlayerMode.MINI) 12.sp else 18.sp,
                fontWeight = FontWeight.SemiBold,
                textAlign = androidx.compose.ui.text.style.TextAlign.Center,
                modifier = Modifier.align(Alignment.BottomCenter)
                    .padding(start = 20.dp, end = 20.dp, bottom = if (showsControls) 125.dp else 28.dp)
                    .background(Color.Black.copy(alpha = 0.65f), RoundedCornerShape(6.dp))
                    .padding(horizontal = 8.dp, vertical = 3.dp))
        }
        // Dedicated recovery control: a SurfaceView or the Android document picker
        // can consume the first tap, but this Compose button remains clickable.
        if (!player.inPictureInPicture && !showsControls && mode != PlayerMode.MINI) {
            IconButton(
                onClick = { player.controlsVisible = true },
                modifier = Modifier.align(Alignment.BottomEnd).zIndex(5f)
                    .padding(12.dp)
                    .background(Glass, RoundedCornerShape(14.dp))
                    .size(44.dp)
            ) {
                Icon(Icons.Default.Tune, contentDescription = "Show player controls",
                    tint = Color.White, modifier = Modifier.size(23.dp))
            }
        }
        if (!player.inPictureInPicture && showsControls) {
            Row(
                Modifier.align(Alignment.BottomStart)
                    .padding(start = 8.dp, bottom = if (mode == PlayerMode.MINI) 58.dp else if (showsControls) 115.dp else 8.dp)
                    .background(Glass, RoundedCornerShape(12.dp))
                    .padding(horizontal = 7.dp, vertical = 4.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                Icon(Icons.Default.NetworkCheck, contentDescription = "Network quality",
                    tint = when (networkAdvice.label) {
                        "Excellent" -> Color(0xFF4ADE80)
                        "Good" -> GoldPlayer
                        else -> Color(0xFFFF7777)
                    }, modifier = Modifier.size(15.dp))
                Spacer(Modifier.width(4.dp))
                Text(networkAdvice.label, color = Color.White, fontSize = 10.sp, maxLines = 1)
            }
        }
        if (player.buffering && !player.inPictureInPicture) {
            val compact = mode == PlayerMode.MINI
            Box(Modifier.align(Alignment.Center)
                .size(if (compact) 36.dp else 60.dp)
                .background(Color(0xDD0C1320), RoundedCornerShape(15.dp)),
                contentAlignment = Alignment.Center) {
                // Buffered percentage is not a reliable startup progress metric.
                // Use an animated spinner during startup and stalls instead.
                CircularProgressIndicator(
                    modifier = Modifier.size(if (compact) 28.dp else 48.dp),
                    color = GoldPlayer,
                    trackColor = Color.DarkGray,
                    strokeWidth = if (compact) 2.dp else 3.dp
                )
            }
        }
        if (player.problem.isNotBlank() && mode != PlayerMode.MINI) {
            Text(player.problem, color = Color(0xFFFF7777), fontSize = 12.sp,
                modifier = Modifier.align(Alignment.Center).background(Color.Black.copy(alpha = .85f))
                    .padding(15.dp))
        }
        if (!player.inPictureInPicture && showsControls) {
            if (mode == PlayerMode.MINI) {
                Row(Modifier.fillMaxWidth().align(Alignment.BottomCenter).zIndex(4f).background(Glass)
                    .height(55.dp).padding(horizontal = 5.dp),
                    verticalAlignment = Alignment.CenterVertically) {
                    IconButton(onClick = { player.toggle() }, modifier = Modifier.size(36.dp)) {
                        Icon(if (player.playing) Icons.Default.Pause else Icons.Default.PlayArrow,
                            contentDescription = if (player.playing) "Pause" else "Play", tint = GoldPlayer)
                    }
                    Column(Modifier.weight(1f).padding(start = 3.dp)) {
                        Text(player.title, maxLines = 1, overflow = TextOverflow.Ellipsis,
                            color = Color.White, fontSize = 12.sp, fontWeight = FontWeight.Bold)
                        Text(stamp(player.position) + " / " + stamp(player.duration),
                            color = Color.LightGray, fontSize = 10.sp)
                    }
                    MiniIcon(Icons.Default.OpenInFull, "Expand big player") {
                        player.transitionTo(PlayerMode.BIG)
                    }
                    MiniIcon(Icons.Default.Fullscreen, "Fullscreen") {
                        player.transitionTo(PlayerMode.FULLSCREEN)
                    }
                    MiniIcon(Icons.Default.Close, "Close and stop playback") {
                        state.closePlayback()
                    }
                }
            } else {
                Row(Modifier.fillMaxWidth().align(Alignment.TopCenter).zIndex(4f)
                    .background(Brush.verticalGradient(listOf(Color.Black.copy(alpha = .8f), Color.Transparent)))
                    .padding(horizontal = 5.dp, vertical = 2.dp),
                    verticalAlignment = Alignment.CenterVertically) {
                    IconButton(onClick = {
                        if (mode == PlayerMode.FULLSCREEN) player.leaveFullscreen()
                        else player.transitionTo(PlayerMode.MINI)
                    }) {
                        Icon(Icons.Default.ArrowBack,
                            contentDescription = if (mode == PlayerMode.FULLSCREEN) "Exit fullscreen" else "Minimize player",
                            tint = Color.White)
                    }
                    Text(player.title, maxLines = 1, overflow = TextOverflow.Ellipsis,
                        fontSize = 13.sp, color = Color.White, fontWeight = FontWeight.Bold,
                        modifier = Modifier.weight(1f))
                    IconButton(onClick = {
                        if (mode == PlayerMode.FULLSCREEN) player.leaveFullscreen()
                        else player.transitionTo(PlayerMode.MINI)
                    }) {
                        Icon(Icons.Default.PictureInPictureAlt, contentDescription = "Mini player",
                            tint = Color.White)
                    }
                    IconButton(onClick = {
                        if (mode == PlayerMode.FULLSCREEN) player.leaveFullscreen()
                        else player.transitionTo(PlayerMode.FULLSCREEN)
                    }) {
                        Icon(if (mode == PlayerMode.FULLSCREEN) Icons.Default.FullscreenExit else Icons.Default.Fullscreen,
                            contentDescription = "Toggle fullscreen", tint = Color.White)
                    }
                    IconButton(onClick = { state.closePlayback() }) {
                        Icon(Icons.Default.Close, contentDescription = "Close player", tint = Color.White)
                    }
                }
                Column(Modifier.align(Alignment.BottomCenter).fillMaxWidth().zIndex(4f)
                    .background(Brush.verticalGradient(listOf(Color.Transparent, Color.Black.copy(alpha = .95f))))
                    .padding(horizontal = 8.dp, vertical = 4.dp)) {
                    Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.fillMaxWidth()) {
                        Text(stamp(player.position), color = Color.LightGray, fontSize = 10.sp)
                        var slider by remember { mutableFloatStateOf(-1f) }
                        val maxValue = (player.duration / 1000L).coerceAtLeast(1).toFloat()
                        Slider(value = if (slider >= 0) slider.coerceIn(0f, maxValue)
                            else (player.position / 1000f).coerceIn(0f, maxValue),
                            onValueChange = { slider = it },
                            onValueChangeFinished = {
                                if (slider >= 0) player.seekTo((slider * 1000).toLong())
                                slider = -1f
                            },
                            enabled = player.canSeek && player.duration > 0,
                            valueRange = 0f..maxValue,
                            colors = SliderDefaults.colors(thumbColor = GoldPlayer, activeTrackColor = GoldPlayer),
                            modifier = Modifier.weight(1f).height(24.dp))
                        Text("-" + stamp((player.duration - player.position).coerceAtLeast(0L)),
                            color = Color.LightGray, fontSize = 10.sp)
                    }
                    Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()),
                        horizontalArrangement = Arrangement.Center,
                        verticalAlignment = Alignment.CenterVertically) {
                        PlayerIcon(Icons.Default.Replay10, "Back 10 seconds") { player.jump(-10_000) }
                        PlayerIcon(if (player.playing) Icons.Default.PauseCircle else Icons.Default.PlayCircle,
                            if (player.playing) "Pause" else "Play") { player.toggle() }
                        PlayerIcon(Icons.Default.Forward10, "Forward 10 seconds") { player.jump(10_000) }
                        PlayerIcon(Icons.Default.Audiotrack, "Choose audio language") { trackMenu = "audio" }
                        PlayerIcon(Icons.Default.Subtitles, "Choose subtitles") { trackMenu = "subtitle" }
                        PlayerIcon(Icons.Default.AspectRatio, "Change aspect ratio") { player.changeAspect() }
                        PlayerIcon(Icons.Default.Settings, "Video decoder") { trackMenu = "decoder" }
                        PlayerIcon(if (mode == PlayerMode.FULLSCREEN) Icons.Default.FullscreenExit
                            else Icons.Default.Fullscreen, "Toggle fullscreen") {
                            if (mode == PlayerMode.FULLSCREEN) player.leaveFullscreen()
                            else player.transitionTo(PlayerMode.FULLSCREEN)
                        }
                    }
                }
            }
        }
    }
    if (trackMenu == "decoder") {
        AlertDialog(
            onDismissRequest = { trackMenu = "" },
            title = { Text("Video decoding") },
            text = {
                Column {
                    DecoderMode.entries.forEach { choice ->
                        Row(Modifier.fillMaxWidth().clickable {
                            player.chooseDecoder(choice)
                            trackMenu = ""
                        }.padding(vertical = 9.dp), verticalAlignment = Alignment.CenterVertically) {
                            RadioButton(selected = player.decoderMode == choice, onClick = null)
                            Spacer(Modifier.width(8.dp))
                            Text(when (choice) {
                                DecoderMode.AUTO -> "Auto (hardware, then software fallback)"
                                DecoderMode.HARDWARE -> "Hardware decoding"
                                DecoderMode.SOFTWARE -> "Software decoding"
                            }, color = Color.White)
                        }
                    }
                }
            },
            confirmButton = { TextButton(onClick = { trackMenu = "" }) { Text("Close") } }
        )
    }
    if (trackMenu.isNotBlank() && trackMenu != "decoder") {
        val tracks = if (trackMenu == "audio") player.audioChoices() else player.subtitleChoices()
        val chosen = if (trackMenu == "audio") player.selectedAudio() else player.selectedSubtitle()
        AlertDialog(
            onDismissRequest = { trackMenu = "" },
            title = { Text(if (trackMenu == "audio") "Audio language" else "Subtitle language") },
            text = {
                Column(Modifier.heightIn(max = 330.dp).verticalScroll(rememberScrollState())) {
                    if (tracks.isEmpty()) Text("No tracks detected in this stream.")
                    tracks.forEach { track ->
                        Row(Modifier.fillMaxWidth().clickable {
                            if (trackMenu == "audio") player.chooseAudio(track.id)
                            else player.chooseSubtitle(track.id)
                            trackMenu = ""
                        }.padding(vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                            RadioButton(selected = track.id == chosen, onClick = null)
                            Spacer(Modifier.width(10.dp))
                            Text(track.label, maxLines = 2, fontSize = 14.sp)
                        }
                    }


                }
            },
            confirmButton = { TextButton(onClick = { trackMenu = "" }) { Text("Close") } }
        )
    }
}

@Composable
private fun MiniIcon(
    icon: androidx.compose.ui.graphics.vector.ImageVector,
    description: String,
    onClick: () -> Unit
) {
    IconButton(onClick = onClick, modifier = Modifier.size(33.dp)) {
        Icon(icon, contentDescription = description, tint = Color.White, modifier = Modifier.size(19.dp))
    }
}
@Composable
private fun PlayerIcon(
    icon: androidx.compose.ui.graphics.vector.ImageVector,
    description: String,
    onClick: () -> Unit
) {
    IconButton(onClick = onClick, modifier = Modifier.size(43.dp)) {
        Icon(icon, contentDescription = description, tint = Color.White, modifier = Modifier.size(22.dp))
    }
}
