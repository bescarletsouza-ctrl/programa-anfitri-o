package br.com.mirapontocom.events.we.print

import android.content.Context
import android.graphics.Bitmap
import com.brother.sdk.lmprinter.Channel
import com.brother.sdk.lmprinter.OpenChannelError
import com.brother.sdk.lmprinter.PrintError
import com.brother.sdk.lmprinter.PrinterDriverGenerator
import com.brother.sdk.lmprinter.PrinterModel
import com.brother.sdk.lmprinter.setting.QLPrintSettings

/**
 * Único ponto que fala com o SDK da Brother (Print SDK v4, Android).
 * Chame SEMPRE fora da thread principal — abre conexão de rede e o SDK exige uma thread só por impressão.
 */
class BrotherPrinter(private val context: Context) {

    /** Imprime os bitmaps em sequência. Devolve null se deu certo, ou a mensagem de erro em português. */
    fun imprimir(bitmaps: List<Bitmap>, ip: String, etiquetaSdk: String, cortar: Boolean): String? {
        if (ip.isBlank()) return "Informe o IP da impressora nas configurações."

        val canal = Channel.newWifiChannel(ip)
        val aberto = PrinterDriverGenerator.openChannel(canal)
        if (aberto.error.code != OpenChannelError.ErrorCode.NoError) {
            return "Não consegui conectar na impressora ($ip). Confira se ela está ligada e na mesma rede Wi-Fi do celular. [${aberto.error.code}]"
        }
        val driver = aberto.driver
        try {
            val ajustes = QLPrintSettings(PrinterModel.QL_810W)
            ajustes.labelSize = QLPrintSettings.LabelSize.valueOf(etiquetaSdk)
            ajustes.isAutoCut = cortar
            ajustes.workPath = context.cacheDir.absolutePath

            for (bmp in bitmaps) {
                val erro = driver.printImage(bmp, ajustes)
                if (erro.code != PrintError.ErrorCode.NoError) return traduzir(erro)
            }
            return null
        } finally {
            driver.closeChannel()
        }
    }

    private fun traduzir(e: PrintError): String = when (e.code) {
        PrintError.ErrorCode.PrinterStatusErrorPaperEmpty -> "Acabou a etiqueta (ou o rolo não está bem encaixado)."
        PrintError.ErrorCode.PrinterStatusErrorCoverOpen -> "A tampa da impressora está aberta."
        PrintError.ErrorCode.PrinterStatusErrorBusy -> "A impressora está ocupada. Tente de novo em alguns segundos."
        PrintError.ErrorCode.ChannelTimeout -> "A impressora não respondeu a tempo."
        PrintError.ErrorCode.SetLabelSizeError -> "A etiqueta escolhida não bate com a que está na impressora."
        else -> "Erro ao imprimir: ${e.code} ${e.errorDescription ?: ""}".trim()
    }
}
