# We.events Impressão (app Android nativo)

Pequeno app que imprime o crachá do check-in **direto na Brother QL-810W** (Wi-Fi), sem abrir a caixa de
impressão do navegador. Ele não tem tela de check-in: o check-in continua sendo o app/PWA de sempre. Quando você
toca em **Check-in + imprimir crachá**, o check-in abre este app com os dados do crachá, ele desenha a etiqueta
(mesmo layout do crachá impresso), manda pra Brother e volta sozinho pro check-in.

```
check-in (TWA/PWA)  ──intent://print?d=…──▶  We.events Impressão  ──Wi-Fi──▶  Brother QL-810W
```

## O que você precisa (uma vez)

1. **Android Studio** (já instalado) — Hedgehog ou mais novo.
2. **SDK da Brother para Android (v4.x)**: baixe o *Brother Print SDK for Android* no
   [Brother Developer Center](https://support.brother.com/g/s/es/dev/en/mobilesdk/download/index.html)
   (pede um cadastro gratuito) e pegue o arquivo **`BrotherPrintLibrary.aar`**. Copie pra
   `android-impressao/app/libs/BrotherPrintLibrary.aar`. (Não commitamos o `.aar` — é da Brother.)
3. Um celular Android com **depuração USB** ligada (ou gere o APK e instale direto — passo 5).
4. A QL-810W ligada na **mesma rede Wi-Fi** do celular, com o rolo de **62 mm** instalado.

## Compilar

1. Android Studio → **Open** → escolha a pasta `android-impressao`. Deixe o Gradle sincronizar (baixa tudo sozinho).
2. Se der erro de compilação, copie a mensagem exata e me mande — o SDK da Brother não pôde ser testado daqui, então
   é possível ter que acertar um nome de classe/constante (principalmente `PrinterModel.QL_810W` em
   `BrotherPrinter.kt`).
3. **Run ▶** com o celular conectado. O app abre na tela de configuração.

## Configurar no celular

1. **IP da impressora**: segure o botão de corte da QL-810W por ~1 s pra imprimir a página de configuração e leia
   o *IP Address*. (Dica: no roteador, reserve esse IP pra impressora não mudar.)
2. **Etiqueta**: escolha o que está na impressora (rolo contínuo 62 mm é o mais simples).
3. **Imprimir teste** — tem que sair uma etiqueta com nome, categoria e QR.
4. No **check-in**: menu ▸ *Impressora e etiqueta* ▸ marque **Imprimir pelo app da impressora Brother**.
   (A opção vale só para o aparelho em que você marcou.)

> **Tamanho do crachá:** a fita é de 62 mm. Se o crachá estiver configurado como 90 × 55 mm, ele é reduzido pra caber
> e as letras ficam menores. Em *Impressora e etiqueta* do check-in use **largura 62 mm** (altura ~40 mm) pra o crachá
> sair no tamanho certo.

## Gerar o APK pra instalar nos outros celulares

Android Studio → **Build ▸ Build Bundle(s) / APK(s) ▸ Build APK(s)**. O arquivo fica em
`app/build/outputs/apk/debug/app-debug.apk`. Renomeie para **`we-events-impressao.apk`** e coloque em
`downloads/` (a pasta do site) — o check-in já tem o link "Baixar o app" apontando pra
`/downloads/we-events-impressao.apk`. Instalar fora da Play Store exige ligar *Instalar apps desconhecidos* no
Chrome do celular.

## Como funciona (pra quem for mexer)

- **Contrato web → app**: `assets/js/cracha.js` (`dadosCrachaApp` + `linkAppImpressao`) monta um JSON
  `{ "v":1, "c":[ { "w":62, "h":40, "qr":"CÓDIGO", "l":[ {"k":"nome","t":"Maria","s":34}, … ] } ] }`,
  codifica em base64 url-safe e abre `intent://print?d=…#Intent;scheme=weevents-print;package=…;end`.
- `PrintActivity` (filtro `weevents-print://print`) decodifica, `BadgeRenderer` desenha o bitmap
  (texto no canto superior esquerdo, QR no inferior direito, tudo preto e branco),
  `BrotherPrinter` abre o canal Wi-Fi e chama `printImage` do SDK.
- Fica de fora da v1: busca automática da impressora na rede (hoje é o IP digitado) e Bluetooth.
