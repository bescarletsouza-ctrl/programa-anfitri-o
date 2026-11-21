# We.events Check-in (app Android nativo)

**Um app só**: o check-in do evento (a mesma página `checkin-app.html` do site, dentro de um WebView) **com
impressão direta do crachá na Brother QL-810W** por Wi-Fi, sem abrir a caixa de impressão do navegador.

```
We.events Check-in (Android)
 ├─ WebView  → https://we.events.mirapontocom.com.br/checkin-app.html   (leitor de QR, lista, check-in…)
 └─ ponte JS → window.WeEventsApp.imprimir(...)  ──Wi-Fi──▶  Brother QL-810W
```

Como a tela vem do site, **toda melhoria no check-in chega sozinha** — não precisa reinstalar o app.

## O que você precisa (uma vez)

1. **Android Studio** — abra a pasta do projeto **por um caminho sem acento** (ex.: `C:\dev\android-impressao`);
   o Android não compila em pastas com acento, como `anfitriões`.
2. **`BrotherPrintLibrary.aar`** (Brother Print SDK for Android, v4.x) em `app/libs/`
   (download no [Brother Developer Center](https://support.brother.com/g/s/es/dev/en/mobilesdk/download/index.html);
   não commitamos o `.aar`, ele é da Brother).
3. A QL-810W ligada na **mesma rede Wi-Fi** do celular, com o rolo de **62 mm**.

## Compilar e instalar

Android Studio → **Open** → a pasta → aguarde o Gradle sincronizar → **Run ▶** (celular com depuração USB ou emulador).
Para gerar o APK dos outros celulares: **Build ▸ Build APK(s)**; o arquivo sai em
`app/build/outputs/apk/debug/app-debug.apk` (renomeie para `we-events-checkin.apk` e coloque em `downloads/`).
Instalar fora da Play Store exige liberar *Instalar apps desconhecidos* para o navegador/gerenciador de arquivos.

## Configurar a impressora (em cada celular)

No app: entre com o seu login → menu ▸ **Impressora e etiqueta** ▸ **Configurar impressora**:
1. **Buscar impressora na rede** (ou digite o IP — segure o botão de corte da QL-810W ~1 s pra imprimir a página
   de configuração e leia o *IP Address*). Dica: reserve esse IP no roteador.
2. **Etiqueta**: o que está na impressora (rolo contínuo 62 mm é o mais simples).
3. **Salvar** e **Imprimir teste**.

A partir daí, **Check-in + imprimir crachá** e **Reimprimir crachá** imprimem direto na Brother.

> **Tamanho do crachá:** a fita é de 62 mm. Se o crachá estiver configurado como 90 × 55 mm ele é reduzido pra caber
> e as letras ficam menores. Em *Impressora e etiqueta* use **largura 62 mm** (altura ~40 mm).

## Como funciona (pra quem for mexer)

- `CheckinActivity`: WebView que só carrega o nosso domínio (links de fora abrem no navegador), libera a câmera
  (permissão do Android) pro leitor de QR e expõe a ponte `window.WeEventsApp` (`imprimir(json)`, `abrirConfig()`).
- **Contrato web → app**: `assets/js/cracha.js` (`dadosCrachaApp`) monta
  `{ "v":1, "c":[ { "w":62, "h":40, "qr":"CÓDIGO", "l":[ {"k":"nome","t":"Maria","s":34}, … ] } ] }` e chama a ponte.
  Fora do app (PC/navegador) a página segue usando a impressão do navegador.
- `BadgeRenderer` desenha o bitmap (texto no canto superior esquerdo, QR no inferior direito, preto e branco),
  `BrotherPrinter` abre o canal Wi-Fi e chama `printImage` do SDK, `ConfigActivity` guarda IP/etiqueta.
- Fica de fora da v1: Bluetooth e USB (só Wi-Fi).
