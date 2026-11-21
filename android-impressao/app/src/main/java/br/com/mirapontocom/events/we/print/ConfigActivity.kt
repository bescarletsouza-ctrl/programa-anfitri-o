package br.com.mirapontocom.events.we.print

import android.app.Activity
import android.os.Bundle
import android.text.InputType
import android.view.View
import android.widget.AdapterView
import android.widget.ArrayAdapter
import android.widget.Button
import android.widget.CheckBox
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.Spinner
import android.widget.TextView
import android.widget.Toast
import com.brother.sdk.lmprinter.Channel
import com.brother.sdk.lmprinter.NetworkSearchOption
import com.brother.sdk.lmprinter.PrinterSearcher
import kotlin.concurrent.thread

/** Tela de configuração da impressora (aberta pelo menu do check-in): IP, tipo de etiqueta e impressão de teste. */
class ConfigActivity : Activity() {
    private lateinit var prefs: Prefs
    private lateinit var campoIp: EditText
    private lateinit var seletor: Spinner
    private lateinit var cortar: CheckBox
    private lateinit var resultado: TextView

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        prefs = Prefs(this)
        val dp = resources.displayMetrics.density
        fun px(v: Int) = (v * dp).toInt()

        val coluna = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(px(20), px(24), px(20), px(24))
        }
        fun titulo(t: String) = TextView(this).apply {
            text = t; textSize = 14f; setPadding(0, px(18), 0, px(4)); setTypeface(typeface, android.graphics.Typeface.BOLD)
        }

        coluna.addView(TextView(this).apply { text = "We.events Impressão"; textSize = 22f; setTypeface(typeface, android.graphics.Typeface.BOLD) })
        coluna.addView(TextView(this).apply {
            text = "Imprime os crachás do check-in direto na Brother QL-810W, sem abrir a caixa de impressão."
            textSize = 14f; setPadding(0, px(6), 0, 0)
        })

        coluna.addView(titulo("IP da impressora"))
        campoIp = EditText(this).apply {
            hint = "Ex.: 192.168.0.50"
            inputType = InputType.TYPE_CLASS_PHONE
            setText(prefs.ip)
            setSingleLine()
        }
        coluna.addView(campoIp)
        coluna.addView(Button(this).apply { text = "Buscar impressora na rede"; setOnClickListener { buscarImpressora() } })
        coluna.addView(TextView(this).apply {
            text = "A impressora e este celular precisam estar na mesma rede Wi-Fi. Se a busca não achar, digite o IP: segure o botão de corte da QL-810W por ~1 s pra imprimir a página de configuração e procure \"IP Address\"."
            textSize = 12f
        })

        coluna.addView(titulo("Etiqueta na impressora"))
        seletor = Spinner(this)
        seletor.adapter = ArrayAdapter(this, android.R.layout.simple_spinner_dropdown_item, Etiquetas.TODAS.map { it.rotulo })
        seletor.setSelection(Etiquetas.TODAS.indexOfFirst { it.sdk == prefs.etiqueta }.coerceAtLeast(0))
        seletor.onItemSelectedListener = object : AdapterView.OnItemSelectedListener {
            override fun onItemSelected(p: AdapterView<*>?, v: View?, pos: Int, id: Long) {}
            override fun onNothingSelected(p: AdapterView<*>?) {}
        }
        coluna.addView(seletor)

        cortar = CheckBox(this).apply { text = "Cortar a etiqueta depois de cada impressão"; isChecked = prefs.cortar }
        coluna.addView(cortar)

        val btnSalvar = Button(this).apply { text = "Salvar"; setOnClickListener { salvar(); Toast.makeText(this@ConfigActivity, "Salvo.", Toast.LENGTH_SHORT).show() } }
        val btnTeste = Button(this).apply { text = "Imprimir teste"; setOnClickListener { imprimirTeste() } }
        coluna.addView(btnSalvar)
        coluna.addView(btnTeste)

        resultado = TextView(this).apply { textSize = 14f; setPadding(0, px(14), 0, 0) }
        coluna.addView(resultado)

        coluna.addView(titulo("Como usar"))
        coluna.addView(TextView(this).apply {
            text = "Não há mais nada a ligar: com a impressora configurada aqui, os botões \"Check-in + imprimir crachá\" e " +
                "\"Reimprimir crachá\" do check-in já imprimem direto na Brother."
            textSize = 13f
        })
        coluna.addView(Button(this).apply { text = "Voltar ao check-in"; setOnClickListener { finish() } })

        setContentView(ScrollView(this).apply { addView(coluna) })
    }

    private var buscando = false

    /** Procura impressoras Brother na rede Wi-Fi (até 15 s) e preenche o IP da primeira QL encontrada. */
    private fun buscarImpressora() {
        if (buscando) return
        buscando = true
        resultado.text = "Procurando impressoras na rede (até 15 s)…"
        thread {
            var achada: Channel? = null
            val res = PrinterSearcher.startNetworkSearch(applicationContext, NetworkSearchOption(15.0, false)) { canal ->
                val modelo = canal.extraInfo[Channel.ExtraInfoKey.ModelName] ?: ""
                if (achada == null && modelo.contains("QL", ignoreCase = true)) {
                    achada = canal
                    PrinterSearcher.cancelNetworkSearch()   // achou a QL: não precisa esperar o fim
                }
            }
            buscando = false
            val canal = achada
            runOnUiThread {
                if (canal != null) {
                    campoIp.setText(canal.channelInfo)
                    resultado.text = "Encontrei ${canal.extraInfo[Channel.ExtraInfoKey.ModelName]} em ${canal.channelInfo}. Toque em Salvar."
                } else {
                    resultado.text = "Não encontrei nenhuma QL na rede (${res.error.code}). Confira o Wi-Fi ou digite o IP."
                }
            }
        }
    }

    private fun salvar() {
        prefs.ip = campoIp.text.toString()
        prefs.etiqueta = Etiquetas.TODAS[seletor.selectedItemPosition].sdk
        prefs.cortar = cortar.isChecked
    }

    private fun imprimirTeste() {
        salvar()
        resultado.text = "Imprimindo teste…"
        val etiqueta = Etiquetas.porSdk(prefs.etiqueta)
        val ip = prefs.ip
        val corta = prefs.cortar
        thread {
            val msg = try {
                val bmp = BadgeRenderer.desenhar(BadgeRenderer.exemplo(), Etiquetas.LARGURA_PX, etiqueta.alturaPx)
                BrotherPrinter(applicationContext).imprimir(listOf(bmp), ip, etiqueta.sdk, corta) ?: "Teste enviado. Se a etiqueta saiu, está tudo certo."
            } catch (e: Throwable) {
                "Falhou: ${e.message ?: e.javaClass.simpleName}"
            }
            runOnUiThread { resultado.text = msg }
        }
    }
}
