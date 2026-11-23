package br.com.mirapontocom.events.we.print

import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Matrix
import android.graphics.Paint
import android.graphics.RectF
import android.graphics.Typeface
import android.text.Layout
import android.text.StaticLayout
import android.text.TextPaint
import android.util.Base64
import com.google.zxing.BarcodeFormat
import com.google.zxing.EncodeHintType
import com.google.zxing.qrcode.QRCodeWriter
import com.google.zxing.qrcode.decoder.ErrorCorrectionLevel
import org.json.JSONObject
import kotlin.math.floor
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt

/** Uma linha de texto do crachá: k = campo (evento/nome/categoria/...), t = texto, s = tamanho em px CSS. */
data class Linha(val k: String, val t: String, val s: Float)

/** Um crachá já resolvido pelo check-in (web). Medidas em mm. */
data class Cracha(val wMm: Float, val hMm: Float, val qr: String, val linhas: List<Linha>)

/**
 * Desenha o crachá num Bitmap preto e branco, no mesmo layout do crachá impresso pelo navegador:
 * texto empilhado no canto superior esquerdo e o QR no canto inferior direito.
 */
object BadgeRenderer {
    private const val MM_POR_PX_CSS = 25.4f / 96f

    /** Decodifica o parâmetro `d` do link: base64 (url-safe) de {"v":1,"c":[{w,h,qr,l:[{k,t,s}]}]}. */
    fun parse(d: String): List<Cracha> {
        var b64 = d.trim()
        while (b64.length % 4 != 0) b64 += "="
        return parseJson(String(Base64.decode(b64, Base64.URL_SAFE), Charsets.UTF_8))
    }

    /** Mesmo formato, já como texto JSON: {"v":1,"c":[{w,h,qr,l:[{k,t,s}]}]} (é o que a ponte do WebView recebe). */
    fun parseJson(texto: String): List<Cracha> {
        val json = JSONObject(texto)
        val arr = json.getJSONArray("c")
        return (0 until arr.length()).map { i ->
            val o = arr.getJSONObject(i)
            val ls = o.optJSONArray("l")
            Cracha(
                wMm = o.optDouble("w", 90.0).toFloat(),
                hMm = o.optDouble("h", 55.0).toFloat(),
                qr = o.optString("qr", ""),
                linhas = (0 until (ls?.length() ?: 0)).map { j ->
                    val l = ls!!.getJSONObject(j)
                    Linha(l.optString("k"), l.optString("t"), l.optDouble("s", 14.0).toFloat())
                },
            )
        }
    }

    /** Crachá de exemplo pra "Imprimir teste". */
    fun exemplo() = Cracha(
        wMm = 62f, hMm = 40f, qr = "WE-TESTE-0001",
        linhas = listOf(
            Linha("evento", "We.events", 13f),
            Linha("nome", "Maria da Silva", 34f),
            Linha("categoria", "GOLD", 18f),
            Linha("codigo", "WE-TESTE-0001", 13f),
        ),
    )

    /**
     * @param larguraPx largura útil da fita (696 pts na de 62 mm)
     * @param alturaFixaPx altura da etiqueta pré-cortada, ou null no rolo contínuo (altura segue o crachá)
     */
    fun desenhar(c: Cracha, larguraPx: Int, alturaFixaPx: Int?, orientacao: String = Orientacao.VERTICAL): Bitmap {
        if (orientacao != Orientacao.VERTICAL) return desenharHorizontal(c, larguraPx, alturaFixaPx, orientacao == Orientacao.HORIZONTAL_INV)
        // pontos por mm: no rolo o crachá ocupa a largura toda; na pré-cortada, cabe inteiro
        val dpm = if (alturaFixaPx == null) larguraPx / c.wMm
                  else min(larguraPx / c.wMm, alturaFixaPx / c.hMm)
        val cardW = c.wMm * dpm
        val cardH = c.hMm * dpm
        val altura = alturaFixaPx ?: cardH.roundToInt()
        val bmp = Bitmap.createBitmap(larguraPx, altura, Bitmap.Config.ARGB_8888)
        val canvas = Canvas(bmp)
        canvas.drawColor(Color.WHITE)

        pintar(canvas, c, dpm, (larguraPx - cardW) / 2f, 0f)
        return bmp
    }

