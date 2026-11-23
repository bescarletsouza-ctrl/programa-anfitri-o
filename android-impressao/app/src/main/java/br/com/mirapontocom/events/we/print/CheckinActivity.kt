package br.com.mirapontocom.events.we.print

import android.Manifest
import android.annotation.SuppressLint
import android.app.Activity
import android.app.AlertDialog
import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Color
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.net.Uri
import android.webkit.WebSettings
import android.os.Bundle
import android.webkit.JavascriptInterface
import android.webkit.PermissionRequest
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Toast
import kotlin.concurrent.thread

/**
 * Tela principal: o app de check-in (a mesma página do site, checkin-app.html) dentro de um WebView.
 * A página enxerga `window.WeEventsApp` e, quando existe, manda o crachá pra imprimir por aqui
 * (Brother QL-810W por Wi-Fi) em vez de abrir a caixa de impressão do navegador.
 */
class CheckinActivity : Activity() {
    companion object {
        const val HOST = "we.events.mirapontocom.com.br"
        const val URL_INICIAL = "https://$HOST/checkin-app.html"
        private const val PEDIDO_CAMERA = 10
    }

    private lateinit var web: WebView
    private var pedidoCamera: PermissionRequest? = null
    private var imprimindo = false

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        web = WebView(this)
        web.setBackgroundColor(Color.parseColor("#0c0c0d"))
        setContentView(web)

        with(web.settings) {
            javaScriptEnabled = true
            domStorageEnabled = true                 // login (Supabase) fica guardado no aparelho
            mediaPlaybackRequiresUserGesture = false
            setSupportZoom(false)
            userAgentString = "$userAgentString WeEventsApp/1"
        }
        // Sem internet ao abrir: usa a cópia guardada (o app de check-in tem modo offline e abre do cache)
        web.settings.cacheMode = if (semRede()) WebSettings.LOAD_CACHE_ELSE_NETWORK else WebSettings.LOAD_DEFAULT
        // Só a nossa página carrega neste WebView (links de fora abrem no navegador), então a ponte é segura.
        web.addJavascriptInterface(Ponte(), "WeEventsApp")

