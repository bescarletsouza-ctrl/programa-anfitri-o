package br.com.mirapontocom.events.we.print

import android.app.Activity
import android.content.Intent
import android.os.Bundle
import android.view.Gravity
import android.view.ViewGroup
import android.widget.Button
import android.widget.LinearLayout
import android.widget.ProgressBar
import android.widget.TextView
import kotlin.concurrent.thread

/**
 * Recebe o link do check-in (weevents-print://print?d=...), desenha o(s) crachá(s), imprime na Brother
 * e fecha — o Android devolve o operador pro app de check-in sozinho.
 */
class PrintActivity : Activity() {
    private lateinit var status: TextView
    private lateinit var barra: ProgressBar
    private lateinit var botoes: LinearLayout
    private var dados: String? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setFinishOnTouchOutside(false)
        montarTela()
        iniciar(intent)
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        iniciar(intent)
    }

    private fun montarTela() {
        val dp = resources.displayMetrics.density
        val raiz = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER_HORIZONTAL
            setPadding((24 * dp).toInt(), (24 * dp).toInt(), (24 * dp).toInt(), (24 * dp).toInt())
        }
        barra = ProgressBar(this).apply { isIndeterminate = true }
        status = TextView(this).apply {
            textSize = 17f
            gravity = Gravity.CENTER
            setPadding(0, (14 * dp).toInt(), 0, (10 * dp).toInt())
        }
        botoes = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER
            visibility = android.view.View.GONE
        }
        val tentar = Button(this).apply { text = "Tentar de novo"; setOnClickListener { iniciar(intent) } }
        val config = Button(this).apply {
            text = "Configurar"
            setOnClickListener { startActivity(Intent(this@PrintActivity, MainActivity::class.java)); finish() }
        }
        val fechar = Button(this).apply { text = "Fechar"; setOnClickListener { finish() } }
        listOf(tentar, config, fechar).forEach { botoes.addView(it) }
        raiz.addView(barra, ViewGroup.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT))
        raiz.addView(status)
        raiz.addView(botoes)
        setContentView(raiz)
    }

    private fun mostrarErro(msg: String) {
        runOnUiThread {
            barra.visibility = android.view.View.GONE
            status.text = msg
            botoes.visibility = android.view.View.VISIBLE
        }
    }

    private fun iniciar(i: Intent?) {
        dados = i?.data?.getQueryParameter("d")
        val d = dados
        if (d.isNullOrBlank()) { mostrarErro("Nenhum crachá recebido."); return }

        barra.visibility = android.view.View.VISIBLE
        botoes.visibility = android.view.View.GONE
        status.text = "Imprimindo…"

        val prefs = Prefs(this)
        thread {
            try {
                val crachas = BadgeRenderer.parse(d)
                val etiqueta = Etiquetas.porSdk(prefs.etiqueta)
                val bitmaps = crachas.map { BadgeRenderer.desenhar(it, Etiquetas.LARGURA_PX, etiqueta.alturaPx) }
                val erro = BrotherPrinter(applicationContext).imprimir(bitmaps, prefs.ip, etiqueta.sdk, prefs.cortar)
                if (erro == null) {
                    runOnUiThread { status.text = "Pronto!"; finish() }
                } else {
                    mostrarErro(erro)
                }
            } catch (e: Throwable) {
                mostrarErro("Não consegui imprimir: ${e.message ?: e.javaClass.simpleName}")
            }
        }
    }
}
