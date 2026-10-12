package cyou.flixleo.android

import android.app.Activity
import android.content.ActivityNotFoundException
import android.content.Intent
import android.net.Uri
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

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.statusBarColor = android.graphics.Color.rgb(8, 10, 15)
        window.navigationBarColor = android.graphics.Color.rgb(8, 10, 15)
        val frame = FrameLayout(this)
        browser = WebView(this)
        frame.addView(browser, FrameLayout.LayoutParams(-1, -1))
        setContentView(frame)
        browser.settings.apply {
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