        web.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                val uri = request.url
                if (uri.scheme == "https" && uri.host == HOST) return false
                try { startActivity(Intent(Intent.ACTION_VIEW, uri)) } catch (_: ActivityNotFoundException) { }
                return true
            }

            override fun onReceivedError(view: WebView, request: WebResourceRequest, error: WebResourceError) {
                if (request.isForMainFrame) mostrarSemConexao()
            }
        }

        web.webChromeClient = object : WebChromeClient() {
            // getUserMedia (leitor de QR): libera a câmera se o app tiver a permissão do Android
            override fun onPermissionRequest(request: PermissionRequest) {
                runOnUiThread { pedirCamera(request) }
            }
        }

        if (savedInstanceState != null) web.restoreState(savedInstanceState) else web.loadUrl(URL_INICIAL)
    }

    override fun onSaveInstanceState(outState: Bundle) {
        super.onSaveInstanceState(outState)
        web.saveState(outState)
    }

    // O check-in controla o "voltar" por dentro (menu, lista, config); só sai do app quando não há mais histórico.
    @Deprecated("Deprecated in Java")
    override fun onBackPressed() {
        if (web.canGoBack()) web.goBack() else super.onBackPressed()
    }

    override fun onResume() {
        super.onResume()
        web.onResume()
    }

    override fun onPause() {
        web.onPause()
        super.onPause()
    }

    override fun onDestroy() {
        web.destroy()
        super.onDestroy()
    }

    private fun semRede(): Boolean {
        val cm = getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
        val rede = cm.activeNetwork ?: return true
        val caps = cm.getNetworkCapabilities(rede) ?: return true
        return !caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
    }

    /* ---- câmera ---- */
    private fun pedirCamera(request: PermissionRequest) {
        val quer = request.resources.contains(PermissionRequest.RESOURCE_VIDEO_CAPTURE)
        if (!quer) { request.deny(); return }
        if (checkSelfPermission(Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED) {
            request.grant(arrayOf(PermissionRequest.RESOURCE_VIDEO_CAPTURE))
        } else {
            pedidoCamera = request
            requestPermissions(arrayOf(Manifest.permission.CAMERA), PEDIDO_CAMERA)
        }
    }

    @Deprecated("Deprecated in Java")
    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, grantResults: IntArray) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (requestCode != PEDIDO_CAMERA) return
        val pedido = pedidoCamera ?: return
        pedidoCamera = null
        if (grantResults.firstOrNull() == PackageManager.PERMISSION_GRANTED) {
            pedido.grant(arrayOf(PermissionRequest.RESOURCE_VIDEO_CAPTURE))
        } else {
            pedido.deny()
            Toast.makeText(this, "Sem a permissão da câmera o leitor de QR não funciona.", Toast.LENGTH_LONG).show()
        }
    }

    /* ---- sem internet ---- */
    private fun mostrarSemConexao() {
        val html = """
            <html><body style="background:#0c0c0d;color:#eee;font-family:sans-serif;text-align:center;padding:48px 24px">
            <h2>Sem conexão</h2>
            <p>Não consegui abrir o check-in. Confira a internet do celular.</p>
            <button onclick="location.href='$URL_INICIAL'" style="font-size:18px;padding:12px 28px;border-radius:10px;border:0">Tentar de novo</button>
            </body></html>""".trimIndent()
        web.loadDataWithBaseURL(URL_INICIAL, html, "text/html", "utf-8", null)
    }

    /* ---- impressão ---- */
    private fun imprimir(json: String) {
        if (imprimindo) { Toast.makeText(this, "Já estou imprimindo…", Toast.LENGTH_SHORT).show(); return }
        val prefs = Prefs(this)
        if (prefs.ip.isBlank()) {
            avisar("A impressora ainda não foi configurada. Informe o IP dela.", comConfigurar = true)
            return
        }
        imprimindo = true
        Toast.makeText(this, "Imprimindo…", Toast.LENGTH_SHORT).show()
        thread {
            val erro = try {
                val crachas = BadgeRenderer.parseJson(json)
                val etiqueta = Etiquetas.porSdk(prefs.etiqueta)
                val bitmaps = crachas.map { BadgeRenderer.desenhar(it, Etiquetas.LARGURA_PX, etiqueta.alturaPx, prefs.orientacao) }
                BrotherPrinter(applicationContext).imprimir(bitmaps, prefs.ip, etiqueta.sdk, prefs.cortar)
            } catch (e: Throwable) {
                "Não consegui imprimir: ${e.message ?: e.javaClass.simpleName}"
            }
            imprimindo = false
            runOnUiThread {
                if (erro == null) Toast.makeText(this, "Etiqueta enviada.", Toast.LENGTH_SHORT).show()
                else avisar(erro, comConfigurar = true)
            }
        }
    }

    private fun avisar(msg: String, comConfigurar: Boolean) {
        val b = AlertDialog.Builder(this).setTitle("Impressão").setMessage(msg).setPositiveButton("OK", null)
        if (comConfigurar) b.setNeutralButton("Configurar") { _, _ -> abrirConfig() }
        b.show()
    }

    private fun abrirConfig() = startActivity(Intent(this, ConfigActivity::class.java))

    /** O que a página do check-in enxerga em `window.WeEventsApp`. Os métodos rodam fora da thread principal. */
    inner class Ponte {
        /** json = {"v":1,"c":[{w,h,qr,l:[{k,t,s}]}]} — mesmo formato que cracha.js monta. */
        @JavascriptInterface
        fun imprimir(json: String) { runOnUiThread { this@CheckinActivity.imprimir(json) } }

        @JavascriptInterface
        fun abrirConfig() { runOnUiThread { this@CheckinActivity.abrirConfig() } }

        @JavascriptInterface
        fun versao(): String = "1"
    }
}
