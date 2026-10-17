# Contribuindo

Use Node.js 24 ou superior. Instale com `npm ci` e rode `npm test` antes de enviar uma alteração. Testes usam diretórios temporários e portas locais; precisam de permissão para abrir sockets locais.

Abra uma issue descrevendo o problema e um exemplo reproduzível, usando dados fictícios. Não inclua webhooks reais com tokens, credenciais ou informações pessoais.

Mantenha a lógica HTTP, armazenamento e comandos separados. Mudanças devem preservar bodies binários, headers duplicados, compatibilidade entre sistemas e a ausência de API administrativa pública. Adicione testes para correções de comportamento.

Mudanças no formato do banco exigem uma migração explícita e testes com bancos da versão anterior. Atualize a ajuda, o README e o changelog quando alterar comandos ou comportamento visível.
