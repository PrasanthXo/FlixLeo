package cyou.flixleo.android

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.animateContentSize
import androidx.compose.animation.core.*
import androidx.compose.foundation.*
import androidx.compose.foundation.gestures.*
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.pager.HorizontalPager
import androidx.compose.foundation.pager.rememberPagerState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.*
import androidx.compose.ui.draw.*
import androidx.compose.ui.graphics.*
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.*
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.input.pointer.pointerInput
import kotlinx.coroutines.delay
import coil.compose.AsyncImage
import kotlin.math.absoluteValue
import kotlin.math.abs
import org.json.JSONObject

private val Ink = Color(0xFF090B11)
private val Card = Color(0xFF171C2B)
private val Gold = Color(0xFFFBBF24)
private val Muted = Color(0xFFA7AAB7)
private val Nav = listOf("Home", "Movies", "Series", "Live TV", "Search", "Profile")

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun FlixLeoNativeApp(state: FlixState, player: InlineVlcController) {
    val colors = darkColorScheme(
        primary = Gold, onPrimary = Ink, background = Ink, onBackground = Color.White,
        surface = Color(0xFF111520), onSurface = Color.White,
        secondary = Color(0xFF64748B), error = Color(0xFFFB7185)
    )
    MaterialTheme(colorScheme = colors) {
        if (state.showSplash) {
            FlixLeoStartupSplash()
        } else Scaffold(
            containerColor = Ink,
            topBar = {
                if (player.mode != PlayerMode.FULLSCREEN && !player.inPictureInPicture) {
                    Row(Modifier.fillMaxWidth().background(Ink).statusBarsPadding()
                        .padding(horizontal = 17.dp, vertical = 10.dp),
                        verticalAlignment = Alignment.CenterVertically) {
                        Image(painterResource(R.drawable.flixleo_brand), "FlixLeo brand",
                            modifier = Modifier.size(42.dp).clip(RoundedCornerShape(13.dp)))
                        Spacer(Modifier.width(11.dp))
                        Column(Modifier.weight(1f)) {
                            Text("FlixLeo", color = Color.White, fontSize = 22.sp, fontWeight = FontWeight.Black,
                                letterSpacing = (-.6).sp)
                            Text("YOUR CINEMA, REIMAGINED", color = Muted, fontSize = 9.sp,
                                letterSpacing = 1.3.sp, maxLines = 1)
                        }
                        // Search and Profile have their own bottom tabs; no duplicate top actions.
                    }
                }
            },
            bottomBar = {
                if (player.mode != PlayerMode.FULLSCREEN && !player.inPictureInPicture) {
                    Row(
                        Modifier.fillMaxWidth().background(Color(0xFF10141F))
                            .navigationBarsPadding().padding(horizontal = 3.dp, vertical = 7.dp),
                        horizontalArrangement = Arrangement.spacedBy(0.dp),
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        val icons = listOf(Icons.Default.Home, Icons.Default.Movie, Icons.Default.Tv,
                            Icons.Default.LiveTv, Icons.Default.Search, Icons.Default.Person)
                        Nav.forEachIndexed { index, label ->
                            val active = state.tab == label
                            val tint by animateColorAsState(
                                targetValue = if (active) Gold else Muted, label = "nav-tint"
                            )
                            val activeBg by animateColorAsState(
                                targetValue = if (active) Gold.copy(alpha = .13f) else Color.Transparent,
                                label = "nav-background"
                            )
                            Column(
                                Modifier.weight(1f).heightIn(min = 56.dp)
                                    .clip(RoundedCornerShape(14.dp))
                                    .background(activeBg)
                                    .clickable { state.changeTab(label) }
                                    .padding(horizontal = 1.dp, vertical = 5.dp),
                                horizontalAlignment = Alignment.CenterHorizontally,
                                verticalArrangement = Arrangement.Center
                            ) {
                                Icon(icons[index], contentDescription = label, tint = tint,
                                    modifier = Modifier.size(23.dp))
                                Spacer(Modifier.height(4.dp))
                                Text(label, fontSize = 10.sp,
                                    fontWeight = if (active) FontWeight.Bold else FontWeight.Medium,
                                    color = tint, maxLines = 1,
                                    textAlign = TextAlign.Center,
                                    softWrap = false,
                                    overflow = TextOverflow.Clip)
                            }
                        }
                    }
                }
            }
        ) { padding ->
            Box(Modifier.padding(padding).fillMaxSize()) {
                when (state.tab) {
                    "Home" -> HomeScreen(state)
                    "Movies" -> BrowseScreen(state, false)
                    "Series" -> BrowseScreen(state, true)
                    "Live TV" -> LiveScreen(state)
                    "Search" -> SearchScreen(state)
                    else -> ProfileScreen(state)
                }
                if (player.mode != PlayerMode.CLOSED) {
                    NativePlaybackOverlay(player, state, modifier = Modifier.fillMaxSize())
                }
                if (state.loading && player.mode == PlayerMode.CLOSED) LinearProgressIndicator(
                    Modifier.fillMaxWidth().align(Alignment.TopCenter), color = Gold)
                if (state.message.isNotBlank() && player.mode != PlayerMode.FULLSCREEN) {
                    Surface(
                        color = Color(0xFF3C2F17), shape = RoundedCornerShape(14.dp),
                        modifier = Modifier.align(Alignment.BottomCenter)
                            .padding(horizontal = 16.dp, vertical = 8.dp).clickable { state.clearMessage() }
                    ) {
                        Row(Modifier.padding(14.dp), verticalAlignment = Alignment.CenterVertically) {
                            Text(state.message, color = Color.White, modifier = Modifier.weight(1f), fontSize = 13.sp)
                            Spacer(Modifier.width(10.dp))
                            Icon(Icons.Default.Close, contentDescription = "Dismiss", modifier = Modifier.size(17.dp))
                        }
                    }
                }
            }
        }
        if (player.mode == PlayerMode.CLOSED && (state.selected != null || state.selectedChannel != null)) {
            ModalBottomSheet(onDismissRequest = {
                state.selected = null; state.selectedChannel = null; state.streams = emptyList()
            }, sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true),
                containerColor = Color(0xFF111621), dragHandle = { BottomSheetDefaults.DragHandle(color = Muted) }) {
                DetailSheet(state)
            }
        }
        if (state.showAuth) AccountDialog(state)
        if (state.showOnboarding && state.account != null) PostSignupInterestsDialog(state)
        val update = state.updateNotice
        if (update != null) AlertDialog(
            onDismissRequest = { if (!state.updateForced) state.updateNotice = null },
            title = { Text("FlixLeo update available") },
            text = { Text(update.optString("notes").ifBlank { "An Android update is available." }) },
            confirmButton = {
                TextButton(onClick = { state.onOpenUrl(update.optString("updateUrl")) }) { Text("Update") }
            },
            dismissButton = if (state.updateForced) null else {
                { TextButton(onClick = { state.updateNotice = null }) { Text("Later") } }
            }
        )
    }
}

