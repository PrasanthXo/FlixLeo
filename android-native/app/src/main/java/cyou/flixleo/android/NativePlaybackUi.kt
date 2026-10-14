package cyou.flixleo.android

import android.app.Activity
import android.content.pm.ActivityInfo
import android.os.Build
import android.view.View
import androidx.activity.compose.BackHandler
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
    val activity = LocalContext.current as Activity
    var lastNonPiP by remember { mutableStateOf(PlayerMode.BIG) }

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
        val cutoffPx = with(LocalDensity.current) { (bigVideoHeight - 32.dp).roundToPx() }
        LaunchedEffect(bigScroll.value, currentMode) {
            if (currentMode == PlayerMode.BIG && bigScroll.value >= cutoffPx) {
                // The expanded movie video has left the scroll viewport.
                // Keep its existing native VLC engine alive in the mini player.
                player.transitionTo(PlayerMode.MINI)
            }
        }

        if (currentMode == PlayerMode.BIG) {
            Column(Modifier.fillMaxSize().background(BackgroundPlayer)
                .verticalScroll(bigScroll)) {
                Spacer(Modifier.height(bigVideoHeight))
                Column(Modifier.padding(start = 16.dp, end = 16.dp, bottom = 26.dp)) {
                    Spacer(Modifier.height(18.dp))
                    Text("NOW PLAYING", color = GoldPlayer, fontSize = 10.sp, fontWeight = FontWeight.Bold)
                    Text(player.title, fontSize = 24.sp, fontWeight = FontWeight.Black,
                        color = Color.White, maxLines = 3)
                    Spacer(Modifier.height(7.dp))
                    Text(player.quality + " · FlixLeo native VLC", color = Color.LightGray, fontSize = 13.sp)
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
                    HorizontalDivider(Modifier.padding(vertical = 17.dp), color = Color.DarkGray)
                    Text("Select quality & server", fontWeight = FontWeight.Bold, color = Color.White)
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
                                    Text(stream.name, color = Color.LightGray, fontSize = 11.sp,
                                        maxLines = 1, overflow = TextOverflow.Ellipsis)
                                }
                            }
                        }
                    }
                    Text("Scroll down to keep watching in the mini player.",
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
        NativeVideoSurface(player, state, currentMode,
            modifier = geometry.clip(RoundedCornerShape(if (currentMode == PlayerMode.MINI) 14.dp else 0.dp))
                .background(Color.Black))
    }
}

@Composable
private fun NativeVideoSurface(
    player: InlineVlcController, state: FlixState, mode: PlayerMode,
    modifier: Modifier = Modifier
) {
    val context = LocalContext.current
    val view = remember(context) { VLCVideoLayout(context) }
    DisposableEffect(view, player) {
        onDispose { player.detach(view) }
    }
    var trackMenu by remember { mutableStateOf("") }
    val showsControls = player.controlsVisible || mode == PlayerMode.MINI
    LaunchedEffect(showsControls, mode, player.playing, player.inPictureInPicture) {
        if (showsControls && mode != PlayerMode.MINI && !player.inPictureInPicture) {
            delay(4500)
            player.controlsVisible = false
        }
    }

    Box(modifier) {
        AndroidView(
            factory = { view.also { player.attach(it) } },
            update = { player.attach(it) },
            modifier = Modifier.fillMaxSize()
        )
        Box(Modifier.matchParentSize().pointerInput(mode) {
            detectTapGestures(
                onTap = { player.controlsVisible = !player.controlsVisible },
                onDoubleTap = {
                    if (mode == PlayerMode.FULLSCREEN) player.leaveFullscreen()
                    else player.transitionTo(PlayerMode.FULLSCREEN)
                }
            )
        })
        if (player.buffering && !player.playing && !player.inPictureInPicture) {
            CircularProgressIndicator(
                modifier = Modifier.align(Alignment.Center).size(if (mode == PlayerMode.MINI) 22.dp else 40.dp),
                color = GoldPlayer, strokeWidth = 3.dp
            )
        }
        if (player.problem.isNotBlank() && mode != PlayerMode.MINI) {
            Text(player.problem, color = Color(0xFFFF7777), fontSize = 12.sp,
                modifier = Modifier.align(Alignment.Center).background(Color.Black.copy(alpha = .85f))
                    .padding(15.dp))
        }
        if (!player.inPictureInPicture && showsControls) {
            if (mode == PlayerMode.MINI) {
                Row(Modifier.fillMaxWidth().align(Alignment.BottomCenter).background(Glass)
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
                Row(Modifier.fillMaxWidth().align(Alignment.TopCenter)
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
                Column(Modifier.align(Alignment.BottomCenter).fillMaxWidth()
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
                        Text(stamp(player.duration), color = Color.LightGray, fontSize = 10.sp)
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
    if (trackMenu.isNotBlank()) {
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
