package cyou.flixleo.android

import androidx.compose.animation.AnimatedVisibility
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
import coil.compose.AsyncImage
import kotlin.math.absoluteValue
import org.json.JSONObject

private val Ink = Color(0xFF090B11)
private val Card = Color(0xFF171C2B)
private val Gold = Color(0xFFFBBF24)
private val Muted = Color(0xFFA7AAB7)
private val Nav = listOf("Home", "Movies", "Series", "Live TV", "Search", "Profile")

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun FlixLeoNativeApp(state: FlixState) {
    val colors = darkColorScheme(
        primary = Gold, onPrimary = Ink, background = Ink, onBackground = Color.White,
        surface = Color(0xFF111520), onSurface = Color.White,
        secondary = Color(0xFF64748B), error = Color(0xFFFB7185)
    )
    MaterialTheme(colorScheme = colors) {
        Scaffold(
            containerColor = Ink,
            topBar = {
                Row(Modifier.fillMaxWidth().background(Ink).statusBarsPadding()
                    .padding(start = 17.dp, end = 14.dp, top = 7.dp, bottom = 8.dp),
                    verticalAlignment = Alignment.CenterVertically) {
                    Text("F", color = Ink, fontSize = 25.sp, fontWeight = FontWeight.Black,
                        modifier = Modifier.clip(RoundedCornerShape(9.dp)).background(Gold).padding(horizontal = 8.dp))
                    Spacer(Modifier.width(9.dp))
                    Text("FlixLeo", color = Color.White, fontSize = 22.sp, fontWeight = FontWeight.Black)
                    Spacer(Modifier.weight(1f))
                    IconButton(onClick = { state.refresh() }) {
                        Icon(Icons.Default.Refresh, contentDescription = "Refresh catalogue", tint = Muted)
                    }
                    IconButton(onClick = { state.changeTab("Profile") }) {
                        Icon(Icons.Default.AccountCircle, contentDescription = "Profile", tint = Gold)
                    }
                }
            },
            bottomBar = {
                Row(Modifier.fillMaxWidth().background(Color(0xFF121722))
                    .navigationBarsPadding().horizontalScroll(rememberScrollState())
                    .padding(horizontal = 6.dp, vertical = 6.dp),
                    horizontalArrangement = Arrangement.spacedBy(5.dp)) {
                    val icons = listOf(Icons.Default.Home, Icons.Default.Movie, Icons.Default.Tv,
                        Icons.Default.LiveTv, Icons.Default.Search, Icons.Default.Person)
                    Nav.forEachIndexed { i, label ->
                        val active = state.tab == label
                        Column(
                            Modifier.width(72.dp).clip(RoundedCornerShape(13.dp))
                                .background(if (active) Gold.copy(alpha = 0.17f) else Color.Transparent)
                                .clickable { state.changeTab(label) }.padding(vertical = 6.dp),
                            horizontalAlignment = Alignment.CenterHorizontally
                        ) {
                            Icon(icons[i], contentDescription = label,
                                tint = if (active) Gold else Muted, modifier = Modifier.size(23.dp))
                            Text(label, fontSize = 10.sp, fontWeight = if (active) FontWeight.Bold else FontWeight.Normal,
                                color = if (active) Gold else Muted, maxLines = 1)
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
                if (state.loading) LinearProgressIndicator(
                    Modifier.fillMaxWidth().align(Alignment.TopCenter), color = Gold)
                if (state.message.isNotBlank()) {
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
        if (state.selected != null || state.selectedChannel != null) {
            ModalBottomSheet(onDismissRequest = {
                state.selected = null; state.selectedChannel = null; state.streams = emptyList()
            }, sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true),
                containerColor = Color(0xFF111621), dragHandle = { BottomSheetDefaults.DragHandle(color = Muted) }) {
                DetailSheet(state)
            }
        }
        if (state.showAuth) AccountDialog(state)
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
private fun Poster(item: FlixTitle, selected: Boolean, compact: Boolean = false, onClick: () -> Unit) {
    val width = if (compact) 112.dp else 133.dp
    Column(Modifier.width(width).clip(RoundedCornerShape(13.dp))
        .clickable(onClick = onClick)) {
        Box(Modifier.fillMaxWidth().height(if (compact) 150.dp else 187.dp)
            .clip(RoundedCornerShape(12.dp)).background(Card)) {
            AsyncImage(model = item.poster, contentDescription = item.title,
                contentScale = ContentScale.Crop, modifier = Modifier.fillMaxSize())
            if (selected) Icon(Icons.Default.Bookmark, contentDescription = "In watchlist",
                tint = Gold, modifier = Modifier.align(Alignment.TopEnd).padding(6.dp).size(18.dp))
            if (item.type == "tv") Text("SERIES", fontSize = 9.sp, fontWeight = FontWeight.Bold,
                color = Gold, modifier = Modifier.align(Alignment.BottomStart)
                    .background(Ink.copy(alpha = .87f), RoundedCornerShape(topEnd = 7.dp)).padding(5.dp))
        }
        Spacer(Modifier.height(6.dp))
        Text(item.title, color = Color.White, fontSize = 12.sp, fontWeight = FontWeight.Medium,
            maxLines = 2, overflow = TextOverflow.Ellipsis)
        Text(item.year + if (item.rating.isNotBlank()) "  ★${item.rating}" else "",
            color = Muted, fontSize = 10.sp, maxLines = 1)
    }
}
@Composable
private fun PosterRow(label: String, data: List<FlixTitle>, state: FlixState) {
    if (data.isEmpty()) return
    Heading(label)
    LazyRow(horizontalArrangement = Arrangement.spacedBy(11.dp),
        contentPadding = PaddingValues(horizontal = 17.dp)) {
        items(data, key = { label + it.id }) { item ->
            Poster(item, state.watchlist.contains(item.id)) { state.open(item) }
        }
    }
}
@Composable
private fun HeroWheel(items: List<FlixTitle>, state: FlixState) {
    if (items.isEmpty()) return
    val pager = rememberPagerState(pageCount = { items.size.coerceAtMost(18) })
    Box(Modifier.fillMaxWidth().height(270.dp)) {
        HorizontalPager(state = pager, modifier = Modifier.fillMaxSize(),
            contentPadding = PaddingValues(horizontal = 43.dp), pageSpacing = 10.dp) { page ->
            val item = items[page]
            val offset = ((pager.currentPage - page) + pager.currentPageOffsetFraction).absoluteValue
            Box(Modifier.fillMaxSize().padding(vertical = 7.dp)
                .graphicsLayer {
                    scaleX = 1f - (offset * .1f).coerceAtMost(.18f)
                    scaleY = 1f - (offset * .1f).coerceAtMost(.18f)
                    rotationY = ((pager.currentPage - page) + pager.currentPageOffsetFraction) * 15f
                    cameraDistance = 13f * density
                }
                .clip(RoundedCornerShape(23.dp))
                .background(Card).clickable { state.open(item) }) {
                AsyncImage(item.backdrop.takeIf { it.isNotBlank() } ?: item.poster,
                    contentDescription = item.title, contentScale = ContentScale.Crop, modifier = Modifier.fillMaxSize())
                Box(Modifier.fillMaxSize().background(Brush.verticalGradient(listOf(
                    Color.Transparent, Ink.copy(alpha = .23f), Ink.copy(alpha = .98f)))))
                Column(Modifier.align(Alignment.BottomStart).padding(18.dp)) {
                    Text("FLIXLEO FEATURED", color = Gold, fontSize = 10.sp, fontWeight = FontWeight.Bold)
                    Text(item.title, color = Color.White, fontWeight = FontWeight.Black,
                        fontSize = 23.sp, maxLines = 2, overflow = TextOverflow.Ellipsis)
                    Text(item.year + "  ·  " + item.language + if (item.type == "tv") "  ·  Series" else "",
                        color = Color.LightGray, fontSize = 12.sp)
                    Spacer(Modifier.height(7.dp))
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Icon(Icons.Default.PlayCircleFilled, contentDescription = null, tint = Gold)
                        Text("  View details", color = Color.White, fontSize = 13.sp)
                    }
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
            Spacer(Modifier.height(16.dp))
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
                            Text(title.year, fontSize = 10.sp, color = Muted)
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
            if (state.searchResults.isEmpty() && !state.searchLoading && state.search.isNotEmpty()) item {
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
            Spacer(Modifier.height(7.dp))
            if (title.description.isNotBlank()) Text(title.description, fontSize = 13.sp, color = Color.LightGray)
            if (title.cast.isNotEmpty()) {
                Spacer(Modifier.height(8.dp))
                Text("Cast: " + title.cast.take(6).joinToString(", "), color = Muted, fontSize = 11.sp)
            }
            Spacer(Modifier.height(11.dp))
            OutlinedButton(onClick = { state.toggleWatch(title) }) {
                Icon(if (state.watchlist.contains(title.id)) Icons.Default.BookmarkAdded else Icons.Default.BookmarkAdd, null)
                Spacer(Modifier.width(7.dp))
                Text(if (state.watchlist.contains(title.id)) "Remove from Watchlist" else "Add to Watchlist")
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
            Spacer(Modifier.height(11.dp))
            Button(onClick = { state.resolveStreams() }, enabled = !state.detailsLoading,
                modifier = Modifier.fillMaxWidth(), shape = RoundedCornerShape(12.dp)) {
                Icon(Icons.Default.PlayArrow, null)
                Spacer(Modifier.width(7.dp))
                Text(if (state.detailsLoading) "Finding streams…" else if (state.streams.isEmpty()) "Find Servers" else "Refresh Servers")
            }
        } else if (channel != null) {
            Text(channel.name, fontSize = 23.sp, fontWeight = FontWeight.Black)
            Text("Live TV", color = Gold)
        }
        if (state.detailsLoading) {
            Spacer(Modifier.height(10.dp))
            LinearProgressIndicator(Modifier.fillMaxWidth())
        }
        if (state.streams.isNotEmpty()) {
            Heading("Available Servers", "Select quality to play in built-in VLC")
            state.streams.forEach { source ->
                Surface(onClick = { state.play(source) }, color = Card,
                    shape = RoundedCornerShape(11.dp),
                    modifier = Modifier.fillMaxWidth().padding(vertical = 4.dp)) {
                    Row(Modifier.padding(15.dp), verticalAlignment = Alignment.CenterVertically) {
                        Icon(Icons.Default.PlayCircle, null, tint = Gold)
                        Spacer(Modifier.width(12.dp))
                        Column(Modifier.weight(1f)) {
                            Text(source.quality + if (source.size.isNotBlank()) " · " + source.size else "",
                                fontWeight = FontWeight.Bold)
                            Text(source.name, fontSize = 11.sp, color = Muted, maxLines = 2)
                        }
                        Icon(Icons.Default.ChevronRight, null, tint = Gold)
                    }
                }
            }
        } else if (!state.detailsLoading && channel != null) {
            Text("No streams available", color = Color(0xFFFF6B78),
                fontSize = 17.sp, fontWeight = FontWeight.Bold)
        }
    }
}
@Composable
private fun ProfileScreen(state: FlixState) {
    var pairId by remember { mutableStateOf("") }
    var newArtist by remember { mutableStateOf("") }
    val session = state.account
    LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(16.dp)) {
        item {
            Text("Your FlixLeo", fontSize = 27.sp, fontWeight = FontWeight.Black)
            Spacer(Modifier.height(8.dp))
            Surface(color = Card, shape = RoundedCornerShape(18.dp),
                modifier = Modifier.fillMaxWidth()) {
                Column(Modifier.padding(16.dp)) {
                    Text(session?.user?.optString("email") ?: "Guest account",
                        fontWeight = FontWeight.Bold, fontSize = 17.sp)
                    Text(if (session == null) "Sign in to sync across devices"
                        else "Email verified · Cloud account",
                        color = Muted, fontSize = 12.sp)
                    Spacer(Modifier.height(10.dp))
                    if (session == null) Button(onClick = { state.showAuth = true }) { Text("Sign in / Create account") }
                    else TextButton(onClick = { state.signOut() }) { Text("Sign out") }
                }
            }
            Spacer(Modifier.height(10.dp))
            Heading("Your movie languages", "Choose for native For You recommendations")
            val choices = listOf("English", "Tamil", "Hindi", "Telugu", "Malayalam", "Kannada", "Sinhala", "Korean", "Japanese")
            choices.chunked(3).forEach { group ->
                Row(horizontalArrangement = Arrangement.spacedBy(5.dp)) {
                    group.forEach { label ->
                        FilterChip(selected = label in state.favorites, onClick = { state.toggleLanguage(label) },
                            label = { Text(label, fontSize = 10.sp) })
                    }
                }
            }
            Heading("Favorite genres", "Used to build your personal For You section")
            listOf("Action", "Comedy", "Drama", "Thriller", "Romance", "Sci-Fi",
                "Animation", "Horror", "Fantasy", "Adventure", "Crime", "Documentary")
                .chunked(3).forEach { row ->
                    Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                        row.forEach { genre ->
                            FilterChip(selected = genre in state.favoriteGenres,
                                onClick = { state.toggleGenre(genre) },
                                label = { Text(genre, fontSize = 10.sp) })
                        }
                    }
                }
            Heading("Favorite artists", "Match movies by actor or actress")
            Row(verticalAlignment = Alignment.CenterVertically) {
                OutlinedTextField(value = newArtist, onValueChange = { newArtist = it.take(80) },
                    modifier = Modifier.weight(1f), singleLine = true, label = { Text("Artist name") })
                TextButton(onClick = { state.addArtist(newArtist); newArtist = "" },
                    enabled = newArtist.isNotBlank()) { Text("Add") }
            }
            state.favoriteArtists.forEach { artist ->
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(artist, Modifier.weight(1f), fontSize = 12.sp)
                    IconButton(onClick = { state.removeArtist(artist) }) {
                        Icon(Icons.Default.Close, "Remove artist", tint = Muted, modifier = Modifier.size(17.dp))
                    }
                }
            }
            Heading("Watchlist", "${state.watchlist.size} titles saved")
            val all = (state.home.flatMap { it.second } + state.movies + state.series +
                state.history.map { it.title }).distinctBy { it.id }
            val saved = all.filter { it.id in state.watchlist }
            if (saved.isEmpty()) Text("Tap the bookmark on any title to save it.",
                color = Muted, fontSize = 13.sp, modifier = Modifier.padding(10.dp))
            if (saved.isNotEmpty()) {
                LazyRow(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    items(saved) { title -> Poster(title, true, compact = true) { state.open(title) } }
                }
            }
            if (session != null) {
                Spacer(Modifier.height(10.dp))
                HorizontalDivider(color = Muted.copy(alpha = .15f))
                Heading("Approved TVs", "Revoke TV access or approve pairing code")
                OutlinedButton(onClick = { state.loadApprovedTvs() }) { Text("Load paired TVs") }
                state.approvedTvs.forEach { tv ->
                    Row(Modifier.fillMaxWidth().padding(vertical = 4.dp), verticalAlignment = Alignment.CenterVertically) {
                        Text(tv.optString("label", "TV"), Modifier.weight(1f), color = Color.White)
                        TextButton(onClick = { state.revokeTv(tv.optString("id")) }) { Text("Revoke") }
                    }
                }
                OutlinedTextField(value = pairId, onValueChange = { pairId = it.take(90) },
                    label = { Text("TV pairing code / ID") }, singleLine = true)
                TextButton(onClick = { state.approveTv(pairId); pairId = "" }, enabled = pairId.isNotBlank()) {
                    Text("Approve TV")
                }
            }
            Spacer(Modifier.height(28.dp))
            Text("FLIXLEO · Native Android · v1.2.0", color = Gold, fontWeight = FontWeight.Bold)
            Text("Discover using TMDB metadata. Availability and source compatibility vary.",
                color = Muted, fontSize = 11.sp)
        }
    }
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