@Composable
private fun FlixLeoStartupSplash() {
    val infinite = rememberInfiniteTransition(label = "FlixLeo splash")
    val pulse by infinite.animateFloat(
        initialValue = .94f, targetValue = 1.07f,
        animationSpec = infiniteRepeatable(tween(1550, easing = FastOutSlowInEasing),
            RepeatMode.Reverse), label = "Logo breathe"
    )
    val spin by infinite.animateFloat(
        initialValue = 0f, targetValue = 360f,
        animationSpec = infiniteRepeatable(tween(3700, easing = LinearEasing)),
        label = "Cinema orbit"
    )
    Box(Modifier.fillMaxSize()
        .background(Brush.verticalGradient(listOf(
            Color(0xFF0D1020), Color(0xFF0B0C16), Color(0xFF05060D))))
        .statusBarsPadding().navigationBarsPadding()) {
        Box(Modifier.align(Alignment.Center).size(270.dp),
            contentAlignment = Alignment.Center) {
            Box(Modifier.size(238.dp).graphicsLayer { rotationZ = spin }
                .border(2.dp, Color(0xFF9577F6).copy(alpha = .65f), CircleShape))
            Box(Modifier.size(206.dp).graphicsLayer { rotationZ = -spin * .65f }
                .border(1.dp, Color(0xFF60C7FF).copy(alpha = .42f), CircleShape))
            Image(painterResource(R.drawable.flixleo_splash_vector),
                contentDescription = "FlixLeo cinematic logo",
                modifier = Modifier.size(184.dp)
                    .graphicsLayer { scaleX = pulse; scaleY = pulse }
                    .shadow(30.dp, RoundedCornerShape(38.dp)))
        }
        Column(Modifier.align(Alignment.BottomCenter).fillMaxWidth()
            .padding(bottom = 65.dp, start = 25.dp, end = 25.dp),
            horizontalAlignment = Alignment.CenterHorizontally) {
            Text("FLIXLEO", color = Color.White, fontSize = 29.sp,
                fontWeight = FontWeight.Black, letterSpacing = 4.sp)
            Spacer(Modifier.height(7.dp))
            Text("YOUR CINEMA · YOUR WORLD", color = Color(0xFFD3B5FF),
                letterSpacing = 1.5.sp, fontSize = 10.sp, fontWeight = FontWeight.Bold)
            Spacer(Modifier.height(24.dp))
            LinearProgressIndicator(
                modifier = Modifier.fillMaxWidth(.50f).clip(RoundedCornerShape(6.dp)),
                color = Gold, trackColor = Color.White.copy(alpha = .14f))
            Spacer(Modifier.height(13.dp))
            Text("Preparing your catalogue…", fontSize = 12.sp, color = Muted)
        }
    }
}
@Composable
private fun Heading(title: String, subtitle: String? = null, action: (() -> Unit)? = null) {
    Row(Modifier.fillMaxWidth().padding(start = 17.dp, end = 14.dp, top = 19.dp, bottom = 9.dp),
        verticalAlignment = Alignment.CenterVertically) {
        Column(Modifier.weight(1f)) {
            Text(title, fontSize = 18.sp, color = Color.White, fontWeight = FontWeight.Bold)
            if (subtitle != null) Text(subtitle, color = Muted, fontSize = 11.sp)
        }
        if (action != null) TextButton(onClick = action) { Text("See all", fontSize = 12.sp) }
    }
}
@Composable
private fun Poster(item: FlixTitle, selected: Boolean, compact: Boolean = false,
                   onBookmark: (() -> Unit)? = null, onClick: () -> Unit) {
    val width = if (compact) 112.dp else 139.dp
    var expanded by remember { mutableStateOf(false) }
    Column(Modifier.width(width).clickable(onClick = onClick)) {
        Box(Modifier.fillMaxWidth()
            .height(if (compact) 151.dp else 197.dp)
            .shadow(8.dp, RoundedCornerShape(15.dp))
            .clip(RoundedCornerShape(15.dp))
            .border(1.dp, Color.White.copy(alpha = .12f), RoundedCornerShape(15.dp))
            .background(Card)) {
            AsyncImage(model = item.poster, contentDescription = item.title,
                contentScale = ContentScale.Crop, modifier = Modifier.fillMaxSize())
            Box(Modifier.fillMaxSize().background(Brush.verticalGradient(
                listOf(Color(0x16000000), Color.Transparent, Color(0xD9070A10)),
                startY = 0f)))
            if (item.rating.isNotBlank()) {
                Text("★ ${item.rating}", fontSize = 10.sp,
                    fontWeight = FontWeight.Bold, color = Gold,
                    modifier = Modifier.align(Alignment.TopStart)
                        .padding(7.dp).clip(RoundedCornerShape(7.dp))
                        .background(Color(0xCC111827)).padding(horizontal = 7.dp, vertical = 4.dp))
            }
            if (onBookmark != null) {
                Box(Modifier.align(Alignment.TopEnd)) {
                    IconButton(onClick = { expanded = true },
                        modifier = Modifier.padding(4.dp).size(33.dp)
                            .background(Color(0xB31C2030), CircleShape)) {
                        Icon(Icons.Default.MoreVert, contentDescription = "More options for ${item.title}",
                            tint = Color.White, modifier = Modifier.size(18.dp))
                    }
                    DropdownMenu(expanded = expanded, onDismissRequest = { expanded = false },
                        modifier = Modifier.background(Color(0xFF222638))) {
                        DropdownMenuItem(
                            text = { Text("View details", color = Color.White) },
                            leadingIcon = { Icon(Icons.Default.Info, null, tint = Gold) },
                            onClick = { expanded = false; onClick() })
                        DropdownMenuItem(
                            text = {
                                Text(if (selected) "Remove from Watchlist" else "Add to Watchlist",
                                    color = Color.White)
                            },
                            leadingIcon = {
                                Icon(if (selected) Icons.Default.BookmarkRemove else Icons.Default.BookmarkAdd,
                                    null, tint = Gold)
                            }, onClick = { expanded = false; onBookmark() })
                    }
                }
            } else if (selected) {
                Icon(Icons.Default.Bookmark, "Saved", tint = Gold,
                    modifier = Modifier.align(Alignment.TopEnd).padding(7.dp).size(18.dp))
            }
            Text(if (item.type == "tv") "SERIES" else "MOVIE",
                color = Gold, fontSize = 9.sp, fontWeight = FontWeight.Black,
                letterSpacing = 1.sp,
                modifier = Modifier.align(Alignment.BottomStart)
                    .padding(9.dp).background(Ink.copy(alpha = .75f), RoundedCornerShape(7.dp))
                    .padding(horizontal = 6.dp, vertical = 3.dp))
        }
        Spacer(Modifier.height(9.dp))
        Text(item.title, color = Color.White, fontSize = 13.sp, fontWeight = FontWeight.SemiBold,
            maxLines = 2, minLines = 2, lineHeight = 17.sp, overflow = TextOverflow.Ellipsis)
        Text(listOf(item.year, item.genres.firstOrNull().orEmpty())
            .filter { it.isNotBlank() }.joinToString("  ·  "),
            color = Muted, fontSize = 11.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
    }
}
@Composable
private fun PosterRow(label: String, data: List<FlixTitle>, state: FlixState) {
    if (data.isEmpty()) return
    Heading(label, "${data.size} titles available")
    LazyRow(horizontalArrangement = Arrangement.spacedBy(13.dp),
        contentPadding = PaddingValues(horizontal = 17.dp)) {
        items(data, key = { label + it.id }) { item ->
            Poster(item, state.watchlist.contains(item.id),
                onBookmark = { state.toggleWatch(item) },
                onClick = { state.open(item) })
        }
    }
}
@Composable
private fun HeroWheel(items: List<FlixTitle>, state: FlixState) {
    if (items.isEmpty()) return
    val slides = remember(items) { items.distinctBy { it.id }.take(15) }
    var currentIndex by remember(slides) { mutableIntStateOf(0) }
    val current = slides[currentIndex.coerceIn(slides.indices)]
    var lastTouched by remember { mutableLongStateOf(0L) }

    // This is a real five-poster 3D wheel, not a one-poster banner/pager.
    LaunchedEffect(slides) {
        while (true) {
            delay(3600L)
            if (slides.size > 1 && System.currentTimeMillis() - lastTouched > 3300L) {
                currentIndex = (currentIndex + 1) % slides.size
            }
        }
    }
    Column(
        Modifier.fillMaxWidth()
            .padding(horizontal = 12.dp, vertical = 8.dp)
            .clip(RoundedCornerShape(25.dp))
            .border(1.dp, Color(0xFF726DA3).copy(alpha = .5f), RoundedCornerShape(25.dp))
            .background(Color(0xFF10132A))
    ) {
        BoxWithConstraints(
            Modifier.fillMaxWidth().height(298.dp)
                .clip(RoundedCornerShape(25.dp))
                .pointerInput(slides.size) {
                    var dragPixels = 0f
                    detectHorizontalDragGestures(
                        onDragStart = {
                            dragPixels = 0f
                            lastTouched = System.currentTimeMillis()
                        },
                        onHorizontalDrag = { change, dragAmount ->
                            change.consume()
                            dragPixels += dragAmount
                        },
                        onDragEnd = {
                            if (slides.size > 1 && kotlin.math.abs(dragPixels) > 38.dp.toPx()) {
                                currentIndex = (currentIndex +
                                    (if (dragPixels < 0f) 1 else -1) + slides.size) % slides.size
                            }
                            lastTouched = System.currentTimeMillis()
                        }
                    )
                }
        ) {
            val centerSlide = current
            AsyncImage(
                model = centerSlide.backdrop.ifBlank { centerSlide.poster },
                contentDescription = null, contentScale = ContentScale.Crop,
                modifier = Modifier.fillMaxSize().blur(24.dp)
            )
            Box(Modifier.fillMaxSize().background(Brush.verticalGradient(
                listOf(Color(0xCB090A1A), Color(0xD80F1031), Color(0xFF0D1028)))))
            val posterWidth = minOf(maxWidth * .36f, 154.dp)
            val stride = minOf(maxWidth * .235f, 94.dp)
            // Perspective halo matches FlixLeo's cinematic violet/blue glass wheel.
            Box(Modifier.align(Alignment.BottomCenter)
                .padding(bottom = 17.dp)
                .fillMaxWidth(.70f).height(38.dp)
                .border(2.dp, Color(0xFF9C83FF).copy(alpha = .75f), CircleShape)
                .background(Brush.radialGradient(listOf(Color(0x664E3BAB), Color.Transparent)), CircleShape))
            if (slides.size > 1) {
                (-2..2).sortedByDescending { abs(it) }.forEach { offset ->
                    val position = (currentIndex + offset + slides.size * 4) % slides.size
                    val item = slides[position]
                    val isCenter = offset == 0
                    val slideX by animateDpAsState(stride * offset,
                        animationSpec = tween(460, easing = FastOutSlowInEasing), label = "wheel-x")
                    val rotate by animateFloatAsState(
                        when (offset) { -2 -> 42f; -1 -> 24f; 1 -> -24f; 2 -> -42f; else -> 0f },
                        animationSpec = tween(460), label = "wheel-rotation"
                    )
                    val scale by animateFloatAsState(
                        when (abs(offset)) { 0 -> 1f; 1 -> .86f; else -> .71f },
                        animationSpec = tween(460), label = "wheel-scale"
                    )
                    Box(
                        Modifier.align(Alignment.Center)
                            .offset(x = slideX, y = if (isCenter) (-4).dp else 5.dp)
                            .width(posterWidth).height(211.dp)
                            .zIndex((4 - abs(offset)).toFloat())
                            .graphicsLayer {
                                rotationY = rotate
                                scaleX = scale
                                scaleY = scale
                                cameraDistance = 13f * density
                                alpha = if (abs(offset) == 2) .75f else 1f
                            }
                            .clip(RoundedCornerShape(14.dp))
                            .border(if (isCenter) 2.dp else 1.dp,
                                if (isCenter) Color(0xFFC4A8FF) else Color.White.copy(alpha = .27f),
                                RoundedCornerShape(14.dp))
                            .background(Card)
                            .clickable {
                                lastTouched = System.currentTimeMillis()
                                if (isCenter) state.open(item)
                                else currentIndex = position
                            }
                    ) {
                        AsyncImage(model = item.poster, contentDescription = item.title,
                            contentScale = ContentScale.Crop, modifier = Modifier.fillMaxSize())
                        if (isCenter) Box(Modifier.fillMaxSize()
                            .background(Brush.verticalGradient(listOf(Color.Transparent, Color(0x4D121526)))))
                    }
                }
            } else {
                AsyncImage(model = current.poster, contentDescription = current.title,
                    contentScale = ContentScale.Crop,
                    modifier = Modifier.align(Alignment.Center).width(posterWidth).height(208.dp)
                        .clip(RoundedCornerShape(14.dp)).clickable { state.open(current) })
            }
            if (slides.size > 1) {
                IconButton(onClick = {
                    lastTouched = System.currentTimeMillis()
                    currentIndex = (currentIndex - 1 + slides.size) % slides.size
                }, modifier = Modifier.align(Alignment.CenterStart)
                    .padding(start = 6.dp).size(34.dp)
                    .background(Color(0xB910162A), CircleShape)) {
                    Icon(Icons.Default.ChevronLeft, "Previous featured title", tint = Color.White)
                }
                IconButton(onClick = {
                    lastTouched = System.currentTimeMillis()
                    currentIndex = (currentIndex + 1) % slides.size
                }, modifier = Modifier.align(Alignment.CenterEnd)
                    .padding(end = 6.dp).size(34.dp)
                    .background(Color(0xB910162A), CircleShape)) {
                    Icon(Icons.Default.ChevronRight, "Next featured title", tint = Color.White)
                }
            }
        }
        Column(Modifier.fillMaxWidth().padding(start = 17.dp, end = 17.dp, bottom = 17.dp)) {
            Text("✦  CINEMATIC SPOTLIGHT", color = Color(0xFFC5B3FF), fontSize = 10.sp,
                fontWeight = FontWeight.Bold, letterSpacing = 1.3.sp)
            Spacer(Modifier.height(5.dp))
            Text(current.title, fontWeight = FontWeight.Black, fontSize = 22.sp,
                maxLines = 2, overflow = TextOverflow.Ellipsis, color = Color.White)
            Text(listOf(current.year, current.language, if (current.type == "tv") "Series" else "Movie")
                .filter { it.isNotBlank() }.joinToString("  ·  "), color = Muted, fontSize = 12.sp)
            Spacer(Modifier.height(10.dp))
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(9.dp)) {
                Button(onClick = { state.open(current) },
                    shape = RoundedCornerShape(12.dp), modifier = Modifier.weight(1f).height(42.dp)) {
                    Icon(Icons.Default.PlayArrow, null, modifier = Modifier.size(20.dp))
                    Spacer(Modifier.width(6.dp))
                    Text("Watch", fontWeight = FontWeight.Bold)
                }
                OutlinedButton(onClick = { state.toggleWatch(current) },
                    shape = RoundedCornerShape(12.dp), modifier = Modifier.height(42.dp)) {
                    Icon(if (state.watchlist.contains(current.id)) Icons.Default.BookmarkAdded
                        else Icons.Default.BookmarkBorder,
                        contentDescription = "Save featured title", modifier = Modifier.size(19.dp))
                }
                OutlinedButton(onClick = { state.open(current) },
                    shape = RoundedCornerShape(12.dp), modifier = Modifier.height(42.dp)) {
                    Text("Details", fontSize = 12.sp)
                }
            }
            if (slides.size > 1) Row(Modifier.fillMaxWidth().padding(top = 13.dp),
                horizontalArrangement = Arrangement.Center) {
                repeat(slides.size.coerceAtMost(11)) { i ->
                    Box(Modifier.padding(horizontal = 3.dp)
                        .width(if (i == currentIndex) 16.dp else 5.dp).height(5.dp)
                        .clip(CircleShape)
                        .background(if (i == currentIndex) Color(0xFFBFA6FF) else Color(0xFF4A4C68)))
                }
            }
        }
    }
}
@Composable
private fun HomeScreen(state: FlixState) {
    val sections = state.home
    LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(bottom = 25.dp)) {
        item {
            if (sections.isNotEmpty()) {
                HeroWheel(sections.first().second, state)
            } else if (!state.loading) {
                Column(Modifier.fillMaxWidth().padding(24.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                    Icon(Icons.Default.WifiOff, contentDescription = null, tint = Muted, modifier = Modifier.size(35.dp))
                    Spacer(Modifier.height(12.dp))
                    Text("Couldn't load the catalogue", color = Color.White)
                    TextButton(onClick = state::refresh) { Text("Retry") }
                }
            }
        }
        item {
            val history = state.history
            if (history.isNotEmpty()) {
                Heading("Continue Watching")
                LazyRow(contentPadding = PaddingValues(horizontal = 17.dp),
                    horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    items(history, key = { it.key }) { entry ->
                        Column(Modifier.width(165.dp).clickable { state.open(entry.title) }) {
                            Box(Modifier.fillMaxWidth().height(99.dp)
                                .clip(RoundedCornerShape(12.dp)).background(Card)) {
                                AsyncImage(entry.title.backdrop.ifBlank { entry.title.poster },
                                    contentDescription = entry.title.title, contentScale = ContentScale.Crop,
                                    modifier = Modifier.fillMaxSize())
                                Box(Modifier.align(Alignment.BottomCenter).fillMaxWidth().height(4.dp)
                                    .background(Color.DarkGray)) {
                                    Box(Modifier.fillMaxWidth(
                                        if (entry.duration > 0) (entry.progress / entry.duration).toFloat().coerceIn(0f, 1f) else .01f)
                                        .fillMaxHeight().background(Gold))
                                }
                            }
                            Text(entry.title.title, maxLines = 1, overflow = TextOverflow.Ellipsis,
                                color = Color.White, fontSize = 12.sp)
                            if (entry.title.episode > 0) Text("S${entry.title.season} · E${entry.title.episode}",
                                fontSize = 11.sp, color = Gold)
                        }
                    }
                }
            }
        }
        item {
            val langs = state.favorites
            val genres = state.favoriteGenres
            val artists = state.favoriteArtists
            val all = sections.flatMap { it.second }.distinctBy { it.id }
            val matched = all.filter { t ->
                langs.any { t.language.contains(it, ignoreCase = true) } ||
                genres.any { g -> t.genres.any { it.equals(g, ignoreCase = true) } } ||
                artists.any { a -> t.cast.any { it.contains(a, ignoreCase = true) } }
            }.take(24)
            if ((langs.isNotEmpty() || genres.isNotEmpty() || artists.isNotEmpty()) && matched.isNotEmpty()) {
                PosterRow("For You", matched, state)
            }
        }
        items(sections.filter { it.first != "Spotlight" }) { (heading, data) ->
            PosterRow(heading, data, state)
        }
        item { Text("Movie and series metadata by TMDB · Stream availability depends on providers.",
            color = Muted, fontSize = 10.sp, modifier = Modifier.padding(20.dp)) }
    }
}
@Composable
private fun BrowseScreen(state: FlixState, tv: Boolean) {
    val titles = if (tv) state.series else state.movies
    LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(14.dp)) {
        item {
            Text(if (tv) "Series" else "Movies", fontSize = 29.sp, fontWeight = FontWeight.Black)
            Text("Discover your next watch", color = Muted, fontSize = 12.sp)
            Spacer(Modifier.height(14.dp))
        }
        if (titles.isNotEmpty()) item {
            HeroWheel(titles.take(15), state)
            Spacer(Modifier.height(11.dp))
            Heading(if (tv) "Explore Series" else "Explore Movies")
        }
        if (titles.isEmpty() && !state.loading) item {
            Text("No catalogue entries found. Tap Refresh.", color = Muted)
        }
        items(titles.chunked(3)) { group ->
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(11.dp)) {
                group.forEach { title ->
                    Box(Modifier.weight(1f)) {
                        Column(Modifier.fillMaxWidth().clickable { state.open(title) }) {
                            AsyncImage(title.poster, title.title, contentScale = ContentScale.Crop,
                                modifier = Modifier.fillMaxWidth().height(161.dp)
                                    .clip(RoundedCornerShape(12.dp)).background(Card))
                            Text(title.title, fontSize = 11.sp, color = Color.White,
                                maxLines = 2, overflow = TextOverflow.Ellipsis)
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                Text(title.year, fontSize = 10.sp, color = Muted)
                                if (title.rating.isNotBlank()) {
                                    Spacer(Modifier.width(6.dp))
                                    Text("★ ${title.rating}", fontSize = 10.sp,
                                        color = Gold, fontWeight = FontWeight.Bold)
                                }
                            }
                        }
                    }
                }
                repeat(3 - group.size) { Spacer(Modifier.weight(1f)) }
            }
            Spacer(Modifier.height(14.dp))
        }
    }
}
@Composable
private fun SearchScreen(state: FlixState) {
    Column(Modifier.fillMaxSize()) {
        Text("Search", fontSize = 28.sp, fontWeight = FontWeight.Black,
            modifier = Modifier.padding(start = 17.dp, top = 8.dp, bottom = 11.dp))
        OutlinedTextField(value = state.search, onValueChange = state::performSearch,
            label = { Text("Movies, series and artists") },
            leadingIcon = { Icon(Icons.Default.Search, null) },
            singleLine = true, shape = RoundedCornerShape(15.dp),
            modifier = Modifier.fillMaxWidth().padding(horizontal = 15.dp))
        if (state.searchLoading) LinearProgressIndicator(Modifier.fillMaxWidth(), color = Gold)
        if (state.searchError.isNotBlank()) {
            Row(Modifier.fillMaxWidth().padding(horizontal = 17.dp, vertical = 10.dp),
                verticalAlignment = Alignment.CenterVertically) {
                Icon(Icons.Default.WifiOff, null, tint = Muted, modifier = Modifier.size(20.dp))
                Spacer(Modifier.width(9.dp))
                Text(state.searchError, color = Muted, fontSize = 12.sp,
                    modifier = Modifier.weight(1f))
                TextButton(onClick = { state.performSearch(state.search) }) { Text("Retry") }
            }
        }
        LazyColumn(contentPadding = PaddingValues(17.dp), verticalArrangement = Arrangement.spacedBy(11.dp)) {
            items(state.searchResults) { item ->
                Row(Modifier.fillMaxWidth().clip(RoundedCornerShape(12.dp))
                    .background(Card).clickable { state.open(item) }.padding(7.dp),
                    verticalAlignment = Alignment.CenterVertically) {
                    AsyncImage(item.poster, item.title, contentScale = ContentScale.Crop,
                        modifier = Modifier.size(width = 61.dp, height = 83.dp)
                            .clip(RoundedCornerShape(7.dp)))
                    Column(Modifier.weight(1f).padding(start = 12.dp)) {
                        Text(item.title, fontWeight = FontWeight.SemiBold, maxLines = 2)
                        Text(item.year + " · " + item.type.uppercase() + " · " + item.language,
                            color = Muted, fontSize = 11.sp)
                    }
                    Icon(Icons.Default.ChevronRight, contentDescription = null, tint = Gold)
                }
            }
            if (state.searchResults.isEmpty() && !state.searchLoading &&
                state.search.isNotEmpty() && state.searchError.isEmpty()) item {
                Text("No matching titles found.", color = Muted)
            }
        }
    }
}
@Composable
private fun LiveScreen(state: FlixState) {
    LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(bottom = 25.dp)) {
        item {
            Heading("Live TV", "Channel categories from connected providers")
            if (state.live.isEmpty()) {
                Text("Channels not available right now", color = Muted, modifier = Modifier.padding(17.dp))
                TextButton(onClick = { state.refreshLive() }, modifier = Modifier.padding(start = 12.dp)) {
                    Text("Retry Live TV")
                }
            }
        }
        items(state.live) { category ->
            Heading(category.name)
            LazyRow(contentPadding = PaddingValues(horizontal = 17.dp),
                horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                items(category.channels, key = { it.id }) { channel ->
                    Column(Modifier.width(130.dp).clip(RoundedCornerShape(14.dp))
                        .background(Card).clickable { state.channel(channel) }.padding(6.dp)) {
                        AsyncImage(channel.poster, channel.name, contentScale = ContentScale.Fit,
                            modifier = Modifier.fillMaxWidth().height(95.dp))
                        Text(channel.name, color = Color.White, fontSize = 12.sp,
                            maxLines = 2, overflow = TextOverflow.Ellipsis)
                    }
                }
            }
        }
    }
}
@Composable
private fun DetailSheet(state: FlixState) {
    val title = state.selected
    val channel = state.selectedChannel
    Column(Modifier.fillMaxWidth().heightIn(max = 660.dp)
        .verticalScroll(rememberScrollState()).padding(start = 17.dp, end = 17.dp, bottom = 33.dp)) {
        if (title != null) {
            AsyncImage(title.backdrop.ifBlank { title.poster }, title.title,
                modifier = Modifier.fillMaxWidth().height(173.dp).clip(RoundedCornerShape(16.dp))
                    .background(Card), contentScale = ContentScale.Crop)
            Spacer(Modifier.height(10.dp))
            Text(title.title, fontWeight = FontWeight.Black, fontSize = 24.sp)
            Text(listOf(title.year, title.language, title.type.uppercase()).filter { it.isNotBlank() }
                .joinToString(" · "), color = Gold, fontSize = 12.sp)
            if (title.rating.isNotBlank()) {
                Spacer(Modifier.height(6.dp))
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Icon(Icons.Default.Star, null, tint = Gold, modifier = Modifier.size(18.dp))
                    Spacer(Modifier.width(5.dp))
                    Text(title.rating + " / 10", fontSize = 16.sp, fontWeight = FontWeight.Bold,
                        color = Color.White)
                    Spacer(Modifier.width(8.dp))
                    Text("TMDB score", color = Muted, fontSize = 11.sp)
                }
            }
            Spacer(Modifier.height(7.dp))
            if (title.description.isNotBlank()) Text(title.description, fontSize = 13.sp, color = Color.LightGray)
            if (title.cast.isNotEmpty()) {
                Spacer(Modifier.height(8.dp))
                Text("Cast: " + title.cast.take(6).joinToString(", "), color = Muted, fontSize = 11.sp)
            }
            Spacer(Modifier.height(11.dp))
            OutlinedButton(onClick = { state.toggleWatch(title) }) {
                Icon(if (state.account == null) Icons.Default.LockOutline
                    else if (state.watchlist.contains(title.id)) Icons.Default.BookmarkAdded
                    else Icons.Default.BookmarkAdd, null)
                Spacer(Modifier.width(7.dp))
                Text(if (state.account == null) "Sign in to save to Watchlist"
                    else if (state.watchlist.contains(title.id)) "Remove from Watchlist"
                    else "Add to Watchlist")
            }
            if (title.type == "tv") {
                Spacer(Modifier.height(15.dp))
                Text("Seasons & Episodes", fontWeight = FontWeight.Bold)
                if (state.episodes.isEmpty() && state.detailsLoading) CircularProgressIndicator(color = Gold, modifier = Modifier.size(24.dp))
                if (state.episodes.isEmpty() && !state.detailsLoading) Text("No episode details available", color = Muted, fontSize = 12.sp)
                val seasons = state.episodes.map { it.season }.distinct().sorted()
                Row(Modifier.horizontalScroll(rememberScrollState()),
                    horizontalArrangement = Arrangement.spacedBy(7.dp)) {
                    seasons.forEach { num ->
                        FilterChip(selected = state.chosenSeason == num, onClick = {
                            state.chooseEpisode(state.episodes.first { it.season == num })
                        }, label = { Text("S$num") })
                    }
                }
                Column {
                    state.episodes.filter { it.season == state.chosenSeason }.take(28).forEach { episode ->
                        val chosen = state.chosenSeason == episode.season && state.chosenEpisode == episode.number
                        Row(Modifier.fillMaxWidth().padding(vertical = 3.dp)
                            .clip(RoundedCornerShape(10.dp))
                            .background(if (chosen) Gold.copy(alpha = .15f) else Card)
                            .clickable { state.chooseEpisode(episode) }.padding(11.dp),
                            verticalAlignment = Alignment.CenterVertically) {
                            Text("E${episode.number}", color = Gold, fontSize = 12.sp, fontWeight = FontWeight.Bold)
                            Spacer(Modifier.width(12.dp))
                            Text(episode.title, color = Color.White, fontSize = 12.sp, modifier = Modifier.weight(1f))
                            if (chosen) Icon(Icons.Default.CheckCircle, null, tint = Gold, modifier = Modifier.size(17.dp))
                        }
                    }
                }
            }
            // Stream discovery happens automatically after opening details or choosing an episode.
            Spacer(Modifier.height(10.dp))
                } else if (channel != null) {
            Text(channel.name, fontSize = 23.sp, fontWeight = FontWeight.Black)
            Text("Live TV", color = Gold)
        }
        Spacer(Modifier.height(13.dp))
        if (state.detailsLoading && state.streams.isEmpty()) {
            Surface(color = Card, shape = RoundedCornerShape(15.dp)) {
                Row(Modifier.fillMaxWidth().padding(18.dp), verticalAlignment = Alignment.CenterVertically) {
                    CircularProgressIndicator(color = Gold, strokeWidth = 2.dp,
                        modifier = Modifier.size(22.dp))
                    Spacer(Modifier.width(12.dp))
                    Column {
                        Text("Checking available playback options", color = Color.White,
                            fontWeight = FontWeight.SemiBold, fontSize = 14.sp)
                        Text("Fetching quality and server choices…", color = Muted, fontSize = 12.sp)
                    }
                }
            }
        }
        if (state.streams.isNotEmpty()) {
            Text("READY TO WATCH", color = Gold, fontSize = 11.sp,
                fontWeight = FontWeight.Black, letterSpacing = 1.3.sp)
            Spacer(Modifier.height(6.dp))
            Text("Select video quality", color = Color.White, fontWeight = FontWeight.Bold,
                fontSize = 18.sp)
            Text("Sources are automatically discovered. Tap to play.",
                color = Muted, fontSize = 12.sp)
            Spacer(Modifier.height(12.dp))
            Button(onClick = { state.play(state.streams.first()) },
                modifier = Modifier.fillMaxWidth().height(50.dp),
                shape = RoundedCornerShape(14.dp)) {
                Icon(Icons.Default.PlayArrow, null, modifier = Modifier.size(23.dp))
                Spacer(Modifier.width(8.dp))
                Text("Play best available · ${state.streams.first().quality}",
                    fontSize = 14.sp, fontWeight = FontWeight.Bold)
            }
            Spacer(Modifier.height(11.dp))
            state.streams.forEachIndexed { index, source ->
                Surface(onClick = { state.play(source) },
                    color = if (index == 0) Color(0xFF242D40) else Card,
                    shape = RoundedCornerShape(14.dp),
                    modifier = Modifier.fillMaxWidth().padding(vertical = 4.dp)) {
                    Row(Modifier.fillMaxWidth().padding(horizontal = 14.dp, vertical = 12.dp),
                        verticalAlignment = Alignment.CenterVertically) {
                        Box(Modifier.size(38.dp).clip(RoundedCornerShape(11.dp))
                            .background(Gold.copy(alpha = .12f)),
                            contentAlignment = Alignment.Center) {
                            Icon(Icons.Default.PlayCircle, null, tint = Gold, modifier = Modifier.size(25.dp))
                        }
                        Spacer(Modifier.width(12.dp))
                        Column(Modifier.weight(1f)) {
                            Text(source.quality + if (source.size.isNotBlank()) " · " + source.size else "",
                                fontSize = 15.sp, fontWeight = FontWeight.Bold, color = Color.White,
                                maxLines = 1)
                            Text("Option ${index+1}" + if (index == 0) " · Recommended" else "",
                                color = Muted, fontSize = 12.sp)
                        }
                        Icon(Icons.Default.ChevronRight, contentDescription = "Play source",
                            tint = Gold, modifier = Modifier.size(22.dp))
                    }
                }
            }
        } else if (!state.detailsLoading && state.streamsChecked) {
            Column(Modifier.fillMaxWidth()
                .clip(RoundedCornerShape(15.dp)).background(Card).padding(17.dp),
                horizontalAlignment = Alignment.CenterHorizontally) {
                Icon(Icons.Default.WifiOff, null, tint = Color(0xFFFDA4AF),
                    modifier = Modifier.size(26.dp))
                Spacer(Modifier.height(8.dp))
                Text("No streams available", color = Color(0xFFFDA4AF),
                    fontSize = 17.sp, fontWeight = FontWeight.Bold)
                Text("This title has no compatible playback option right now.",
                    color = Muted, fontSize = 12.sp, textAlign = TextAlign.Center)
                Spacer(Modifier.height(7.dp))
                TextButton(onClick = {
                    if (channel != null) state.channel(channel)
                    else state.resolveStreams()
                }) { Text("Try again", color = Gold) }
            }
        }
    }
}
@Composable
private fun ProfileScreen(state: FlixState) {
    var interestsOpen by remember { mutableStateOf(false) }
    var tvOpen by remember { mutableStateOf(false) }
    var pairId by remember { mutableStateOf("") }
    var newArtist by remember { mutableStateOf("") }
    val session = state.account

    LazyColumn(Modifier.fillMaxSize().background(Ink),
        contentPadding = PaddingValues(start = 16.dp, end = 16.dp, bottom = 30.dp),
        verticalArrangement = Arrangement.spacedBy(13.dp)) {
        item {
            Spacer(Modifier.height(8.dp))
            Text("My FlixLeo", fontSize = 27.sp, fontWeight = FontWeight.Black, color = Color.White)
            Text("Your entertainment, your way", fontSize = 13.sp, color = Muted)
        }
        item {
            Column(Modifier.fillMaxWidth()
                .clip(RoundedCornerShape(24.dp))
                .background(Brush.linearGradient(listOf(Color(0xFF222440), Color(0xFF151D2D), Color(0xFF141722))))
                .border(1.dp, Color.White.copy(alpha = .10f), RoundedCornerShape(24.dp))
                .padding(19.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Box(Modifier.size(64.dp).clip(CircleShape)
                        .background(Brush.linearGradient(listOf(Gold, Color(0xFFF97316)))),
                        contentAlignment = Alignment.Center) {
                        Icon(Icons.Default.Person, contentDescription = null, tint = Ink,
                            modifier = Modifier.size(33.dp))
                    }
                    Spacer(Modifier.width(13.dp))
                    Column(Modifier.weight(1f)) {
                        Text(session?.user?.optJSONObject("user_metadata")
                            ?.optString("display_name")?.takeIf { it.isNotBlank() }
                            ?: if (session == null) "Welcome to FlixLeo" else "Your account",
                            color = Color.White, fontSize = 19.sp, fontWeight = FontWeight.Bold,
                            maxLines = 2, overflow = TextOverflow.Ellipsis)
                        Text(session?.user?.optString("email") ?: "Enjoy movies without signing in",
                            color = Muted, fontSize = 12.sp, maxLines = 2)
                        Spacer(Modifier.height(6.dp))
                        Text(if (session == null) "GUEST MODE" else "✓ VERIFIED ACCOUNT",
                            color = if (session == null) Color(0xFFFCD34D) else Color(0xFF86EFAC),
                            fontSize = 10.sp, fontWeight = FontWeight.Bold,
                            letterSpacing = 1.sp)
                    }
                }
                Spacer(Modifier.height(16.dp))
                if (session == null) {
                    Button(onClick = { state.showAuth = true },
                        modifier = Modifier.fillMaxWidth().height(49.dp),
                        shape = RoundedCornerShape(14.dp)) {
                        Icon(Icons.Default.LockOpen, contentDescription = null, modifier = Modifier.size(19.dp))
                        Spacer(Modifier.width(9.dp))
                        Text("Sign in or create account", fontWeight = FontWeight.Bold)
                    }
                    Text("Sign in to share your watchlist and playback progress across platforms.",
                        color = Muted, fontSize = 12.sp,
                        modifier = Modifier.padding(top = 10.dp))
                } else {
                    Surface(color = Color.White.copy(alpha = .07f),
                        shape = RoundedCornerShape(14.dp)) {
                        Row(Modifier.fillMaxWidth().padding(13.dp),
                            verticalAlignment = Alignment.CenterVertically) {
                            Icon(Icons.Default.CloudDone, contentDescription = null, tint = Color(0xFF86EFAC))
                            Spacer(Modifier.width(10.dp))
                            Text("Syncs with your FlixLeo account",
                                fontSize = 12.sp, color = Color.White,
                                modifier = Modifier.weight(1f))
                        }
                    }
                }
            }
        }
        item {
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                ProfileStat("Watchlist", state.watchlist.size.toString(), Icons.Default.Bookmark,
                    Modifier.weight(1f))
                ProfileStat("Continue", state.history.size.toString(), Icons.Default.PlayCircle,
                    Modifier.weight(1f))
                ProfileStat("Languages", state.favorites.size.toString(), Icons.Default.Language,
                    Modifier.weight(1f))
            }
        }
        item {
            ProfileHeading("My Watchlist", "Saved movies and series", Icons.Default.Bookmarks)
            val items = (state.home.flatMap { it.second } + state.movies + state.series +
                state.history.map { it.title }).distinctBy { it.id }
                .filter { it.id in state.watchlist }
            if (items.isEmpty()) {
                Surface(color = Card, shape = RoundedCornerShape(17.dp)) {
                    Row(Modifier.fillMaxWidth().padding(16.dp), verticalAlignment = Alignment.CenterVertically) {
                        Icon(Icons.Default.BookmarkBorder, null, tint = Gold)
                        Spacer(Modifier.width(12.dp))
                        Text("Save titles from Home or Search to see them here.",
                            color = Muted, fontSize = 12.sp)
                    }
                }
            } else {
                LazyRow(horizontalArrangement = Arrangement.spacedBy(11.dp),
                    contentPadding = PaddingValues(vertical = 7.dp)) {
                    items(items, key = { it.id }) { item ->
                        Poster(item, true, compact = true) { state.open(item) }
                    }
                }
            }
        }
        if (session != null) {
            item {
                Spacer(Modifier.height(3.dp))
                Surface(color = Card, shape = RoundedCornerShape(17.dp),
                    modifier = Modifier.fillMaxWidth()) {
                    Column(Modifier.fillMaxWidth().animateContentSize()) {
                        Row(Modifier.fillMaxWidth().clickable { interestsOpen = !interestsOpen }
                            .padding(16.dp), verticalAlignment = Alignment.CenterVertically) {
                            Icon(Icons.Default.Tune, null, tint = Gold)
                            Spacer(Modifier.width(11.dp))
                            Column(Modifier.weight(1f)) {
                                Text("Personalize For You", fontWeight = FontWeight.Bold, fontSize = 15.sp)
                                Text("Languages, genres & artists", color = Muted, fontSize = 12.sp)
                            }
                            Icon(if (interestsOpen) Icons.Default.ExpandLess else Icons.Default.ChevronRight,
                                "Edit preferences", tint = Muted)
                        }
                        AnimatedVisibility(interestsOpen) {
                            Column(Modifier.padding(start = 14.dp, end = 14.dp, bottom = 15.dp)) {
                                InterestOptions(state,
                                    newArtist = newArtist,
                                    onArtistChange = { newArtist = it },
                                    onArtistAdd = {
                                        state.addArtist(newArtist)
                                        newArtist = ""
                                    })
                                OutlinedButton(onClick = { state.saveProfile(); interestsOpen = false },
                                    modifier = Modifier.fillMaxWidth()) {
                                    Icon(Icons.Default.Check, null)
                                    Spacer(Modifier.width(7.dp))
                                    Text("Save preferences")
                                }
                            }
                        }
                    }
                }
            }
            item {
                Surface(color = Card, shape = RoundedCornerShape(17.dp),
                    modifier = Modifier.fillMaxWidth()) {
                    Column(Modifier.fillMaxWidth().animateContentSize()) {
                        Row(Modifier.fillMaxWidth().clickable {
                            tvOpen = !tvOpen
                            if (tvOpen) state.loadApprovedTvs()
                        }.padding(16.dp), verticalAlignment = Alignment.CenterVertically) {
                            Icon(Icons.Default.Tv, null, tint = Gold)
                            Spacer(Modifier.width(11.dp))
                            Column(Modifier.weight(1f)) {
                                Text("Connected TVs", fontWeight = FontWeight.Bold, fontSize = 15.sp)
                                Text("Manage access and pairing", color = Muted, fontSize = 12.sp)
                            }
                            Icon(if (tvOpen) Icons.Default.ExpandLess else Icons.Default.ChevronRight,
                                "Manage TVs", tint = Muted)
                        }
                        AnimatedVisibility(tvOpen) {
                            Column(Modifier.padding(horizontal = 15.dp, vertical = 10.dp)) {
                                state.approvedTvs.forEach { tv ->
                                    Row(Modifier.fillMaxWidth().padding(vertical = 4.dp),
                                        verticalAlignment = Alignment.CenterVertically) {
                                        Text(tv.optString("label", "TV"),
                                            color = Color.White, modifier = Modifier.weight(1f))
                                        TextButton(onClick = { state.revokeTv(tv.optString("id")) }) {
                                            Text("Revoke")
                                        }
                                    }
                                }
                                OutlinedTextField(pairId, onValueChange = { pairId = it.take(90) },
                                    label = { Text("TV pairing ID") }, singleLine = true,
                                    modifier = Modifier.fillMaxWidth())
                                Button(onClick = {
                                    state.approveTv(pairId); pairId = ""
                                }, enabled = pairId.isNotBlank(),
                                    modifier = Modifier.fillMaxWidth().padding(top = 7.dp)) {
                                    Text("Approve TV")
                                }
                            }
                        }
                    }
                }
            }
            item {
                OutlinedButton(onClick = { state.signOut() },
                    modifier = Modifier.fillMaxWidth().height(47.dp),
                    shape = RoundedCornerShape(15.dp)) {
                    Icon(Icons.Default.Logout, null, tint = Color(0xFFFDA4AF))
                    Spacer(Modifier.width(10.dp))
                    Text("Sign out", color = Color(0xFFFDA4AF), fontWeight = FontWeight.SemiBold)
                }
            }
        }
        item {
            Column(Modifier.fillMaxWidth().padding(top = 9.dp),
                horizontalAlignment = Alignment.CenterHorizontally) {
                Image(painterResource(R.drawable.flixleo_brand), contentDescription = null,
                    modifier = Modifier.size(32.dp).clip(RoundedCornerShape(9.dp)))
                Spacer(Modifier.height(5.dp))
                Text("FlixLeo · Native Android", fontSize = 12.sp, color = Muted)
                Text("Movies & TV series powered by TMDB", fontSize = 10.sp, color = Muted)
            }
        }
    }
}
@Composable
private fun ProfileStat(label: String, number: String,
    icon: androidx.compose.ui.graphics.vector.ImageVector, modifier: Modifier = Modifier) {
    Surface(color = Card, shape = RoundedCornerShape(15.dp), modifier = modifier) {
        Column(Modifier.padding(horizontal = 11.dp, vertical = 13.dp)) {
            Icon(icon, null, tint = Gold, modifier = Modifier.size(20.dp))
            Spacer(Modifier.height(7.dp))
            Text(number, color = Color.White, fontWeight = FontWeight.Black, fontSize = 20.sp)
            Text(label, color = Muted, fontSize = 10.sp, maxLines = 1)
        }
    }
}
@Composable
private fun ProfileHeading(text: String, subtitle: String,
    icon: androidx.compose.ui.graphics.vector.ImageVector) {
    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
        Icon(icon, null, tint = Gold, modifier = Modifier.size(20.dp))
        Spacer(Modifier.width(8.dp))
        Column {
            Text(text, color = Color.White, fontWeight = FontWeight.Bold, fontSize = 17.sp)
            Text(subtitle, color = Muted, fontSize = 11.sp)
        }
    }
}
@Composable
private fun InterestOptions(state: FlixState, newArtist: String,
    onArtistChange: (String) -> Unit, onArtistAdd: () -> Unit) {
    Text("Preferred languages", color = Color.White, fontWeight = FontWeight.SemiBold, fontSize = 13.sp)
    Spacer(Modifier.height(4.dp))
    val languages = listOf("English","Tamil","Hindi","Telugu","Malayalam","Kannada",
        "Sinhala","Korean","Japanese")
    languages.chunked(3).forEach { group ->
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(5.dp)) {
            group.forEach { label ->
                FilterChip(label in state.favorites, onClick = { state.toggleLanguage(label) },
                    label = { Text(label, fontSize = 10.sp) },
                    modifier = Modifier.height(39.dp))
            }
        }
    }
    Spacer(Modifier.height(9.dp))
    Text("Favorite genres", color = Color.White, fontWeight = FontWeight.SemiBold, fontSize = 13.sp)
    listOf("Action","Comedy","Drama","Thriller","Romance","Sci-Fi","Animation",
        "Horror","Fantasy","Adventure","Crime","Documentary").chunked(3).forEach { group ->
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(5.dp)) {
            group.forEach { label ->
                FilterChip(label in state.favoriteGenres, onClick = { state.toggleGenre(label) },
                    label = { Text(label, fontSize = 10.sp) },
                    modifier = Modifier.height(39.dp))
            }
        }
    }
    Spacer(Modifier.height(9.dp))
    Text("Favorite artists", color = Color.White, fontWeight = FontWeight.SemiBold, fontSize = 13.sp)
    Row(verticalAlignment = Alignment.CenterVertically) {
        OutlinedTextField(newArtist, onValueChange = onArtistChange,
            label = { Text("Artist") }, singleLine = true,
            modifier = Modifier.weight(1f))
        TextButton(onClick = onArtistAdd, enabled = newArtist.isNotBlank()) { Text("Add") }
    }
    state.favoriteArtists.forEach { artist ->
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            Text(artist, Modifier.weight(1f), color = Color.White, fontSize = 12.sp)
            IconButton(onClick = { state.removeArtist(artist) }) {
                Icon(Icons.Default.Close, "Remove artist", tint = Muted, modifier = Modifier.size(17.dp))
            }
        }
    }
}
@Composable
private fun PostSignupInterestsDialog(state: FlixState) {
    var artist by remember { mutableStateOf("") }
    AlertDialog(
        onDismissRequest = { /* Only explicit save/skip clears the signup prompt. */ },
        title = {
            Column {
                Text("Make FlixLeo yours", color = Color.White, fontSize = 20.sp, fontWeight = FontWeight.Black)
                Text("Choose what you enjoy. We will build your For You collection.",
                    fontSize = 12.sp, color = Muted)
            }
        },
        text = {
            Column(Modifier.heightIn(max = 380.dp).verticalScroll(rememberScrollState())) {
                InterestOptions(state, artist, { artist = it.take(80) }) {
                    state.addArtist(artist)
                    artist = ""
                }
            }
        },
        confirmButton = {
            Button(onClick = { state.finishOnboarding(true) },
                shape = RoundedCornerShape(12.dp)) { Text("Save choices") }
        },
        dismissButton = {
            TextButton(onClick = { state.finishOnboarding(false) }) {
                Text("Skip for now")
            }
        }
    )
}
@Composable
private fun AccountDialog(state: FlixState) {
    var email by remember { mutableStateOf("") }
    var password by remember { mutableStateOf("") }
    var agreed by remember { mutableStateOf(false) }
    AlertDialog(onDismissRequest = { state.showAuth = false },
        title = { Text(if (state.showSignup) "Create FlixLeo account" else "Sign in to FlixLeo") },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                Text("Use your existing FlixLeo login.", color = Muted, fontSize = 12.sp)
                OutlinedTextField(value = email, onValueChange = { email = it },
                    label = { Text("Email") }, singleLine = true,
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Email))
                OutlinedTextField(value = password, onValueChange = { password = it },
                    label = { Text("Password") }, singleLine = true,
                    visualTransformation = PasswordVisualTransformation())
                if (state.showSignup) Row(verticalAlignment = Alignment.CenterVertically) {
                    Checkbox(agreed, onCheckedChange = { agreed = it })
                    Text("I agree to the Terms & Privacy Policy", fontSize = 11.sp)
                }
                TextButton(onClick = { state.showSignup = !state.showSignup }) {
                    Text(if (state.showSignup) "Already registered? Sign in" else "New user? Sign up")
                }
                TextButton(onClick = { state.emailAction(email, "resend") }) { Text("Resend verification email") }
                TextButton(onClick = { state.emailAction(email, "recover") }) { Text("Forgot password?") }
            }
        },
        confirmButton = {
            Button(enabled = !state.accountBusy && (!state.showSignup || agreed),
                onClick = {
                    if (state.showSignup) state.signUp(email, password)
                    else state.signIn(email, password)
                }) { Text(if (state.accountBusy) "Please wait…" else if (state.showSignup) "Create account" else "Sign in") }
        },
        dismissButton = { TextButton(onClick = { state.showAuth = false }) { Text("Cancel") } }
    )
}