    /**
     * Horizontal: o crachá fica "deitado" (lado maior ao longo da etiqueta que sai da impressora, lado menor na
     * largura da fita) — desenha em paisagem e gira 90° antes de mandar, porque a impressora só imprime de cima pra baixo.
     */
    private fun desenharHorizontal(c: Cracha, larguraPx: Int, alturaFixaPx: Int?, invertido: Boolean): Bitmap {
        val comp = max(c.wMm, c.hMm)
        val larg = min(c.wMm, c.hMm)
        val cartao = c.copy(wMm = comp, hMm = larg)
        val dpm = if (alturaFixaPx == null) larguraPx / larg else min(larguraPx / larg, alturaFixaPx / comp)
        val cardW = comp * dpm
        val cardH = larg * dpm
        val comprimento = alturaFixaPx ?: cardW.roundToInt()
        val paisagem = Bitmap.createBitmap(comprimento, larguraPx, Bitmap.Config.ARGB_8888)
        val canvas = Canvas(paisagem)
        canvas.drawColor(Color.WHITE)
        pintar(canvas, cartao, dpm, (comprimento - cardW) / 2f, (larguraPx - cardH) / 2f)
        val giro = Matrix().apply { postRotate(if (invertido) 270f else 90f) }
        return Bitmap.createBitmap(paisagem, 0, 0, paisagem.width, paisagem.height, giro, true)
    }

    /** Desenha o crachá (texto + QR) com o canto superior esquerdo em (offX, offY). */
    private fun pintar(canvas: Canvas, c: Cracha, dpm: Float, offX: Float, offY: Float) {
        val cardW = c.wMm * dpm
        val cardH = c.hMm * dpm
        val pad = 6f * dpm
        val maxW = (cardW - 2 * pad).toInt().coerceAtLeast(40)

        canvas.save()
        canvas.clipRect(offX, offY, offX + cardW, offY + cardH)

        // ---- texto (canto superior esquerdo) ----
        var y = offY + pad
        for (l in c.linhas) {
            if (l.t.isBlank()) continue
            val tp = TextPaint(Paint.ANTI_ALIAS_FLAG).apply {
                textSize = l.s * MM_POR_PX_CSS * dpm
                color = Color.BLACK // etiqueta é térmica preto e branco: nada de cinza/roxo claro
                typeface = Typeface.create("sans-serif", if (l.k == "nome" || l.k == "evento" || l.k == "categoria" || l.k == "codigo") Typeface.BOLD else Typeface.NORMAL)
                letterSpacing = when (l.k) { "evento" -> 0.12f; "codigo" -> 0.12f; "nome" -> -0.02f; else -> 0f }
            }
            val texto = if (l.k == "evento") l.t.uppercase() else l.t
            if (l.k == "codigo") y += 1.5f * dpm
            val layout = StaticLayout.Builder.obtain(texto, 0, texto.length, tp, maxW)
                .setAlignment(Layout.Alignment.ALIGN_NORMAL)
                .setLineSpacing(0f, if (l.k == "nome") 1.0f else 1.08f)
                .setIncludePad(false)
                .build()
            canvas.save()
            canvas.translate(offX + pad, y)
            layout.draw(canvas)
            canvas.restore()
            y += layout.height + 1f * dpm + if (l.k == "evento") 0.5f * dpm else 0f
        }

        // ---- QR (canto inferior direito) ----
        if (c.qr.isNotBlank()) desenharQr(canvas, c.qr, offX + cardW - pad, offY + cardH - pad, dpm, c)

        canvas.restore()
    }

    private fun desenharQr(canvas: Canvas, texto: String, direita: Float, baixo: Float, dpm: Float, c: Cracha) {
        // 25 mm como no crachá impresso, mas nunca maior que ~60% da altura (etiquetas baixas)
        val qrMm = min(25f, c.hMm * 0.6f)
        val moldura = 1.5f * dpm            // folga branca entre a borda e o QR
        val borda = 0.6f * dpm
        val lado = qrMm * dpm + 2 * moldura + 2 * borda
        val box = RectF(direita - lado, baixo - lado, direita, baixo)

        val fundo = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = Color.WHITE; style = Paint.Style.FILL }
        val traco = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = Color.BLACK; style = Paint.Style.STROKE; strokeWidth = borda }
        canvas.drawRoundRect(box, 1.8f * dpm, 1.8f * dpm, fundo)
        canvas.drawRoundRect(RectF(box.left + borda / 2, box.top + borda / 2, box.right - borda / 2, box.bottom - borda / 2),
            1.8f * dpm, 1.8f * dpm, traco)

        val m = QRCodeWriter().encode(
            texto, BarcodeFormat.QR_CODE, 0, 0,
            mapOf(EncodeHintType.MARGIN to 0, EncodeHintType.ERROR_CORRECTION to ErrorCorrectionLevel.M),
        )
        val n = m.width
        val area = qrMm * dpm
        val modulo = floor(area / n).coerceAtLeast(1f)   // módulos inteiros = QR nítido
        val tam = modulo * n
        val x0 = box.left + borda + moldura + (area - tam) / 2f
        val y0 = box.top + borda + moldura + (area - tam) / 2f
        val preto = Paint().apply { color = Color.BLACK; style = Paint.Style.FILL }
        for (yy in 0 until n) for (xx in 0 until n) {
            if (m.get(xx, yy)) canvas.drawRect(x0 + xx * modulo, y0 + yy * modulo, x0 + (xx + 1) * modulo, y0 + (yy + 1) * modulo, preto)
        }
    }
}
