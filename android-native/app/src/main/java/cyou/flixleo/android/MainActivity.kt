package cyou.flixleo.android

import android.app.Activity
import android.app.AlertDialog
import android.content.ActivityNotFoundException
import android.content.Intent
import android.net.Uri
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import android.os.Bundle
import android.view.View
import android.webkit.CookieManager
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.FrameLayout
import android.widget.Toast

class MainActivity : Activity() {
    private lateinit var browser: WebView
    private var fullscreenView: View? = null
    private var fullscreenCallback: WebChromeClient.CustomViewCallback? = null
    private var fileCallback: android.webkit.ValueCallback<Array<Uri>>? = null
    private val fileRequestCode = 450
    private val home = "https://flixleo.cyou/"
    private var lastPolicyCheck = 0L
    private var blockingDialog: AlertDialog? = null
    private var updateBlocked = false
    private var lastOptionalVersion = 0
    private val shownNotices = mutableSetOf<String>()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.statusBarColor = android.graphics.Color.rgb(8, 10, 15)
        window.navigationBarColor = android.graphics.Color.rgb(8, 10, 15)
        val frame = FrameLayout(this)
        browser = WebView(this)
        frame.addView(browser, FrameLayout.LayoutParams(-1, -1))
        setContentView(frame)
        browser.settings.apply {
            userAgentString = userAgentString + " FlixLeoNative/1.0"
            javaScriptEnabled = true
            domStorageEnabled = true
            mediaPlaybackRequiresUserGesture = false
            cacheMode = WebSettings.LOAD_DEFAULT
            mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
            allowFileAccess = false
            allowContentAccess = true
            javaScriptCanOpenWindowsAutomatically = false
            setSupportMultipleWindows(false)
        }
        CookieManager.getInstance().setAcceptCookie(true)
        CookieManager.getInstance().setAcceptThirdPartyCookies(browser, true)
        browser.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean =
                handleUrl(request.url.toString())
            @Deprecated("Deprecated in Java")
            override fun shouldOverrideUrlLoading(view: WebView, url: String): Boolean = handleUrl(url)
        }
        browser.webChromeClient = object : WebChromeClient() {
            override fun onShowCustomView(view: View, callback: CustomViewCallback) {
                if (fullscreenView != null) { callback.onCustomViewHidden(); return }
                fullscreenView = view
                fullscreenCallback = callback
                frame.addView(view, FrameLayout.LayoutParams(-1, -1))
                browser.visibility = View.GONE
            }
            override fun onHideCustomView() {
                fullscreenView?.let { frame.removeView(it) }
                fullscreenView = null
                browser.visibility = View.VISIBLE
                fullscreenCallback?.onCustomViewHidden()
                fullscreenCallback = null
            }
            override fun onShowFileChooser(webView: WebView, callback: android.webkit.ValueCallback<Array<Uri>>, params: FileChooserParams): Boolean {
                fileCallback?.onReceiveValue(null)
                fileCallback = callback
                return try {
                    startActivityForResult(params.createIntent(), fileRequestCode)
                    true
                } catch (e: ActivityNotFoundException) {
                    fileCallback = null
                    callback.onReceiveValue(null)
                    false
                }
            }
        }
        if (savedInstanceState != null) browser.restoreState(savedInstanceState)
        else browser.loadUrl(home)
        checkUpdatePolicy()
    }

    override fun onResume() {
        super.onResume()
        if (::browser.isInitialized && System.currentTimeMillis() - lastPolicyCheck > 60L * 60 * 1000) {
            checkUpdatePolicy()
        }
    }

    private fun checkUpdatePolicy() {
        if (System.currentTimeMillis() - lastPolicyCheck < 30_000) return
        lastPolicyCheck = System.currentTimeMillis()
        Thread {
            var conn: HttpURLConnection? = null
            try {
                conn = (URL(home + "api/gateway/v1/check/flixleo-android?versionCode=1").openConnection() as HttpURLConnection).apply {
                    connectTimeout = 5000
                    readTimeout = 5000
                    requestMethod = "GET"
                }
                if (conn.responseCode != 200) return@Thread
                val body = conn.inputStream.bufferedReader().use { it.readText() }
                val response = JSONObject(body)
                val policy = response.optJSONObject("policy") ?: return@Thread
                val notices = response.optJSONArray("notices")
                val latest = policy.optInt("latestVersionCode", 1)
                val minimum = policy.optInt("minVersionCode", 0)
                val forced = policy.optBoolean("forceUpdate", false) && 1 < minimum
                val optional = policy.optBoolean("updateAvailable", false) && latest > 1
                val maintenance = policy.optBoolean("maintenance", false)
                val url = policy.optString("updateUrl", "")
                val notes = policy.optString("notes", "")
                runOnUiThread {
                    if (isFinishing || isDestroyed) return@runOnUiThread
                    if (forced) {
                        blockingDialog?.dismiss()
                        blockingDialog = AlertDialog.Builder(this)
                            .setTitle("FlixLeo update required")
                            .setMessage(if (notes.isBlank()) "Please update FlixLeo to continue." else notes)
                            .setCancelable(false)
                            .setPositiveButton("Update") { _, _ -> openUpdatePage(url); lastPolicyCheck = 0; checkUpdatePolicy() }
                            .create()
                        blockingDialog?.show()
                    } else if (maintenance) {
                        blockingDialog?.dismiss()
                        blockingDialog = AlertDialog.Builder(this)
                            .setTitle("FlixLeo maintenance")
                            .setMessage(policy.optString("maintenanceMessage", "Service is temporarily unavailable."))
                            .setCancelable(false)
                            .setPositiveButton("Retry") { _, _ -> lastPolicyCheck = 0; checkUpdatePolicy() }
                            .create()
                        blockingDialog?.show()
                    } else if (optional && latest != lastOptionalVersion) {
                        lastOptionalVersion = latest
                        AlertDialog.Builder(this)
                            .setTitle("FlixLeo update available")
                            .setMessage(notes.ifBlank { "Version " + policy.optString("latestVersionName") + " is available." })
                            .setPositiveButton("Update") { _, _ -> openUpdatePage(url) }
                            .setNegativeButton("Later", null)
                            .show()
                    } else if (!forced && !maintenance && notices != null && notices.length() > 0) {
                        val notice = notices.optJSONObject(0)
                        val noticeId = notice?.optString("id", "").orEmpty()
                        if (notice != null && noticeId.isNotBlank() && shownNotices.add(noticeId)) {
                            AlertDialog.Builder(this)
                                .setTitle(notice.optString("title", "FlixLeo announcement"))
                                .setMessage(notice.optString("body", ""))
                                .setPositiveButton("OK", null)
                                .show()
                        }
                    }
                }
            } catch (_: Exception) {
                // Network failure never blocks installed versions.
            } finally { conn?.disconnect() }
        }.start()
    }

    private fun openUpdatePage(link: String) {
        try {
            val uri = Uri.parse(link)
            if (uri.scheme != "https" || uri.host.isNullOrBlank()) return
            startActivity(Intent(Intent.ACTION_VIEW, uri))
        } catch (_: Exception) { }
    }

    private fun handleUrl(url: String): Boolean {
        if (url.startsWith("flixleo-player://")) {
            val page = runCatching { Uri.parse(browser.url) }.getOrNull()
            if (page?.scheme == "https" && page.host == "flixleo.cyou") {
                val stream = Uri.parse(url).getQueryParameter("url")
                val source = stream?.let { runCatching { Uri.parse(it) }.getOrNull() }
                if (source?.scheme == "https" && !source.host.isNullOrBlank()) {
                    startActivity(Intent(this, NativePlayerActivity::class.java).putExtra("stream_url", stream))
                } else Toast.makeText(this, "Invalid stream", Toast.LENGTH_SHORT).show()
            }
            return true
        }
        val uri = runCatching { Uri.parse(url) }.getOrNull() ?: return true
        if (uri.scheme == "https" && uri.host.equals("flixleo.cyou", ignoreCase = true)) return false
        if (uri.scheme == "https" || uri.scheme == "http" || uri.scheme == "mailto") {
            return try { startActivity(Intent(Intent.ACTION_VIEW, uri)); true }
            catch (_: Exception) { true }
        }
        return true
    }

    @Deprecated("Deprecated in Java")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        if (requestCode == fileRequestCode) {
            fileCallback?.onReceiveValue(if (resultCode == RESULT_OK) WebChromeClient.FileChooserParams.parseResult(resultCode, data) else null)
            fileCallback = null
        }
    }
    @Deprecated("Deprecated in Java")
    override fun onBackPressed() {
        if (fullscreenView != null) {
            browser.webChromeClient?.onHideCustomView()
        } else if (browser.canGoBack()) browser.goBack()
        else super.onBackPressed()
    }
    override fun onSaveInstanceState(outState: Bundle) {
        browser.saveState(outState)
        super.onSaveInstanceState(outState)
    }
    override fun onDestroy() {
        browser.destroy()
        super.onDestroy()
    }
}
