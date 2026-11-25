// ==== We.events: leva a Origem das aplicações (planilha) para a plataforma ====
// Cole em Extensões → Apps Script da planilha que é a BASE DE CONSULTA (arquivo de script novo).
// Propriedade do script necessária: WE_ORIGEM_URL = URL da integração de ENTRADA (Integrações na plataforma).
// Só atualiza a "Origem do lead" de quem já é participante do evento: não cria ninguém e não muda mais nada.
const WE_ABA = 'Aplicações Nitro 10X';
const WE_INCLUIR_CAMPANHA = false;   // true => "meta / paid · n10x_dez1226"

function weEnviarOrigens() {
  const url = (PropertiesService.getScriptProperties().getProperty('WE_ORIGEM_URL') || '').trim();
  if (!url) throw new Error('Preencha a propriedade WE_ORIGEM_URL nas Propriedades do script.');
  const aba = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(WE_ABA);
  if (!aba) throw new Error('Não achei a aba "' + WE_ABA + '".');

  const valores = aba.getDataRange().getDisplayValues();
  const cab = valores.shift().map(c => c.trim().toLowerCase());
  const col = nome => cab.indexOf(nome.toLowerCase());
  const iEmail = col('E-mail'), iNome = col('Nome'), iOrigem = col('Origem'), iCamp = col('Campanha'), iStatus = col('Status');
  if (iEmail < 0 || iOrigem < 0) throw new Error('A aba precisa das colunas "E-mail" e "Origem" na primeira linha.');

  // uma linha por pessoa: se ela aplicou mais de uma vez, vale a Aprovada; sem aprovada, a linha mais de baixo
  const porPessoa = new Map();
  valores.forEach(l => {
    const email = String(l[iEmail] || '').trim().toLowerCase();
    let origem = String(l[iOrigem] || '').trim();
    if (!email || !origem) return;
    const campanha = iCamp >= 0 ? String(l[iCamp] || '').trim() : '';
    if (WE_INCLUIR_CAMPANHA && campanha) origem += ' · ' + campanha;
    const nome = iNome >= 0 ? String(l[iNome] || '').trim() : '';
    const aprovado = iStatus >= 0 && String(l[iStatus]).trim().toLowerCase() === 'aprovado';
    const chave = email + '|' + nome.toLowerCase();
    const antes = porPessoa.get(chave);
    if (antes && antes.aprovado && !aprovado) return;
    porPessoa.set(chave, { email: email, nome: nome, origem: origem, aprovado: aprovado });
  });

  const itens = Array.from(porPessoa.values()).map(p => ({ email: p.email, nome: p.nome, origem: p.origem }));
  let atualizados = 0, jaCertos = 0, fora = 0, duplicados = 0;
  for (let i = 0; i < itens.length; i += 500) {
    const r = UrlFetchApp.fetch(url, {
      method: 'post', contentType: 'application/json', muteHttpExceptions: true,
      payload: JSON.stringify({ acao: 'atualizar_origem', itens: itens.slice(i, i + 500) })
    });
    const texto = r.getContentText();
    let j = {};
    try { j = JSON.parse(texto); } catch (e) { /* resposta não é JSON */ }
    if (r.getResponseCode() !== 200 || j.acao !== 'origem_atualizada') {
      throw new Error('A plataforma respondeu ' + r.getResponseCode() + ': ' + texto +
        (/sem nome nem e-mail/i.test(texto) ? ' (reimplante a função webhook-in com o código novo)' : ''));
    }
    atualizados += j.atualizados;
    jaCertos += j.ja_estavam_certos;
    fora += j.nao_sao_participantes;
    duplicados += j.email_de_mais_de_uma_pessoa;
  }
  Logger.log('Pessoas na planilha: ' + itens.length + ' · atualizadas agora: ' + atualizados +
    ' · já estavam certas: ' + jaCertos + ' · não são participantes: ' + fora + ' · e-mail repetido sem nome igual: ' + duplicados);
}
