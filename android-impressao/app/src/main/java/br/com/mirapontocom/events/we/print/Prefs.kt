package br.com.mirapontocom.events.we.print

import android.content.Context

/** Etiquetas suportadas (nome do enum do SDK da Brother → texto na tela). */
data class Etiqueta(val sdk: String, val rotulo: String, val alturaPx: Int?)

object Etiquetas {
    // Largura útil da fita de 62 mm na QL-810W (300 dpi) = 696 pontos.
    const val LARGURA_PX = 696

    val TODAS = listOf(
        Etiqueta("RollW62", "Rolo contínuo 62 mm (DK-22205) — o comprimento acompanha o crachá", null),
        Etiqueta("DieCutW62H100", "Etiqueta 62 × 100 mm (DK-11202)", 1109),
        Etiqueta("DieCutW62H29", "Etiqueta 62 × 29 mm (DK-11209)", 271),
        Etiqueta("DieCutW62H60", "Etiqueta 62 × 60 mm", 626),
        Etiqueta("DieCutW62H75", "Etiqueta 62 × 75 mm", 791),
    )

    fun porSdk(nome: String?) = TODAS.firstOrNull { it.sdk == nome } ?: TODAS.first()
}

class Prefs(context: Context) {
    private val sp = context.getSharedPreferences("impressora", Context.MODE_PRIVATE)

    var ip: String
        get() = sp.getString("ip", "") ?: ""
        set(v) = sp.edit().putString("ip", v.trim()).apply()

    var etiqueta: String
        get() = sp.getString("etiqueta", Etiquetas.TODAS.first().sdk) ?: Etiquetas.TODAS.first().sdk
        set(v) = sp.edit().putString("etiqueta", v).apply()

    var cortar: Boolean
        get() = sp.getBoolean("cortar", true)
        set(v) = sp.edit().putBoolean("cortar", v).apply()
}
