-- =====================================================================
-- NEXAIGEN FINANCEIRO — 0002_nota_fiscal_arquivo_pdf.sql
--
-- Pedido da Luana: guardar o PDF da nota fiscal (NF-e) junto do registro
-- — este sistema não EMITE nota fiscal (isso continua fora, na prefeitura
-- /contador), só guarda o arquivo já emitido. O arquivo em si vai pro
-- Railway Buckets (ver lib/armazenamentoObjetos.ts — mesmo módulo já
-- usado pelo projeto irmão nexaigen-educa pra upload de prestação de
-- contas de convênio, reaproveitado aqui tal e qual, não duplicado);
-- aqui só guardamos os METADADOS de onde achar o arquivo.
--
-- arquivo_pdf_chave: a chave do objeto no bucket (nunca uma URL direta —
-- o bucket é privado, toda leitura precisa de presigned URL, ver
-- GET /api/notas/[id]/arquivo).
-- arquivo_pdf_nome: nome ORIGINAL do arquivo enviado, só pra exibição na
-- UI (ex.: "NF-e 4521 - Prefeitura de Jaguapitã.pdf") — nunca usado como
-- parte da chave sem sanitização (ver a rota de upload).
--
-- Ambos nulos até que alguém anexe um PDF — nota_fiscal sempre pôde
-- existir sem arquivo (o número já era guardado como texto livre em
-- numero_nf desde 0001_initial.sql; isto só complementa, não substitui).
-- =====================================================================

alter table nota_fiscal
  add column if not exists arquivo_pdf_chave text,
  add column if not exists arquivo_pdf_nome text;
